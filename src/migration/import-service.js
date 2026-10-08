import { inspectNoctisV07, migrateNoctisV07 } from "./noctis-v07.js";
import { emptyVault, normalizeVault } from "../schema.js";
import { loadVault, saveVaultAtomic, replaceVaultAtomic } from "../storage/vault-store.js";
import { validateVesperBackup, validateNoctisBackup, requireValidBackup } from "../backup/backup-validation.js";

const ARRAY_KEYS=["personas","characters","stories","chats","messages","loreEntries","memoryEntries","milestones","relationships","statDefinitions","statEvents","sceneStates","knowledgeEntries","preferenceLines","usageEntries","migrationLog"];

export function detectImportSource(source) {
  if(source?.packageType === "velvet-vesper-native-story-package") return {type:"story-package",version:source.packageVersion};
  if (source?.version === "0.7") return { type: "noctis-v07", version: "0.7" };
  if (source?.format === "the-velvet-vesper-vault") {
    return { type: "vesper", version: source.schemaVersion };
  }
  return { type: "unknown", version: null };
}

export function previewImport(source) {
  const detected = detectImportSource(source);
  if(detected.type === "story-package") {
    try { return prepareImport(source).preview; }
    catch(error) { return {detected,valid:false,errors:[error.message]}; }
  }
  if (detected.type === "noctis-v07") {
    const validation=validateNoctisBackup(source);
    if(!validation.ok)return {detected,valid:false,errors:validation.errors};
    return { detected, valid:true, ...inspectNoctisV07(source) };
  }
  if (detected.type === "vesper") {
    const validation = validateVesperBackup(source);
    return {
      detected,
      valid: validation.ok,
      errors: validation.errors,
      counts: Object.fromEntries(
        Object.entries(source).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])
      )
    };
  }
  return { detected, valid: false, errors: ["Unsupported backup format."] };
}

export function prepareImport(source) {
  const detected = detectImportSource(source);
  if(detected.type === "story-package") {
    if(source.packageVersion!=="1.0" || source.vesperSchemaVersion!==1 || source.importMode!=="additive-only")
      throw new Error("Unsupported story-package version or mode. Nothing was changed.");
    const incoming=emptyVault();
    for(const key of ARRAY_KEYS) {
      if(!Array.isArray(source[key]))throw new Error(`Story package is missing its ${key} collection. Nothing was changed.`);
      incoming[key]=structuredClone(source[key]);
    }
    if(!incoming.stories.length)throw new Error("The story package contains no stories. Nothing was changed.");
    requireValidBackup(validateVesperBackup(incoming),"story package");
    return {vault:incoming,preview:{detected,valid:true,counts:Object.fromEntries(ARRAY_KEYS.map(key=>[key,incoming[key].length]))},warnings:[],importMode:"merge"};
  }

  if (detected.type === "noctis-v07") {
    requireValidBackup(validateNoctisBackup(source),"Noctis");
    const prepared=migrateNoctisV07(source);
    requireValidBackup(validateVesperBackup(prepared.vault),"migrated Noctis");
    return prepared;
  }
  if (detected.type === "vesper") {
    requireValidBackup(validateVesperBackup(source),"Vesper");
    return { vault: structuredClone(source), preview: { detected, valid: true, counts: Object.fromEntries(ARRAY_KEYS.map(key=>[key,source[key]?.length||0])) }, warnings: [], importMode: "replace" };
  }
  throw new Error("Unsupported backup format. Nothing was changed.");
}

function isSameNoctisImport(currentVault, incomingVault) {
  const incoming=(incomingVault.migrationLog||[]).find(entry=>entry.source==="Noctis");
  if(!incoming?.sourceExportedAt)return false;
  return (currentVault.migrationLog||[]).some(entry=>
    entry.source==="Noctis" &&
    entry.sourceVersion===incoming.sourceVersion &&
    entry.sourceExportedAt===incoming.sourceExportedAt
  );
}

export function mergeVaults(currentVault, incomingVault, now=new Date().toISOString()) {
  const current=normalizeVault(structuredClone(currentVault));
  const incoming=normalizeVault(structuredClone(incomingVault));
  if(isSameNoctisImport(current,incoming))throw new Error("This exact Noctis backup has already been imported into Vesper.");

  const next={...current};
  for(const key of ARRAY_KEYS)next[key]=[...(current[key]||[]),...(incoming[key]||[])];
  next.createdAt=current.createdAt||incoming.createdAt||now;
  next.updatedAt=now;
  return next;
}

export async function commitPreparedImport(db, prepared, {expectedRevision} = {}) {
  if (!prepared?.vault) throw new Error("No prepared import to commit.");
  requireValidBackup(validateVesperBackup(prepared.vault),"Vesper");
  if(!["merge","replace"].includes(prepared.importMode))throw new Error("Invalid backup import mode. Nothing was changed.");
  if(prepared.importMode==="merge"){
    const current=await loadVault(db);
    const merged=mergeVaults(current,prepared.vault);
    requireValidBackup(validateVesperBackup(merged),"merged Vesper");
    return saveVaultAtomic(db,merged,{expectedRevision:expectedRevision??current.storageRevision});
  }
  return replaceVaultAtomic(db, prepared.vault,{expectedRevision});
}

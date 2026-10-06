import { detectNoctisV07, inspectNoctisV07, migrateNoctisV07 } from "./noctis-v07.js";
import { validateVault } from "../schema.js";
import { replaceVaultAtomic } from "../storage/vault-store.js";

export function detectImportSource(source) {
  if (detectNoctisV07(source)) return { type: "noctis-v07", version: "0.7" };
  if (source?.format === "the-velvet-vesper-vault") {
    return { type: "vesper", version: source.schemaVersion };
  }
  return { type: "unknown", version: null };
}

export function previewImport(source) {
  const detected = detectImportSource(source);
  if (detected.type === "noctis-v07") return { detected, ...inspectNoctisV07(source) };
  if (detected.type === "vesper") {
    const validation = validateVault(source);
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
  if (detected.type === "noctis-v07") return migrateNoctisV07(source);
  if (detected.type === "vesper") {
    const validation = validateVault(source);
    if (!validation.ok) throw new Error(validation.errors.join(" "));
    return { vault: structuredClone(source), preview: previewImport(source), warnings: [] };
  }
  throw new Error("Unsupported backup format. Nothing was changed.");
}

export async function commitPreparedImport(db, prepared) {
  if (!prepared?.vault) throw new Error("No prepared import to commit.");
  return replaceVaultAtomic(db, prepared.vault);
}

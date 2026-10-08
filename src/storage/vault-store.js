import { emptyVault, validateVault, normalizeVault } from "../schema.js";
export const VESPER_DB_NAME="velvet-vesper";export const VESPER_DB_VERSION=1;const STORE="vault";
const saveListeners=new Set();
// Notification-only observers run after a successful commit. Listener failures
// must never turn a committed save into an apparent persistence failure.
export function subscribeVaultSaves(listener){saveListeners.add(listener);return ()=>saveListeners.delete(listener);}
function notifySaved(db,vault,kind){for(const listener of saveListeners){try{listener({dbName:db.name,vault:structuredClone(vault),kind});}catch{}}}
function requestAsPromise(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function transactionDone(t){return new Promise((resolve,reject)=>{t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error||new Error("Transaction aborted. Your saved data was kept."));t.onabort=()=>reject(t.error||new Error("Transaction aborted."));});}
export async function openVesperDb(){if(!globalThis.indexedDB)throw new Error("IndexedDB is unavailable on this device.");const r=indexedDB.open(VESPER_DB_NAME,VESPER_DB_VERSION);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);};return requestAsPromise(r);}
// Revisions are device-local metadata, not portable story/backup data.
function revisionOf(value){if(value==null)return 0;if(!Number.isSafeInteger(value)||value<0)throw new Error("Invalid vault storage revision. Nothing was changed.");return value;}
function attachRevision(vault,revision){Object.defineProperty(vault,"storageRevision",{value:revision,writable:true,configurable:true,enumerable:false});return vault;}
export class VaultConflictError extends Error {
 constructor(expectedRevision,actualRevision){super("The vault changed in another tab or save. Reload the latest vault before retrying; saved data was not changed by this attempt.");this.name="VaultConflictError";this.code="VESPER_VAULT_CONFLICT";this.refreshRequired=true;this.expectedRevision=expectedRevision;this.actualRevision=actualRevision;}
}
export async function loadVault(db){
 const tx=db.transaction(STORE,"readonly"),done=transactionDone(tx),store=tx.objectStore(STORE);
 const [raw,revision]=await Promise.all([requestAsPromise(store.get("active")),requestAsPromise(store.get("revision")),done]);
 if(!raw)return attachRevision(emptyVault(),revisionOf(revision));
 const validation=validateVault(raw);if(!validation.ok)throw new Error(`Invalid Vesper vault: ${validation.errors.join(" ")}`);
 return attachRevision(normalizeVault(raw),revisionOf(revision));
}
async function persistVault(db,vault,kind,expectedRevision,clear=false){
 const normalized=normalizeVault(vault),validation=validateVault(normalized);
 if(!validation.ok)throw new Error(`Refusing to save invalid vault: ${validation.errors.join(" ")}`);
 // Freeze the proposed content and base revision before opening the transaction.
 const proposed=structuredClone(normalized);delete proposed.storageRevision;
 if(expectedRevision!==undefined)revisionOf(expectedRevision);
 const tx=db.transaction(STORE,"readwrite"),done=transactionDone(tx),store=tx.objectStore(STORE);
 let conflict=null,nextRevision;
 const request=store.get("revision");
 request.onsuccess=()=>{
  try{
   const actual=revisionOf(request.result);
   if(expectedRevision!==actual){conflict=new VaultConflictError(expectedRevision??null,actual);tx.abort();return;}
   if(actual===Number.MAX_SAFE_INTEGER)throw new Error("Vault revision limit reached. Nothing was changed.");
   nextRevision=actual+1;
   if(clear)store.delete("active");else store.put(proposed,"active");
   store.put(nextRevision,"revision");
  }catch(error){conflict=error;tx.abort();}
 };
 try{await done;}catch(error){throw conflict||error;}
 attachRevision(vault,nextRevision);attachRevision(normalized,nextRevision);
 notifySaved(db,normalized,kind);return normalized;
}
export async function saveVaultAtomic(db,vault,{expectedRevision=vault.storageRevision}={}){
 // An unversioned snapshot cannot replace an existing vault, including legacy
 // revision-zero data. Fresh initialization must first load the empty vault.
 return persistVault(db,vault,"save",expectedRevision);
}
export async function replaceVaultAtomic(db,nextVault,{expectedSchemaVersion=1,expectedRevision}={}){
 if(nextVault.schemaVersion!==expectedSchemaVersion)throw new Error("Schema version changed during import; active vault was not modified.");
 const base=expectedRevision??nextVault.storageRevision??(await loadVault(db)).storageRevision;
 return persistVault(db,nextVault,"replace",base);
}
export async function clearVault(db,{expectedRevision}={}){
 const base=expectedRevision===undefined?(await loadVault(db)).storageRevision:expectedRevision;
 await persistVault(db,emptyVault(),"replace",base,true);
}

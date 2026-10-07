import { emptyVault, validateVault, normalizeVault } from "../schema.js";
export const VESPER_DB_NAME="velvet-vesper";export const VESPER_DB_VERSION=1;const STORE="vault";
const saveListeners=new Set();
// Notification-only observers run after a successful commit. Listener failures
// must never turn a committed save into an apparent persistence failure.
export function subscribeVaultSaves(listener){saveListeners.add(listener);return ()=>saveListeners.delete(listener);}
function notifySaved(db,vault,kind){for(const listener of saveListeners){try{listener({dbName:db.name,vault:structuredClone(vault),kind});}catch{}}}
function requestAsPromise(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function transactionDone(t){return new Promise((resolve,reject)=>{t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error("Transaction aborted."));});}
export async function openVesperDb(){if(!globalThis.indexedDB)throw new Error("IndexedDB is unavailable on this device.");const r=indexedDB.open(VESPER_DB_NAME,VESPER_DB_VERSION);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);};return requestAsPromise(r);}
export async function loadVault(db){const tx=db.transaction(STORE,"readonly");const raw=await requestAsPromise(tx.objectStore(STORE).get("active"));await transactionDone(tx);if(!raw)return emptyVault();const validation=validateVault(raw);if(!validation.ok)throw new Error(`Invalid Vesper vault: ${validation.errors.join(" ")}`);return normalizeVault(raw);}
async function persistVault(db,vault,kind){const normalized=normalizeVault(vault),validation=validateVault(normalized);if(!validation.ok)throw new Error(`Refusing to save invalid vault: ${validation.errors.join(" ")}`);const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(structuredClone(normalized),"active");await transactionDone(tx);notifySaved(db,normalized,kind);return normalized;}
export async function saveVaultAtomic(db,vault){return persistVault(db,vault,"save");}
export async function replaceVaultAtomic(db,nextVault,{expectedSchemaVersion=1}={}){if(nextVault.schemaVersion!==expectedSchemaVersion)throw new Error("Schema version changed during import; active vault was not modified.");return persistVault(db,nextVault,"replace");}
export async function clearVault(db){const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete("active");await transactionDone(tx);}

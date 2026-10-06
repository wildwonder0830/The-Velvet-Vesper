import { emptyVault, validateVault } from "../schema.js";

export const VESPER_DB_NAME = "velvet-vesper";
export const VESPER_DB_VERSION = 1;
const STORE = "vault";

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted."));
  });
}

export async function openVesperDb() {
  if (!globalThis.indexedDB) throw new Error("IndexedDB is unavailable on this device.");
  const request = indexedDB.open(VESPER_DB_NAME, VESPER_DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
  };
  return requestAsPromise(request);
}

export async function loadVault(db) {
  const tx = db.transaction(STORE, "readonly");
  const vault = await requestAsPromise(tx.objectStore(STORE).get("active"));
  await transactionDone(tx);
  if (!vault) return emptyVault();
  const validation = validateVault(vault);
  if (!validation.ok) throw new Error(`Invalid Vesper vault: ${validation.errors.join(" ")}`);
  return vault;
}

export async function saveVaultAtomic(db, vault) {
  const validation = validateVault(vault);
  if (!validation.ok) throw new Error(`Refusing to save invalid vault: ${validation.errors.join(" ")}`);

  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(structuredClone(vault), "active");
  await transactionDone(tx);
  return vault;
}

export async function replaceVaultAtomic(db, nextVault, { expectedSchemaVersion = 1 } = {}) {
  if (nextVault.schemaVersion !== expectedSchemaVersion) {
    throw new Error("Schema version changed during import; active vault was not modified.");
  }
  return saveVaultAtomic(db, nextVault);
}

export async function clearVault(db) {
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete("active");
  await transactionDone(tx);
}

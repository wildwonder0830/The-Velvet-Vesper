import { validateVault } from "../schema.js";
import { validateVesperBackup, requireValidBackup } from "./backup-validation.js";
const VESPER_APP_VERSION = "1.1.1";

const SECRET_KEYS = new Set([
  "apiKey", "api_key", "openRouterKey", "openrouterKey", "authorization", "token", "secret"
]);

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEYS.has(key))
      .map(([key, child]) => [key, stripSecrets(child)])
  );
}

export function buildPortableBackup(vault, now = new Date().toISOString()) {
  const validation = validateVault(vault);
  if (!validation.ok) throw new Error(`Cannot export invalid vault: ${validation.errors.join(" ")}`);

  const clean = stripSecrets(structuredClone(vault));
  clean.appVersion = VESPER_APP_VERSION;
  clean.exportedAt = now;
  clean.backupSchema = 1;
  clean.secretsExcluded = true;
  return clean;
}

export function serializePortableBackup(vault) {
  return JSON.stringify(buildPortableBackup(vault), null, 2);
}

export function parseVesperBackup(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("Invalid Vesper backup JSON. The file is incomplete or damaged. Nothing was changed."); }
  requireValidBackup(validateVesperBackup(parsed),"Vesper");
  return parsed;
}

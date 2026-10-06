export const VESPER_SCHEMA_VERSION = 1;

export const scopes = Object.freeze(["global", "persona", "character", "story"]);

export function makeId(prefix = "vv") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function emptyVault(now = new Date().toISOString()) {
  return {
    format: "the-velvet-vesper-vault",
    schemaVersion: VESPER_SCHEMA_VERSION,
    appVersion: "1.0.0-dev",
    createdAt: now,
    updatedAt: now,
    personas: [],
    characters: [],
    stories: [],
    chats: [],
    messages: [],
    loreEntries: [],
    memoryEntries: [],
    milestones: [],
    relationships: [],
    statDefinitions: [],
    statEvents: [],
    sceneStates: [],
    knowledgeEntries: [],
    migrationLog: []
  };
}

export function validateVault(vault) {
  const errors = [];
  if (!vault || typeof vault !== "object") errors.push("Vault must be an object.");
  if (vault?.format !== "the-velvet-vesper-vault") errors.push("Unknown vault format.");
  if (vault?.schemaVersion !== VESPER_SCHEMA_VERSION) errors.push("Unsupported schema version.");
  return { ok: errors.length === 0, errors };
}

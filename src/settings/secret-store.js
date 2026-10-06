const PREFIX = "vesper.secret.";

function requireStorage() {
  if (!globalThis.localStorage) throw new Error("Local secret storage is unavailable.");
  return globalThis.localStorage;
}

export function getDeviceSecret(name) {
  return requireStorage().getItem(PREFIX + name);
}

// The OpenRouter key has one intentional write path. Blank values are rejected
// and ordinary settings/import/backup code has no generic setter to call.
export function replaceOpenRouterKey(value) {
  const key = String(value || "").trim();
  if (!key) throw new Error("A blank API key cannot replace the stored key.");
  requireStorage().setItem(PREFIX + DEVICE_SECRET_NAMES.OPENROUTER_API_KEY, key);
  return true;
}

// Destructive removal is deliberately not exported. If we ever add a
// "Forget API key" feature, it should require its own explicit confirmation path.
export const DEVICE_SECRET_NAMES = Object.freeze({
  OPENROUTER_API_KEY: "openrouter-api-key"
});

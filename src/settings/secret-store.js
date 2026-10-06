const PREFIX = "vesper.secret.";

function requireStorage() {
  if (!globalThis.localStorage) throw new Error("Local secret storage is unavailable.");
  return globalThis.localStorage;
}

export function setDeviceSecret(name, value) {
  const storage = requireStorage();
  if (!value) storage.removeItem(PREFIX + name);
  else storage.setItem(PREFIX + name, value);
}

export function getDeviceSecret(name) {
  return requireStorage().getItem(PREFIX + name);
}

export function removeDeviceSecret(name) {
  requireStorage().removeItem(PREFIX + name);
}

// Secrets deliberately live outside the Vesper vault so ordinary export/import
// cannot accidentally copy them into a backup or GitHub repository.
export const DEVICE_SECRET_NAMES = Object.freeze({
  OPENROUTER_API_KEY: "openrouter-api-key"
});

import { getDeviceSecret, DEVICE_SECRET_NAMES } from "../settings/secret-store.js";

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export function getOpenRouterKey() {
  const key = getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY);
  if (!key) throw new Error("OpenRouter API key is not configured on this device.");
  return key;
}

export function buildOpenRouterRequest({ model, messages, temperature = 0.9, maxTokens = 1200 }) {
  if (!model) throw new Error("Model is required.");
  return {
    model,
    messages,
    temperature,
    max_tokens: maxTokens
  };
}

export async function sendOpenRouterChat({ model, messages, temperature, maxTokens, signal }) {
  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getOpenRouterKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildOpenRouterRequest({ model, messages, temperature, maxTokens })),
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const primary=data?.error?.message||`OpenRouter request failed (${response.status}).`;
    const raw=data?.error?.metadata?.raw||data?.error?.metadata?.message||data?.error?.metadata?.provider_error||"";
    const provider=data?.error?.metadata?.provider_name||data?.error?.metadata?.provider||"";
    const detail=[provider&&`provider: ${provider}`,raw].filter(Boolean).join(" · ");
    const error=new Error(detail?`${primary} — ${detail}`:primary);
    error.status=response.status;
    error.providerPayload=data?.error||null;
    throw error;
  }
  return data;
}

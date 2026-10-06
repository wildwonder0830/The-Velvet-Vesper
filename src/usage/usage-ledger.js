import { makeId } from "../schema.js";

export function recordUsage({ storyId = null, chatId = null, model, promptTokens = 0, completionTokens = 0, cost = null, provider = "openrouter" }, now = new Date().toISOString()) {
  return {
    id: makeId("usage"), storyId, chatId, model, provider,
    promptTokens, completionTokens, totalTokens: promptTokens + completionTokens,
    cost, createdAt: now
  };
}

export function summarizeUsage(entries, since = null) {
  const rows = (entries || []).filter(e => !since || new Date(e.createdAt) >= new Date(since));
  return rows.reduce((sum,e) => ({
    requests: sum.requests + 1,
    promptTokens: sum.promptTokens + (e.promptTokens || 0),
    completionTokens: sum.completionTokens + (e.completionTokens || 0),
    totalTokens: sum.totalTokens + (e.totalTokens || 0),
    knownCost: sum.knownCost + (typeof e.cost === "number" ? e.cost : 0)
  }), { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, knownCost: 0 });
}

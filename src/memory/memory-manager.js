import { makeId } from "../schema.js";

export const MEMORY_KINDS = Object.freeze(["canon","relationship","summary","scene","character","user-directive"]);

export function createMemory({ storyId, chatId = null, scope = "story", kind, text = "", data = null, sourceMessageIds = [], pinned = false }, now = new Date().toISOString()) {
  if (!storyId || !MEMORY_KINDS.includes(kind)) throw new Error("Invalid memory.");
  return {
    id: makeId("memory"), storyId, chatId, scope, kind, text, data,
    sourceMessageIds: [...new Set(sourceMessageIds)], pinned: Boolean(pinned),
    status: "active", createdAt: now, updatedAt: now
  };
}

export function activeMemory(entries, storyId) {
  return (entries || []).filter(m => m.storyId === storyId && m.status === "active");
}

export function forgetMemory(entries, memoryId, reason = "", now = new Date().toISOString()) {
  return (entries || []).map(m => m.id === memoryId
    ? { ...m, status: "forgotten", forgottenAt: now, forgetReason: reason, updatedAt: now }
    : m);
}

export function replaceSummary(entries, storyId, chatId, summary, sourceMessageIds = [], now = new Date().toISOString()) {
  const retired = (entries || []).map(m =>
    m.storyId === storyId && m.chatId === chatId && m.kind === "summary" && m.status === "active"
      ? { ...m, status: "superseded", supersededAt: now, updatedAt: now }
      : m
  );
  return [...retired, createMemory({ storyId, chatId, kind: "summary", text: summary, sourceMessageIds }, now)];
}

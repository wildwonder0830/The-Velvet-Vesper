import { makeId } from "../schema.js";

export function recordKnowledge({ storyId, knowerId, subjectId = null, factKey, value, sourceMessageId = null, learnedAt = null }, now = new Date().toISOString()) {
  if (!storyId || !knowerId || !factKey) throw new Error("Knowledge entry requires storyId, knowerId, and factKey.");
  return {
    id: makeId("knowledge"),
    storyId,
    knowerId,
    subjectId,
    factKey,
    value,
    sourceMessageId,
    learnedAt: learnedAt || now,
    createdAt: now,
    updatedAt: now
  };
}

export function whatCharacterKnows(entries, storyId, knowerId) {
  return (entries || []).filter(entry => entry.storyId === storyId && entry.knowerId === knowerId);
}

export function knows(entries, { storyId, knowerId, factKey }) {
  return (entries || []).some(entry => entry.storyId === storyId && entry.knowerId === knowerId && entry.factKey === factKey);
}

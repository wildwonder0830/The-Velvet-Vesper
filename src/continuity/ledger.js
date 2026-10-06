import { makeId } from "../schema.js";

export const FACT_STATUS = Object.freeze({ CONFIRMED: "confirmed", RETCONNED: "retconned", DISPUTED: "disputed" });

export function createContinuityFact({ storyId, subjectIds = [], category, key, value, sourceMessageId = null, confidence = 1 }, now = new Date().toISOString()) {
  if (!storyId || !category || !key) throw new Error("Continuity fact requires storyId, category, and key.");
  return {
    id: makeId("canon"),
    storyId,
    subjectIds: [...new Set(subjectIds)],
    category,
    key,
    value,
    sourceMessageId,
    confidence,
    status: FACT_STATUS.CONFIRMED,
    createdAt: now,
    updatedAt: now
  };
}

export function activeFacts(facts, storyId) {
  return (facts || []).filter(f => f.storyId === storyId && f.status === FACT_STATUS.CONFIRMED);
}

export function retconFact(facts, factId, replacement, now = new Date().toISOString()) {
  let original = null;
  const next = facts.map(fact => {
    if (fact.id !== factId) return fact;
    original = fact;
    return { ...fact, status: FACT_STATUS.RETCONNED, retconnedAt: now, updatedAt: now };
  });
  if (!original) throw new Error("Continuity fact not found.");
  if (!replacement) return next;
  return [...next, createContinuityFact({ ...replacement, storyId: original.storyId }, now)];
}

export function findContinuityConflicts(facts, candidate) {
  return (facts || []).filter(f =>
    f.storyId === candidate.storyId &&
    f.status === FACT_STATUS.CONFIRMED &&
    f.category === candidate.category &&
    f.key === candidate.key &&
    JSON.stringify(f.value) !== JSON.stringify(candidate.value)
  );
}

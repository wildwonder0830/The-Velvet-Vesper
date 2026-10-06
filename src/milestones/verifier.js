import { makeId } from "../schema.js";

const NEGATION = /\b(?:didn['’]?t|did not|never|not|almost|nearly|wanted to|thought about|imagined|dreamed|would have|could have)\b/i;

export function assessMilestoneCandidate(candidate, sourceText = "") {
  const text = String(sourceText);
  const warnings = [];
  if (NEGATION.test(text)) warnings.push("Possible negation, hypothetical, or near-event language.");
  return {
    ...candidate,
    verification: {
      deterministicConfidence: warnings.length ? 0.35 : 0.7,
      warnings,
      requiresContextVerification: candidate.requiresContextVerification !== false
    }
  };
}

export function confirmMilestone(candidate, { storyId, chatId, participants = [], evidence = "", occurredAt = null }, now = new Date().toISOString()) {
  if (!candidate?.key) throw new Error("Milestone candidate is missing a key.");
  return {
    id: makeId("milestone"),
    storyId,
    chatId,
    type: candidate.key,
    title: candidate.title || candidate.key.replaceAll("_", " "),
    participants: [...new Set(participants)],
    evidence,
    sourceMessageId: candidate.sourceMessageId || null,
    occurredAt,
    status: "confirmed",
    createdAt: now,
    updatedAt: now
  };
}

export function rejectMilestone(candidate, reason = "", now = new Date().toISOString()) {
  return { ...candidate, status: "rejected", rejectionReason: reason, updatedAt: now };
}

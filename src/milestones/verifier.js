import { makeId } from "../schema.js";

const NEGATION = /\b(?:didn['’]?t|did not|never|not|almost|nearly|wanted to|thought about|imagined|dreamed|would have|could have)\b/i;

export function assessMilestoneCandidate(candidate, sourceText = "") {
  const text = String(sourceText);
  const warnings = [];
  if (NEGATION.test(text)) warnings.push("Possible negation, hypothetical, or near-event language.");
  return {
    ...candidate,
    status: "candidate",
    verification: {
      deterministicConfidence: warnings.length ? 0.35 : 0.7,
      warnings,
      requiresContextVerification: true
    }
  };
}

export function confirmMilestone(candidate, { storyId, chatId, participants = [], evidence = "", occurredAt = null, vault, verification }, now = new Date().toISOString()) {
  if (!candidate?.key) throw new Error("Milestone candidate is missing a key.");
  const milestone = {
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
    verification,
    contradictsMilestoneId: candidate.contradictsMilestoneId || null,
    supersedesMilestoneId: candidate.supersedesMilestoneId || null,
    createdAt: now,
    updatedAt: now
  };
  if (!isUserVerified(verification)) throw new Error("Milestone requires explicit user verification of a completed event.");
  const validation = validateCanonicalMilestone(milestone, vault, { storyId, chatId });
  if (!validation.ok) throw new Error(`Milestone is not canonical: ${validation.errors.join(" ")}`);
  if (canonicalMilestones(vault, storyId, chatId).some(existing => milestoneEventKey(existing) === milestoneEventKey(milestone))) {
    throw new Error("This milestone event is already canonical; no relationship upgrade was made.");
  }
  return milestone;
}

export function rejectMilestone(candidate, reason = "", now = new Date().toISOString()) {
  return { ...candidate, status: "rejected", rejectionReason: reason, updatedAt: now };
}

const CANONICAL_STATUSES = new Set(["confirmed", "verified", "completed", "confirmed-imported"]);
const NON_EVENT = /\b(?:not|never|almost|nearly|didn['’]?t|did not|wanted to|thought about|imagined|dreamed|would|could|might|may|will|suggest(?:ed|ion)?|predict(?:s|ed)?|hypothetical|provisional)\b/i;
const COMPLETED_EVENT = {
  first_kiss: /\b(?:kissed|(?:shared|had|completed|exchanged)[\s\S]*kiss|first kiss[\s\S]*(?:happened|occurred))\b/i,
  first_date: /\b(?:went|had|completed)\b[\s\S]*\bdate\b/i,
  relationship_official: /\b(?:are|became|we're|we are)\b[\s\S]*\b(?:together|official|partners|boyfriend|girlfriend)\b/i,
  love_confession: /\b(?:i love you|confessed[\s\S]*love)\b/i,
  mated: /\b(?:completed[\s\S]*(?:mate bond|bond)|(?:mate bond|bond)[\s\S]*completed|(?:are|became|were) mated)\b/i
};
const ids = entry => entry?.participants || entry?.participantIds || [];
const sameParticipants = (a, b) => Array.isArray(a) && Array.isArray(b) &&
  JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
const isUserVerified = verification => verification?.verified === true &&
  verification?.completed === true && verification?.verifiedBy === "user";

export function validateCanonicalMilestone(milestone, vault, { storyId, chatId } = {}) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!milestone || !vault) return { ok: false, errors: ["Milestone evidence and its owning vault are required."] };
  const story = (vault.stories || []).find(s => s.id === milestone.storyId);
  const chat = (vault.chats || []).find(c => c.id === milestone.chatId && c.storyId === milestone.storyId);
  if (!story || !chat || (storyId != null && milestone.storyId !== storyId) ||
    (chatId != null && milestone.chatId !== chatId)) fail("Evidence must belong to the requested story and chat.");
  if (!CANONICAL_STATUSES.has(milestone.status) || !milestone.id || !milestone.type ||
    milestone.provisional || milestone.inferred || milestone.suggested || milestone.deleted || milestone.excluded ||
    milestone.verification?.verified === false || milestone.verification?.completed === false ||
    milestone.completed === false || milestone.verified === false) fail("Milestone is not verified and completed.");
  if ((vault.milestones || []).filter(m => m?.id === milestone.id).length > 1) fail("Duplicate milestone IDs make the evidence ambiguous.");
  if (milestone.legacy?.status && !CANONICAL_STATUSES.has(milestone.legacy.status)) fail("Imported provisional history is not canonical evidence.");
  if (milestone.contradictsMilestoneId || milestone.supersedesMilestoneId || milestone.value === false) fail("Contradictory milestones require an explicit retcon, not an automatic upgrade.");
  const participants = ids(milestone);
  const allowed = new Set([story?.personaId, story?.primaryCharacterId, ...(story?.characterIds || [])].filter(Boolean));
  if (!Array.isArray(participants) || participants.length < (COMPLETED_EVENT[milestone.type] ? 2 : 1) ||
    new Set(participants).size !== participants.length || participants.some(id => !allowed.has(id) ||
      ![...(vault.personas || []), ...(vault.characters || [])].some(record => record.id === id))) fail("Milestone participants must be explicit identities owned by this story.");
  const evidence = typeof milestone.evidence === "string" ? milestone.evidence.trim() : "";
  if (!evidence || NON_EVENT.test(evidence) || /\?/.test(evidence)) fail("Evidence must describe a completed event, not a negation, prediction, or suggestion.");
  const userVerified = isUserVerified(milestone.verification);
  const source = (vault.messages || []).find(m => m.id === milestone.sourceMessageId);
  if (milestone.sourceMessageId) {
    if (!source || source.storyId !== milestone.storyId || source.chatId !== milestone.chatId ||
      source.provisional || source.status === "draft") fail("Source message ownership does not match the milestone.");
    if (!source || typeof source.text !== "string" || (!userVerified && !source.text.includes(evidence))) fail("Quoted evidence must exist in its source message.");
    if (!userVerified && source?.role !== "user") fail("Model output requires explicit user verification before becoming canon.");
    if (source?.participantIds && (!Array.isArray(source.participantIds) || !Array.isArray(participants) ||
      participants.some(id => !source.participantIds.includes(id)))) fail("Source evidence belongs to different participants.");
    if (!userVerified && !source?.participantIds && Array.isArray(participants) && participants.some(id => {
      const record = [...(vault.personas || []), ...(vault.characters || [])].find(row => row.id === id);
      return !record?.name || !evidence.toLowerCase().includes(record.name.toLowerCase());
    })) fail("Source evidence does not identify the milestone participants.");
  } else if (!userVerified) fail("A source message or explicit user-verified historical evidence is required.");
  if (!userVerified && (milestone.verification?.requiresContextVerification ||
    ["scanner", "model", "summary", "repair", "inferred"].includes(milestone.source))) fail("Detection or model inference is not canonical verification.");
  if (!userVerified && !COMPLETED_EVENT[milestone.type]?.test(evidence)) fail("Explicit completed-event verification is required.");
  return { ok: errors.length === 0, errors };
}

function milestoneEventKey(milestone) {
  return JSON.stringify([milestone.storyId, milestone.chatId, milestone.type, [...ids(milestone)].sort(),
    milestone.sourceMessageId || milestone.evidence]);
}

export function canonicalMilestones(vault, storyId, chatId = null) {
  const seen = new Set();
  return (vault?.milestones || []).filter(milestone => {
    // Permanent milestone canon is story-scoped. Its original evidence chat
    // still has to exist and own the source; transient chat scope is explicit.
    if (!validateCanonicalMilestone(milestone, vault, { storyId }).ok ||
      (milestone.scope === "chat" && milestone.chatId !== chatId)) return false;
    const key = milestoneEventKey(milestone);
    if (seen.has(key)) return false;
    seen.add(key);return true;
  });
}

export function milestoneDerivedRecordIsCanonical(record, vault, storyId, chatId) {
  if (record?.stage && (record.provisional || record.inferred ||
    ["candidate", "proposed", "provisional", "inferred", "suggested", "pending", "disputed", "rejected"].includes(record.status) ||
    (["model", "scanner", "summary", "repair"].includes(record.source) && !isUserVerified(record.verification)))) return false;
  const references = [record?.sourceMilestoneId, record?.milestoneId, record?.data?.sourceMilestoneId,
    ...(Array.isArray(record?.sourceMilestoneIds) ? record.sourceMilestoneIds : [])].filter(Boolean);
  if (record?.sourceMilestoneIds != null && !Array.isArray(record.sourceMilestoneIds)) return false;
  return references.every(id => canonicalMilestones(vault, storyId, chatId).some(milestone => milestone.id === id &&
    (!record.participantIds || sameParticipants(record.participantIds, ids(milestone)))));
}

export function milestoneSupportsRelationship(milestone, relationship, stage) {
  const typeForStage = { dating: "first_date", committed: "relationship_official", engaged: "engaged", married: "married", bonded: "mated", mated: "mated" };
  return Boolean(milestone && relationship && milestone.storyId === relationship.storyId &&
    (!relationship.chatId || relationship.chatId === milestone.chatId) &&
    sameParticipants(ids(milestone), relationship.participantIds) &&
    (!stage || typeForStage[stage] === milestone.type));
}

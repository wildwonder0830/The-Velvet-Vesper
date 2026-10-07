import { makeId } from "../schema.js";
import { canonicalMilestones, milestoneSupportsRelationship } from "../milestones/verifier.js";

export const RELATIONSHIP_STAGES = Object.freeze([
  "strangers","acquaintances","friends","dating","committed","engaged","married","bonded","mated","fated"
]);

export function createRelationship({ storyId, participantIds, stage = "strangers", labels = [], establishedFacts = [] }, now = new Date().toISOString()) {
  if (!storyId) throw new Error("Relationship requires storyId.");
  if (!Array.isArray(participantIds) || participantIds.length < 2) throw new Error("Relationship requires at least two participants.");
  return {
    id: makeId("relationship"),
    storyId,
    participantIds: [...new Set(participantIds)],
    stage,
    labels: [...new Set(labels)],
    establishedFacts: establishedFacts.map(fact => normalizeFact(fact, now)),
    createdAt: now,
    updatedAt: now
  };
}

function normalizeFact(fact, now) {
  return typeof fact === "string"
    ? { id: makeId("fact"), text: fact, status: "confirmed", createdAt: now }
    : { id: fact.id || makeId("fact"), status: "confirmed", createdAt: fact.createdAt || now, ...fact };
}

export function addEstablishedFact(relationship, fact, now = new Date().toISOString()) {
  const normalized = normalizeFact(fact, now);
  return { ...relationship, establishedFacts: [...(relationship.establishedFacts || []), normalized], updatedAt: now };
}

export function setRelationshipStage(relationship, stage, now = new Date().toISOString(), { vault, milestoneId } = {}) {
  if (!RELATIONSHIP_STAGES.includes(stage)) throw new Error("Unknown relationship stage.");
  if (stage !== relationship.stage && ["dating", "committed", "engaged", "married", "bonded", "mated"].includes(stage) && milestoneId == null) {
    throw new Error("Relationship canon upgrades require verified milestone evidence.");
  }
  if (milestoneId != null) {
    const milestone = (vault?.milestones || []).find(m => m.id === milestoneId);
    const canonical = canonicalMilestones(vault, relationship.storyId, milestone?.chatId).find(m => m.id === milestoneId);
    if (!canonical || !milestoneSupportsRelationship(canonical, relationship, stage)) {
      throw new Error("Relationship stage requires a verified canonical milestone for the same participants and stage.");
    }
  }
  return { ...relationship, stage, updatedAt: now };
}

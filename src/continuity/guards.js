import { isMemoryVisible } from "../memory/memory-manager.js";
import { canonicalMilestones, milestoneDerivedRecordIsCanonical } from "../milestones/verifier.js";

export const CONTINUITY_GUARDS = Object.freeze([
  "Confirmed relationship stages and milestones are facts, not suggestions.",
  "Never describe a confirmed repeated event as a first-time event.",
  "Never make a character forget a fact present in that character's knowledge ledger unless an explicit story event caused the loss.",
  "Do not move a scene to a different location without narration, a scene command, or an explicit timeskip.",
  "Do not invent marks, injuries, possessions, pets, addresses, jobs, family relationships, or intimacy history to bridge missing context.",
  "Retcons must be explicit. New model output cannot silently overwrite confirmed canon.",
  "Milestone detection, suggestions, summaries, and repair text cannot establish relationship canon without verified completed-event evidence."
]);

export function continuityPrompt({ relationship, milestones = [], facts = [], knowledge = [], vault, storyId, chatId }) {
  const canonicalIds = new Set(canonicalMilestones(vault, storyId, chatId).map(m => m.id));
  const seen = new Set();
  return {
    guards: CONTINUITY_GUARDS,
    relationship: milestoneDerivedRecordIsCanonical(relationship, vault, storyId, chatId) ? relationship || null : null,
    confirmedMilestones: milestones.filter(m => {
      if (!canonicalIds.has(m.id) || seen.has(m.id)) return false;
      seen.add(m.id);return true;
    }),
    confirmedFacts: facts.filter(f => isMemoryVisible(f) && (f.status === "confirmed" || f.status === "active") && milestoneDerivedRecordIsCanonical(f, vault, storyId, chatId)),
    knowledge: knowledge.filter(k => milestoneDerivedRecordIsCanonical(k, vault, storyId, chatId))
  };
}

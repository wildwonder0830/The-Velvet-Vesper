export const CONTINUITY_GUARDS = Object.freeze([
  "Confirmed relationship stages and milestones are facts, not suggestions.",
  "Never describe a confirmed repeated event as a first-time event.",
  "Never make a character forget a fact present in that character's knowledge ledger unless an explicit story event caused the loss.",
  "Do not move a scene to a different location without narration, a scene command, or an explicit timeskip.",
  "Do not invent marks, injuries, possessions, pets, addresses, jobs, family relationships, or intimacy history to bridge missing context.",
  "Retcons must be explicit. New model output cannot silently overwrite confirmed canon."
]);

export function continuityPrompt({ relationship, milestones = [], facts = [], knowledge = [] }) {
  return {
    guards: CONTINUITY_GUARDS,
    relationship: relationship || null,
    confirmedMilestones: milestones.filter(m => m.status === "confirmed"),
    confirmedFacts: facts.filter(f => f.status === "confirmed" || f.status === "active"),
    knowledge
  };
}

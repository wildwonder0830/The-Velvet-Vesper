export const VESPER_HARD_RULES = Object.freeze([
  {
    id: "user-name-never-mandy",
    category: "identity",
    severity: "absolute",
    appliesTo: ["all-stories", "all-characters", "all-model-output"],
    rule: "The user-owned protagonist's name is Amanda. Manda is acceptable. Mandy is NEVER acceptable.",
    forbiddenTerms: ["Mandy"],
    allowedTerms: ["Amanda", "Manda"],
    behavior: {
      generation: "Never address, nickname, refer to, or describe Amanda as Mandy.",
      canonImport: "Treat any legacy profile, lore, memory, chat summary, or generated canon that says Mandy is an acceptable nickname as invalid canon.",
      conflictResolution: "This hard rule overrides character profiles, imported legacy text, inferred nicknames, model habits, and story-specific nickname fields.",
      validation: "Flag forbidden nickname occurrences in editable profile/canon fields before they enter prompt context."
    }
  }
]);

export function applyHardRuleSanitizers(text) {
  if (typeof text !== "string") return text;
  // Do not silently rename historical chat transcripts. This sanitizer is for
  // generated/editable prompt context, profiles, canon, and future model input.
  return text.replace(/\bMandy\b/g, "Amanda");
}

export function findHardRuleViolations(text) {
  if (typeof text !== "string") return [];
  const violations = [];
  if (/\bMandy\b/i.test(text)) {
    violations.push({
      ruleId: "user-name-never-mandy",
      term: "Mandy",
      message: "Forbidden nickname detected. Use Amanda (or Manda when appropriate)."
    });
  }
  return violations;
}

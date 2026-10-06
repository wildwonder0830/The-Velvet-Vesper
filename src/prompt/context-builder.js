import { applyHardRuleSanitizers, findHardRuleViolations, VESPER_HARD_RULES } from "../rules/hard-rules.js";

const byId = (items, id) => (items || []).find(item => item.id === id) || null;

function scopedLore(vault, story) {
  const characterIds = new Set(story.characterIds || []);
  if (story.primaryCharacterId) characterIds.add(story.primaryCharacterId);

  return (vault.loreEntries || []).filter(entry => {
    if (entry.scope === "global") return true;
    if (entry.scope === "story") return entry.storyId === story.id;
    if (entry.scope === "persona") return entry.personaId === story.personaId;
    if (entry.scope === "character") return characterIds.has(entry.characterId);
    return false;
  });
}

function storyMemory(vault, storyId) {
  return (vault.memoryEntries || []).filter(entry => entry.storyId === storyId);
}

export function buildStoryContext(vault, storyId) {
  const story = byId(vault.stories, storyId);
  if (!story) throw new Error("Story not found.");

  const persona = byId(vault.personas, story.personaId);
  const characterIds = new Set(story.characterIds || []);
  if (story.primaryCharacterId) characterIds.add(story.primaryCharacterId);
  const characters = (vault.characters || []).filter(c => characterIds.has(c.id));

  const context = {
    hardRules: VESPER_HARD_RULES,
    story,
    persona,
    characters,
    lore: scopedLore(vault, story),
    memory: storyMemory(vault, story.id),
    relationships: (vault.relationships || []).filter(r => r.storyId === story.id),
    milestones: (vault.milestones || []).filter(m => m.storyId === story.id && m.status !== "rejected"),
    sceneState: (vault.sceneStates || []).find(s => s.storyId === story.id) || null,
    knowledge: (vault.knowledgeEntries || []).filter(k => k.storyId === story.id)
  };

  return sanitizeContext(context);
}

function sanitizeContext(value) {
  if (typeof value === "string") return applyHardRuleSanitizers(value);
  if (Array.isArray(value)) return value.map(sanitizeContext);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeContext(child)]));
}

export function auditStoryContext(context) {
  const violations = [];
  const walk = (value, path = "context") => {
    if (typeof value === "string") {
      for (const violation of findHardRuleViolations(value)) violations.push({ ...violation, path });
      return;
    }
    if (Array.isArray(value)) return value.forEach((child, index) => walk(child, `${path}[${index}]`));
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
    }
  };
  walk(context);
  return violations;
}

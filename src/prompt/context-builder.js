import { applyHardRuleSanitizers, findHardRuleViolations, VESPER_HARD_RULES } from "../rules/hard-rules.js";
import { activeMemory, filterMemoryForModel } from "../memory/memory-manager.js";

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

function storyMemory(vault, storyId, chatId) {
  return activeMemory(vault.memoryEntries,storyId).filter(entry => {
    // These records describe a conversation's transient state, not shared canon.
    const chatScoped = ["scene", "summary", "legacy-story-stats"].includes(entry.kind) ||
      ["chat", "scene"].includes(entry.scope);
    return !chatScoped || Boolean(chatId && entry.chatId === chatId);
  });
}

export function buildStoryContext(vault, storyId, chatId = null) {
  const story = byId(vault.stories, storyId);
  if (!story) throw new Error("Story not found.");
  if (chatId != null && !(vault.chats || []).some(c => c.id === chatId && c.storyId === storyId)) {
    throw new Error("Chat not found in active story.");
  }

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
    memory: storyMemory(vault, story.id, chatId),
    relationships: (vault.relationships || []).filter(r => r.storyId === story.id),
    milestones: (vault.milestones || []).filter(m => m.storyId === story.id && m.status !== "rejected"),
    sceneState: chatId ? [...(vault.sceneStates || [])].filter(s => s.storyId === story.id && s.chatId === chatId && s.status !== "superseded").sort((a,b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0] || null : null,
    knowledge: (vault.knowledgeEntries || []).filter(k => k.storyId === story.id &&
      (k.chatId || ["legacy-ledger", "scene"].includes(k.kind) || ["chat", "scene"].includes(k.scope)
        ? Boolean(chatId && k.chatId === chatId) : true))
  };

  return sanitizeContext(filterMemoryForModel(context,vault.memoryEntries,storyId));
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

import {sourceAudienceVisible} from "../context/source-audience.js";
import { personaModelVault } from "../personas/persona-store.js";
import { projectEditedContext } from "../chat/message-edit.js";
import { applyHardRuleSanitizers, findHardRuleViolations, VESPER_HARD_RULES } from "../rules/hard-rules.js";
import { activeMemory, filterMemoryForModel } from "../memory/memory-manager.js";
import { canonicalMilestones, milestoneDerivedRecordIsCanonical } from "../milestones/verifier.js";

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

function relationshipOwnedBy(record, storyId, chatId, parent = null) {
  if (record?.storyId != null && record.storyId !== storyId) return false;
  const ownerChatId = record?.chatId ?? parent?.chatId;
  const chatScoped = ownerChatId != null || ["chat", "scene"].includes(record?.scope);
  return !chatScoped || Boolean(chatId && ownerChatId === chatId);
}

function relationshipSourcesVisible(record, vault, storyId, chatId) {
  const references = [record?.relationshipId, record?.data?.relationshipId].filter(id => id != null);
  return references.every(id => (vault.relationships || []).some(r => r.id === id &&
    r.storyId === storyId && relationshipOwnedBy(r, storyId, chatId) &&
    milestoneDerivedRecordIsCanonical(r, vault, storyId, chatId)));
}

export function buildStoryContext(vault, storyId, chatId = null, {recipientIds=null}={}) {
  vault = projectEditedContext(vault);
  const story = byId(vault.stories, storyId);
  if (!story) throw new Error("Story not found.");
  if (chatId != null && !(vault.chats || []).some(c => c.id === chatId && c.storyId === storyId)) {
    throw new Error("Chat not found in active story.");
  }

  vault=personaModelVault(vault,storyId);
  const effectiveStory=byId(vault.stories,storyId);
  const persona = byId(vault.personas, effectiveStory.personaId);
  const characterIds = new Set(story.characterIds || []);
  if (story.primaryCharacterId) characterIds.add(story.primaryCharacterId);
  const characters = (vault.characters || []).filter(c => characterIds.has(c.id));

  const context = {
    hardRules: VESPER_HARD_RULES,
    story:effectiveStory,
    persona,
    characters,
    lore: scopedLore(vault, effectiveStory),
    memory: storyMemory(vault, story.id, chatId).filter(m => relationshipSourcesVisible(m, vault, storyId, chatId) && milestoneDerivedRecordIsCanonical(m, vault, storyId, chatId)),
    relationships: (vault.relationships || []).filter(r => r.storyId === story.id && relationshipOwnedBy(r, storyId, chatId) && milestoneDerivedRecordIsCanonical(r, vault, storyId, chatId)).map(r =>
      Array.isArray(r.establishedFacts) ? { ...r, establishedFacts: r.establishedFacts.filter(f => relationshipOwnedBy(f, storyId, chatId, r) && relationshipSourcesVisible(f, vault, storyId, chatId) && milestoneDerivedRecordIsCanonical(f, vault, storyId, chatId)) } : r),
    milestones: canonicalMilestones(vault, storyId, chatId),
    sceneState: chatId ? [...(vault.sceneStates || [])].filter(s => s.storyId === story.id && s.chatId === chatId && s.status !== "superseded").sort((a,b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0] || null : null,
    knowledge: (vault.knowledgeEntries || []).filter(k => k.storyId === story.id &&
      (k.chatId || ["legacy-ledger", "scene"].includes(k.kind) || ["chat", "scene"].includes(k.scope)
        ? Boolean(chatId && k.chatId === chatId) : true) && relationshipSourcesVisible(k, vault, storyId, chatId) && milestoneDerivedRecordIsCanonical(k, vault, storyId, chatId))
  };

  const recipients=recipientIds??characters.map(c=>c.id),visible=record=>sourceAudienceVisible(record,vault,recipients);
  for(const key of ["memory","lore","relationships","milestones","knowledge"])context[key]=context[key].filter(visible);
  if(context.sceneState&&!visible(context.sceneState))context.sceneState=null;
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

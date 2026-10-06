import { emptyVault, makeId } from "../schema.js";

const clone = value => JSON.parse(JSON.stringify(value));

export function detectNoctisV07(source) {
  return Boolean(
    source &&
    source.version === "0.7" &&
    Array.isArray(source.personas) &&
    Array.isArray(source.characters)
  );
}

export function inspectNoctisV07(source) {
  if (!detectNoctisV07(source)) throw new Error("Not a Noctis v0.7 vault backup.");

  const counts = {
    personas: source.personas.length,
    characters: source.characters.length,
    chats: 0,
    messages: 0,
    loreEntries: 0,
    milestones: 0,
    castMembers: 0,
    beatEvents: 0
  };

  for (const character of source.characters) {
    counts.loreEntries += Array.isArray(character.lore) ? character.lore.length : 0;
    counts.castMembers += Array.isArray(character.castMembers) ? character.castMembers.length : 0;
    for (const chat of character.chats || []) {
      counts.chats++;
      counts.messages += (chat.messages || []).length;
      counts.milestones += (chat.milestones || []).length;
      counts.beatEvents += (chat.beatLog || []).length;
    }
  }

  return {
    sourceFormat: "noctis-vault",
    sourceVersion: source.version,
    exportedAt: source.exportedAt || null,
    settingsExcluded: Boolean(source.settingsExcluded),
    counts,
    warnings: source.settingsExcluded
      ? ["Noctis settings were excluded from this backup. Device/provider settings must be configured separately."]
      : []
  };
}

export function migrateNoctisV07(source, now = new Date().toISOString()) {
  const preview = inspectNoctisV07(source);
  const vault = emptyVault(now);
  const warnings = [...preview.warnings];

  const personaMap = new Map();
  for (const old of source.personas) {
    const id = makeId("persona");
    personaMap.set(old.id, id);
    vault.personas.push({
      id,
      legacyId: old.id || null,
      slot: old.slot ?? null,
      name: old.name || "Unnamed persona",
      profile: clone(old),
      createdAt: old.createdAt || old.updatedAt || now,
      updatedAt: old.updatedAt || now
    });
  }

  const characterMap = new Map();
  for (const old of source.characters) {
    const id = makeId("character");
    characterMap.set(old.id, id);
    vault.characters.push({
      id,
      legacyId: old.id || null,
      name: old.name || "Unnamed character",
      role: old.role || "",
      profile: clone({...old, chats: undefined, lore: undefined, castMembers: undefined}),
      createdAt: old.createdAt || now,
      updatedAt: old.updatedAt || now
    });
  }

  for (const oldCharacter of source.characters) {
    const characterId = characterMap.get(oldCharacter.id);

    for (const oldLore of oldCharacter.lore || []) {
      vault.loreEntries.push({
        id: makeId("lore"),
        scope: "character",
        characterId,
        storyId: null,
        title: oldLore.title || "Lore",
        body: oldLore.body || "",
        legacy: clone(oldLore),
        createdAt: now,
        updatedAt: now
      });
    }

    for (const oldChat of oldCharacter.chats || []) {
      const storyId = makeId("story");
      const chatId = makeId("chat");
      const personaId = personaMap.get(oldChat.activePersonaId) || null;

      vault.stories.push({
        id: storyId,
        legacyCharacterId: oldCharacter.id || null,
        title: oldCharacter.name || oldChat.title || "Imported story",
        primaryCharacterId: characterId,
        characterIds: [characterId],
        personaId,
        source: { app: "Noctis", version: source.version, chatId: oldChat.id || null },
        createdAt: oldChat.createdAt || oldCharacter.createdAt || now,
        updatedAt: oldChat.updatedAt || now
      });

      vault.chats.push({
        id: chatId,
        legacyId: oldChat.id || null,
        storyId,
        title: oldChat.title || "Main Story",
        createdAt: oldChat.createdAt || now,
        updatedAt: oldChat.updatedAt || now
      });

      const messageMap = new Map();
      (oldChat.messages || []).forEach((oldMessage, index) => {
        const messageId = makeId("message");
        if (oldMessage.id) messageMap.set(oldMessage.id, messageId);
        vault.messages.push({
          id: messageId,
          legacyId: oldMessage.id || null,
          storyId,
          chatId,
          role: oldMessage.role || "unknown",
          text: oldMessage.text || "",
          ordinal: index,
          metadata: clone({...oldMessage, id: undefined, role: undefined, text: undefined}),
          createdAt: oldMessage.createdAt || null
        });
      });

      if (oldChat.relationshipMemory) {
        vault.memoryEntries.push({
          id: makeId("memory"),
          storyId,
          chatId,
          scope: "story",
          kind: "relationship",
          text: oldChat.relationshipMemory,
          source: "noctis-import",
          createdAt: now,
          updatedAt: now
        });
      }
      if (oldChat.consolidatedMemory) {
        vault.memoryEntries.push({
          id: makeId("memory"),
          storyId,
          chatId,
          scope: "story",
          kind: "summary",
          text: oldChat.consolidatedMemory,
          source: "noctis-import",
          createdAt: now,
          updatedAt: now
        });
      }

      for (const oldMilestone of oldChat.milestones || []) {
        vault.milestones.push({
          id: makeId("milestone"),
          legacyId: oldMilestone.id || null,
          storyId,
          chatId,
          type: oldMilestone.type || "custom",
          title: oldMilestone.title || "Milestone",
          emoji: oldMilestone.emoji || "",
          participants: clone(oldMilestone.participants || []),
          evidence: oldMilestone.evidence || oldMilestone.text || oldMilestone.note || "",
          sourceMessageId: messageMap.get(oldMilestone.sourceMessageId) || null,
          occurredAt: oldMilestone.occurredAt || null,
          status: "confirmed-imported",
          legacy: clone(oldMilestone),
          createdAt: oldMilestone.createdAt || now,
          updatedAt: oldMilestone.updatedAt || now
        });
      }

      if (oldChat.scene) {
        vault.sceneStates.push({
          id: makeId("scene"),
          storyId,
          chatId,
          ...clone(oldChat.scene),
          presence: clone(oldChat.sceneCast || []),
          updatedAt: oldChat.scenePresenceUpdatedAt || oldChat.updatedAt || now
        });
      }

      if (oldChat.knowledgeLedger) {
        vault.knowledgeEntries.push({
          id: makeId("knowledge"),
          storyId,
          chatId,
          kind: "legacy-ledger",
          ledger: clone(oldChat.knowledgeLedger),
          createdAt: now,
          updatedAt: now
        });
      }

      if (oldChat.storyStats && Object.keys(oldChat.storyStats).length) {
        vault.memoryEntries.push({
          id: makeId("memory"),
          storyId,
          chatId,
          scope: "story",
          kind: "legacy-story-stats",
          data: clone(oldChat.storyStats),
          source: "noctis-import",
          createdAt: now,
          updatedAt: now
        });
      }
    }
  }

  vault.migrationLog.push({
    id: makeId("migration"),
    source: "Noctis",
    sourceVersion: source.version,
    sourceExportedAt: source.exportedAt || null,
    importedAt: now,
    preview,
    warnings
  });

  vault.updatedAt = now;
  return { vault, preview, warnings };
}

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

function chatHasSubstance(chat) {
  if (!chat) return false;
  if ((chat.messages || []).length) return true;
  if ((chat.milestones || []).length) return true;
  if (String(chat.relationshipMemory || "").trim()) return true;
  if (String(chat.consolidatedMemory || "").trim()) return true;
  if (Object.values(chat.scene || {}).some(value => String(value || "").trim())) return true;
  return false;
}

function chatsToImport(character) {
  const chats = Array.isArray(character?.chats) ? character.chats : [];
  const substantive = chats.filter(chatHasSubstance);
  if (substantive.length) return substantive;
  return chats.length ? [chats[0]] : [];
}

function usableCastMembers(character) {
  return (character?.castMembers || []).filter(member => {
    const name = String(member?.name || "").trim();
    if (!name || member?.legacyPrimaryMirror) return false;
    if (/^Noctis(?: Test Character)?$/i.test(name)) return false;
    return true;
  });
}

function stripCharacterContainer(old) {
  return clone({ ...old, chats: undefined, lore: undefined, castMembers: undefined });
}

function pushLore(vault, { scope, characterId = null, storyId = null, lore = [], now }) {
  for (const oldLore of lore || []) {
    vault.loreEntries.push({
      id: makeId("lore"),
      scope,
      characterId,
      storyId,
      title: oldLore.title || "Lore",
      body: oldLore.body || "",
      legacy: clone(oldLore),
      createdAt: now,
      updatedAt: now
    });
  }
}

export function inspectNoctisV07(source) {
  if (!detectNoctisV07(source)) throw new Error("Not a Noctis v0.7 vault backup.");

  const counts = {
    personas: source.personas.length,
    characters: source.characters.length,
    stories: 0,
    chats: 0,
    messages: 0,
    loreEntries: 0,
    milestones: 0,
    castMembers: 0,
    beatEvents: 0,
    skippedEmptyChats: 0
  };
  const storyTitles = [];

  for (const character of source.characters) {
    counts.loreEntries += Array.isArray(character.lore) ? character.lore.length : 0;
    counts.castMembers += usableCastMembers(character).length;
    const selectedChats = chatsToImport(character);
    counts.stories += selectedChats.length;
    counts.chats += selectedChats.length;
    counts.skippedEmptyChats += Math.max(0, (character.chats || []).length - selectedChats.length);
    for (const chat of selectedChats) {
      counts.messages += (chat.messages || []).length;
      counts.milestones += (chat.milestones || []).length;
      counts.beatEvents += (chat.beatLog || []).length;
      const suffix = selectedChats.length > 1 && chat.title ? ` — ${chat.title}` : "";
      storyTitles.push(`${character.name || "Imported story"}${suffix}`);
    }
  }

  return {
    sourceFormat: "noctis-vault",
    sourceVersion: source.version,
    exportedAt: source.exportedAt || null,
    settingsExcluded: Boolean(source.settingsExcluded),
    storyTitles,
    counts,
    warnings: [
      ...(source.settingsExcluded
        ? ["Noctis settings were excluded from this backup. Device/provider settings stay configured separately in Vesper."]
        : []),
      ...(counts.skippedEmptyChats
        ? [`${counts.skippedEmptyChats} empty placeholder chat(s) will be skipped so they do not become duplicate story cards.`]
        : [])
    ]
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

  const castMap = new Map();
  for (const old of source.characters) {
    const members = usableCastMembers(old);
    if (members.length > 1) {
      const ids = [];
      for (const member of members) {
        const id = makeId("character");
        ids.push(id);
        vault.characters.push({
          id,
          legacyId: member.id || null,
          legacyContainerId: old.id || null,
          name: member.name || "Unnamed character",
          role: member.role || "",
          profile: clone({ ...member, lore: undefined }),
          createdAt: member.createdAt || old.createdAt || now,
          updatedAt: member.updatedAt || old.updatedAt || now
        });
        pushLore(vault, { scope: "character", characterId: id, lore: member.lore || [], now });
      }
      castMap.set(old.id, ids);
    } else {
      const id = makeId("character");
      castMap.set(old.id, [id]);
      vault.characters.push({
        id,
        legacyId: old.id || null,
        name: old.name || "Unnamed character",
        role: old.role || "",
        profile: stripCharacterContainer(old),
        createdAt: old.createdAt || now,
        updatedAt: old.updatedAt || now
      });
      pushLore(vault, { scope: "character", characterId: id, lore: old.lore || [], now });
    }
  }

  for (const oldCharacter of source.characters) {
    const characterIds = castMap.get(oldCharacter.id) || [];
    const selectedChats = chatsToImport(oldCharacter);

    for (const oldChat of selectedChats) {
      const storyId = makeId("story");
      const chatId = makeId("chat");
      const personaId = personaMap.get(oldChat.activePersonaId) || null;
      const multiTimeline = selectedChats.length > 1;
      const titleSuffix = multiTimeline && oldChat.title ? ` — ${oldChat.title}` : "";

      vault.stories.push({
        id: storyId,
        legacyCharacterId: oldCharacter.id || null,
        title: `${oldCharacter.name || oldChat.title || "Imported story"}${titleSuffix}`,
        primaryCharacterId: characterIds[0] || null,
        characterIds,
        personaId,
        premise: oldCharacter.permanentMemory || oldCharacter.backstory || oldCharacter.role || "",
        directives: clone(oldCharacter.directives || []),
        source: { app: "Noctis", version: source.version, chatId: oldChat.id || null },
        createdAt: oldChat.createdAt || oldCharacter.createdAt || now,
        updatedAt: oldChat.updatedAt || now
      });

      if (characterIds.length > 1) {
        pushLore(vault, { scope: "story", storyId, lore: oldCharacter.lore || [], now });
      }

      if (String(oldCharacter.permanentMemory || "").trim()) {
        vault.memoryEntries.push({
          id: makeId("memory"),
          storyId,
          chatId,
          scope: "story",
          kind: "canon",
          text: oldCharacter.permanentMemory,
          source: "noctis-permanent-memory",
          pinned: true,
          createdAt: now,
          updatedAt: now
        });
      }

      if ((oldCharacter.directives || []).length) {
        vault.memoryEntries.push({
          id: makeId("memory"),
          storyId,
          chatId,
          scope: "story",
          kind: "canon",
          text: oldCharacter.directives.join("\n"),
          data: { key: "noctis-directives" },
          source: "noctis-directives",
          pinned: true,
          createdAt: now,
          updatedAt: now
        });
      }

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
          metadata: clone({ ...oldMessage, id: undefined, role: undefined, text: undefined }),
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
  return { vault, preview, warnings, importMode: "merge" };
}

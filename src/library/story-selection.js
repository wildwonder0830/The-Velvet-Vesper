import {activePersonaId} from "../personas/persona-store.js";
export function listStoryChoices(vault) {
  return (vault.stories || []).map(story => {
    const ids = [...new Set([story.primaryCharacterId, ...(story.characterIds || [])].filter(Boolean))];
    const cast = ids.map(id => (vault.characters || []).find(c => c.id === id)).filter(Boolean);
    const persona = (vault.personas || []).find(p => p.id === activePersonaId(story));
    const chats = (vault.chats || []).filter(c => c.storyId === story.id);
    return {
      storyId: story.id,
      title: story.title || cast[0]?.name || "Untitled",
      characterName: cast.length ? cast.map(c => c.name).join(" & ") : "Unassigned character",
      personaName: persona?.name || "Unassigned persona",
      chats
    };
  });
}

export function chooseInitialChat(vault, storyId) {
  return (vault.chats || []).find(c => c.storyId === storyId) || null;
}

export function storyIsRunnable(vault, storyId) {
  const story = (vault.stories || []).find(s => s.id === storyId);
  if (!story) return { ok: false, reason: "Story not found." };
  const persona = (vault.personas || []).find(p => p.id === activePersonaId(story));
  if (!persona) return { ok: false, reason: "Choose a valid persona for this story before sending." };
  const ids = [...new Set([story.primaryCharacterId, ...(story.characterIds || [])].filter(Boolean))];
  if (!ids.length) return { ok: false, reason: "Choose at least one character for this story before sending." };
  const cast = ids.map(id => (vault.characters || []).find(c => c.id === id));
  if (cast.some(c => !c)) return { ok: false, reason: "This story references a missing character. Repair its cast before sending." };
  const chat = chooseInitialChat(vault, storyId);
  if (!chat) return { ok: false, reason: "This story has no chat." };
  return { ok: true, story, persona, characters: cast, chat };
}

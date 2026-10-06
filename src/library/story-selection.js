export function listStoryChoices(vault) {
  return (vault.stories || []).map(story => {
    const character = (vault.characters || []).find(c => c.id === story.primaryCharacterId);
    const persona = (vault.personas || []).find(p => p.id === story.personaId);
    const chats = (vault.chats || []).filter(c => c.storyId === story.id);
    return {
      storyId: story.id,
      title: story.title || character?.name || "Untitled",
      characterName: character?.name || "Unassigned character",
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
  if (!story.personaId) return { ok: false, reason: "Choose a persona for this story before sending." };
  if (!(story.characterIds?.length || story.primaryCharacterId)) return { ok: false, reason: "Choose at least one character for this story before sending." };
  const chat = chooseInitialChat(vault, storyId);
  if (!chat) return { ok: false, reason: "This story has no chat." };
  return { ok: true, story, chat };
}

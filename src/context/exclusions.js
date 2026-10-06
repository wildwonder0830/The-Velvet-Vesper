const INTIMATE_TAGS = new Set(["romantic", "sensual", "sexual", "mate-bond", "bathing", "kissing", "intimate"]);

export function loreAllowedInContext(loreEntry, contextTags = []) {
  const tags = new Set(contextTags);
  const excluded = new Set(loreEntry.excludeWhen || []);
  for (const tag of tags) if (excluded.has(tag)) return false;
  return true;
}

export function makeFamilyIntimacyExclusion(entry) {
  return {
    ...entry,
    excludeWhen: Array.from(new Set([...(entry.excludeWhen || []), ...INTIMATE_TAGS]))
  };
}

export function filterLoreForContext(entries, contextTags = []) {
  return (entries || []).filter(entry => loreAllowedInContext(entry, contextTags));
}

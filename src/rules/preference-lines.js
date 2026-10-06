import { makeId } from "../schema.js";

export const LINE_LEVELS = Object.freeze({
  RED: "red",
  GREEN: "green",
  CONDITIONAL: "conditional"
});

export const DEFAULT_GREEN_LINES = Object.freeze([
  { label: "Filthy dirty talk", tags: ["dirty-talk"] },
  { label: "Being hunted", tags: ["primal", "hunt", "prey"] },
  { label: "Being smelled and tracked", tags: ["primal", "scent", "tracking"] },
  { label: "Toys", tags: ["toys"] },
  { label: "BDSM", tags: ["bdsm"] },
  { label: "Watching a partner masturbate while thinking about Amanda", tags: ["voyeuristic-partner-focus", "wanted"] },
  { label: "Knowing she is wanted and desired", tags: ["wanted", "desire"] },
  { label: "Biting", tags: ["biting"] },
  { label: "Fictional force / CNC themes when enabled for the story", tags: ["cnc", "force-fantasy"], storyOptInRequired: true },
  { label: "Gentle domination", tags: ["gentle-domination"] },
  { label: "Brat dynamics", tags: ["brat"] }
]);

export function createPreferenceLine({ level, label, tags = [], storyOptInRequired = false, enabled = true }, now = new Date().toISOString()) {
  if (!Object.values(LINE_LEVELS).includes(level)) throw new Error("Unknown preference-line level.");
  if (!String(label || "").trim()) throw new Error("Preference line requires a label.");
  return {
    id: makeId("line"),
    level,
    label: String(label).trim(),
    tags: [...new Set(tags)],
    storyOptInRequired: Boolean(storyOptInRequired),
    enabled: Boolean(enabled),
    createdAt: now,
    updatedAt: now
  };
}

export function seedDefaultGreenLines(now = new Date().toISOString()) {
  return DEFAULT_GREEN_LINES.map(line => createPreferenceLine({ level: LINE_LEVELS.GREEN, ...line }, now));
}

export function addPreferenceLine(lines, input) {
  return [...(lines || []), createPreferenceLine(input)];
}

export function updatePreferenceLine(lines, id, patch, now = new Date().toISOString()) {
  return (lines || []).map(line => line.id === id
    ? { ...line, ...patch, id: line.id, updatedAt: now }
    : line
  );
}

export function removePreferenceLine(lines, id) {
  return (lines || []).filter(line => line.id !== id);
}

export function compileGreenLines(lines, storySettings = {}) {
  return (lines || []).filter(line => {
    if (line.level !== LINE_LEVELS.GREEN || !line.enabled) return false;
    if (line.storyOptInRequired && !storySettings.enabledPreferenceLineIds?.includes(line.id)) return false;
    return true;
  });
}

const STYLES = Object.freeze({
  romantic: "softer, emotional, suggestive prose",
  balanced: "",
  direct: "more straightforward mature-scene prose",
  unfiltered: "highest permitted prose directness"
});

export function normalizeIntimacyStyle(value) {
  return typeof value === "string" && Object.hasOwn(STYLES, value) ? value : "balanced";
}

export function compileIntimacyStyle(value) {
  const style = normalizeIntimacyStyle(value);
  if (style === "balanced") return "";
  return `Mature-scene style (${style}): ${STYLES[style]}. Preserve character identity, voice, history, canon, relationship state, limits, and scene continuity; established adult requirements and story permissions, including CNC state, remain authoritative. Style changes no permissions or consent; permission alone establishes no dynamic.`;
}

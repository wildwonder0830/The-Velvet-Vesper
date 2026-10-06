function normalize(text) {
  return String(text || "").toLocaleLowerCase();
}

function ruleKey(definitionKey, ruleIndex, messageId, version = 1) {
  return `${definitionKey}:${ruleIndex}:${messageId}:v${version}`;
}

export function scanStats({ message, definitions, existingEvents = [], storyId, relationshipId = null }) {
  const haystack = normalize(message.text);
  const seen = new Set(existingEvents.map(event => event.dedupeKey).filter(Boolean));
  const events = [];

  for (const definition of definitions) {
    let awarded = 0;
    (definition.triggers || []).forEach((trigger, ruleIndex) => {
      const phrases = trigger.phrases || [];
      const matched = phrases.filter(phrase => haystack.includes(normalize(phrase)));
      if (!matched.length) return;

      const dedupeKey = ruleKey(definition.key, ruleIndex, message.id, definition.version || 1);
      if (seen.has(dedupeKey)) return;

      const room = Math.max(0, (definition.perMessageCap ?? Infinity) - awarded);
      const delta = Math.min(trigger.weight ?? 1, room);
      if (delta <= 0) return;

      awarded += delta;
      events.push({
        storyId,
        relationshipId,
        statKey: definition.key,
        delta,
        sourceMessageId: message.id,
        matchedTriggers: matched,
        explanation: `Matched: ${matched.join(", ")}`,
        dedupeKey
      });
    });
  }
  return events;
}

export function findMilestoneCandidates({ message, definitions }) {
  const haystack = normalize(message.text);
  return definitions.flatMap(definition => {
    const matched = (definition.phrases || []).filter(phrase => haystack.includes(normalize(phrase)));
    if (!matched.length) return [];
    return [{
      key: definition.key,
      sourceMessageId: message.id,
      matchedTriggers: matched,
      requiresContextVerification: definition.requiresContextVerification !== false,
      status: "candidate"
    }];
  });
}

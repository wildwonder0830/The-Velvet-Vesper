export function selectRecentMessages(messages, { maxMessages = 40, preservePinned = true } = {}) {
  const ordered = [...(messages || [])].sort((a,b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  const recent = ordered.slice(-maxMessages);
  if (!preservePinned) return recent;
  const ids = new Set(recent.map(m => m.id));
  const pinned = ordered.filter(m => m.pinned && !ids.has(m.id));
  return [...pinned, ...recent];
}

export function estimateTextTokens(text) {
  // Deliberately conservative UI estimate; provider-reported usage remains authoritative.
  return Math.ceil(String(text || "").length / 3.5);
}

export function estimateMessagesTokens(messages) {
  return (messages || []).reduce((sum,m) => sum + estimateTextTokens(m.text) + 8, 0);
}

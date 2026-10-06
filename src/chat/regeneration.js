export function createRegenerationPlan(messages, targetMessageId) {
  const index = messages.findIndex(message => message.id === targetMessageId);
  if (index < 0) throw new Error("Message to regenerate was not found.");

  const target = messages[index];
  if (target.role !== "assistant") throw new Error("Only model replies can be regenerated.");

  return {
    targetMessageId,
    preservedBefore: messages.slice(0, index),
    replacedMessage: target,
    preservedAfter: messages.slice(index + 1),
    // The caller chooses whether descendants are retained as an alternate branch.
    requiresDescendantDecision: index < messages.length - 1
  };
}

export function commitRegeneration(messages, plan, replacement, { keepDescendants = false } = {}) {
  const prefix = plan.preservedBefore;
  const suffix = keepDescendants ? plan.preservedAfter : [];
  return [...prefix, { ...replacement, regeneratedFromId: plan.targetMessageId }, ...suffix];
}

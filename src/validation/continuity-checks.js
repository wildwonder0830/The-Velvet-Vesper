export function validateSceneTransition(previousScene, candidateScene) {
  const issues = [];
  if (!previousScene || !candidateScene) return issues;
  if (previousScene.location && candidateScene.location && previousScene.location !== candidateScene.location && !candidateScene.transitionReason) {
    issues.push({ type: "location-jump", severity: "review", from: previousScene.location, to: candidateScene.location });
  }
  return issues;
}

export function validateKnowledgeClaims(claims, knowledgeEntries, characterId, storyId) {
  return (claims || []).filter(claim => {
    if (!claim.requiresPriorKnowledge) return false;
    return !(knowledgeEntries || []).some(entry =>
      entry.storyId === storyId && entry.knowerId === characterId && entry.factKey === claim.factKey
    );
  }).map(claim => ({ type: "knowledge-leak", severity: "review", claim }));
}

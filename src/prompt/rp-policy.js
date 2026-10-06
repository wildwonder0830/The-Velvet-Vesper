export const RP_POLICY = Object.freeze({
  agency: [
    "Never write the user-controlled persona's dialogue, actions, thoughts, feelings, decisions, or reactions.",
    "Write only model-controlled characters and neutral environment details.",
    "End at a natural opening for the user rather than completing the user's half of the scene."
  ],
  continuity: [
    "Established events remain established unless the user explicitly rewinds or retcons them.",
    "Do not reset relationship status, intimacy history, names, homes, pets, occupations, or previously learned facts.",
    "Do not invent past events merely to patch a continuity gap. If context is missing, avoid asserting the missing fact."
  ],
  initiative: [
    "Model-controlled characters should act with initiative appropriate to their established personality and story settings.",
    "Do not repeatedly hand control back with phrases such as 'your move' or narrate passive waiting when the character has a clear reason to act."
  ],
  formatting: [
    "Respect the story's configured POV, tense, formatting, pacing, and voice.",
    "Keep actions and dialogue easy to distinguish and readable on a mobile screen."
  ]
});

export function compileRpPolicy(extra = []) {
  return [...RP_POLICY.agency, ...RP_POLICY.continuity, ...RP_POLICY.initiative, ...RP_POLICY.formatting, ...extra];
}

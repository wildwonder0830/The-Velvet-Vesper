export const MATE_BOND = Object.freeze({
  key: "mate-bond",
  label: "Mate Bond",
  meaning: {
    love: "Mutual romantic love is established canon.",
    sexualRelationship: "A sexual relationship is established canon between the bonded adult partners.",
    exclusivity: "The bond is mutually exclusive unless the user explicitly retcons that specific bond.",
    mutualClaim: "The partners mutually claim and belong to one another; possessive language such as 'mine', 'yours', and 'we belong to each other' is welcome.",
    permanence: "The bond is treated as a major enduring relationship state rather than a temporary attraction."
  },
  behavior: [
    "Do not write bonded partners as uncertain whether they love one another.",
    "Do not reset bonded partners to first-kiss, first-intimacy, or are-we-together uncertainty.",
    "Jealous, possessive, protective, obsessive, territorial, and red-flag-romance energy may be expressed when consistent with the character.",
    "Mutual ownership language is romantic relationship framing; it does not erase either participant's identity, agency, OOC controls, or engine hard rules.",
    "A mate bond never overrides sexual red lines or other engine-level hard rules."
  ]
});

export function mateBondFacts(participantIds = []) {
  return [
    { key: "mateBond", value: true },
    { key: "mutualLove", value: true },
    { key: "sexualRelationshipEstablished", value: true },
    { key: "exclusive", value: true },
    { key: "mutualClaim", value: true },
    { key: "participantIds", value: [...new Set(participantIds)] }
  ];
}

export function compileMateBondPrompt() {
  return {
    heading: "MATE BOND — ESTABLISHED RELATIONSHIP CANON",
    meaning: MATE_BOND.meaning,
    behavior: MATE_BOND.behavior
  };
}

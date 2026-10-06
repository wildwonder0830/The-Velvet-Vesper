export const DEFAULT_STAT_DEFINITIONS = [
  {
    key: "affection",
    name: "Affection",
    perMessageCap: 3,
    cooldownMessages: 0,
    triggers: [
      { phrases: ["i love you", "love you"], weight: 2 },
      { phrases: ["adore", "cherish", "affection"], weight: 1 }
    ]
  },
  {
    key: "trust",
    name: "Trust",
    perMessageCap: 3,
    cooldownMessages: 0,
    triggers: [
      { phrases: ["i trust you", "trust me", "confide", "vulnerable"], weight: 2 },
      { phrases: ["promise", "kept his word", "kept her word"], weight: 1 }
    ]
  },
  {
    key: "jealousy",
    name: "Jealousy",
    perMessageCap: 3,
    cooldownMessages: 1,
    triggers: [
      { phrases: ["jealous", "territorial", "rival"], weight: 2 },
      { phrases: ["mine", "possessive"], weight: 1 }
    ]
  },
  {
    key: "protectiveness",
    name: "Protectiveness",
    perMessageCap: 3,
    cooldownMessages: 0,
    triggers: [
      { phrases: ["protect", "safe", "guard", "shield"], weight: 1 },
      { phrases: ["get behind me", "stay behind me"], weight: 2 }
    ]
  },
  {
    key: "conflict",
    name: "Conflict",
    perMessageCap: 3,
    cooldownMessages: 0,
    triggers: [
      { phrases: ["argued", "fight", "furious", "betrayed"], weight: 2 },
      { phrases: ["angry", "upset"], weight: 1 }
    ]
  }
];

export const DEFAULT_MILESTONE_CANDIDATES = [
  { key: "first_kiss", phrases: ["first kiss", "kissed her", "kissed him"], requiresContextVerification: true },
  { key: "first_date", phrases: ["first date", "our date"], requiresContextVerification: true },
  { key: "relationship_official", phrases: ["boyfriend", "girlfriend", "we're together", "official"], requiresContextVerification: true },
  { key: "love_confession", phrases: ["i love you"], requiresContextVerification: true },
  { key: "mated", phrases: ["mated", "mate bond completed", "bond completed"], requiresContextVerification: true }
];

const COMMANDS = Object.freeze({
  memory: { name: "memory", description: "Show or manage story memory." },
  forget: { name: "forget", description: "Remove a selected memory/canon item after confirmation." },
  canon: { name: "canon", description: "Add or inspect explicit story canon." },
  summary: { name: "summary", description: "Generate or inspect the current story summary." },
  rewind: { name: "rewind", description: "Return the active chat to an earlier message without rewriting historical data." },
  scene: { name: "scene", description: "Inspect or update structured scene state." },
  timeskip: { name: "timeskip", description: "Advance story time while preserving continuity." },
  ooc: { name: "ooc", description: "Send an out-of-character instruction with highest story-level precedence." }
});

export function parseCommand(input) {
  const text = String(input || "").trim();
  if (!text.startsWith("/")) return null;
  const match = text.match(/^\/([a-z-]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return { type: "invalid", raw: text };
  const name = match[1].toLowerCase();
  const command = COMMANDS[name];
  if (!command) return { type: "unknown", name, args: match[2] || "", raw: text };
  return { type: "command", name, args: (match[2] || "").trim(), definition: command };
}

export function listCommands() {
  return Object.values(COMMANDS);
}

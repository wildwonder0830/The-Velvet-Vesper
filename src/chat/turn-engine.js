import { assemblePrompt } from "../prompt/prompt-assembler.js";
import { sendOpenRouterChat } from "../provider/openrouter.js";
import { validateModelOutput, buildRepairInstruction } from "../validation/output-gate.js";

function toProviderMessages(assembled) {
  const system = [
    JSON.stringify({
      hardRules: assembled.hardRules,
      sexualRedLines: assembled.sexualRedLines,
      storySettings: assembled.storySettings,
      rpPolicy: assembled.agencyAndRpPolicy,
      continuity: assembled.canonAndContinuity,
      scene: assembled.sceneState,
      persona: assembled.persona,
      characters: assembled.characters,
      relationship: assembled.relationship,
      milestones: assembled.milestones,
      lore: assembled.lore,
      memory: assembled.memory,
      greenLines: assembled.greenLines
    }),
    assembled.oocInstruction ? `CURRENT OOC INSTRUCTION: ${assembled.oocInstruction}` : ""
  ].filter(Boolean).join("\n\n");

  return [
    { role: "system", content: system },
    ...assembled.recentMessages.map(m => ({ role: m.role, content: m.text }))
  ];
}

function extractText(data) {
  return data?.choices?.[0]?.message?.content || "";
}

export async function runTurn({ vault, storyId, chatId, model, preferenceLines = [], storySettings = {}, oocInstruction = "", temperature, maxTokens, signal }) {
  const assembled = assemblePrompt({ vault, storyId, chatId, preferenceLines, storySettings, oocInstruction });
  const messages = toProviderMessages(assembled);
  const first = await sendOpenRouterChat({ model, messages, temperature, maxTokens, signal });
  let text = extractText(first);

  const continuity = {
    mateBond: assembled.relationship?.stage === "mated" || assembled.milestones.some(m => m.type === "mated")
  };
  let validation = validateModelOutput({ text, continuity });

  if (validation.needsRepair && validation.ok) {
    const repaired = await sendOpenRouterChat({
      model,
      messages: [...messages, { role: "assistant", content: text }, { role: "system", content: buildRepairInstruction(validation) }],
      temperature,
      maxTokens,
      signal
    });
    text = extractText(repaired);
    validation = validateModelOutput({ text, continuity });
    return { text, validation, usage: [first.usage, repaired.usage].filter(Boolean), repaired: true };
  }

  return { text, validation, usage: [first.usage].filter(Boolean), repaired: false };
}

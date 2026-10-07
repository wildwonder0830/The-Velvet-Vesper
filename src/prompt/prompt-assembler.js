import { buildStoryContext } from "./context-builder.js";
import { compileRpPolicy } from "./rp-policy.js";
import { compileSexualRedLines } from "../rules/sexual-red-lines.js";
import { compileGreenLines } from "../rules/preference-lines.js";
import { continuityPrompt } from "../continuity/guards.js";
import { selectRecentMessages } from "../chat/history-window.js";
import { compileMateBondPrompt } from "../relationships/mate-bond.js";
import { filterMemoryForModel } from "../memory/memory-manager.js";
import { milestoneSupportsRelationship } from "../milestones/verifier.js";
import { normalizeIntimacyStyle, compileIntimacyStyle } from "../settings/intimacy-style.js";

export function assemblePrompt({ vault, storyId, chatId, preferenceLines = [], storySettings = {}, oocInstruction = "", maxRecentMessages = 40 }) {
  const context=buildStoryContext(vault,storyId,chatId);
  const intimacyStyle=normalizeIntimacyStyle(Object.hasOwn(storySettings,"intimacyStyle")?storySettings.intimacyStyle:context.story?.settings?.intimacyStyle);
  const chat=(vault.chats||[]).find(c=>c.id===chatId&&c.storyId===storyId);
  if(!chat) throw new Error("Chat not found in active story.");
  const recentMessages=selectRecentMessages(filterMemoryForModel((vault.messages||[]).filter(m=>m.storyId===storyId&&m.chatId===chatId),vault.memoryEntries,storyId),{maxMessages:maxRecentMessages});
  const relationship=context.relationships[0]||null;
  const validatedBond=context.milestones.find(m=>m.type==="mated"&&(relationship?milestoneSupportsRelationship(m,relationship):m.participants.includes(context.persona?.id)));
  const mateBond=relationship?.stage==="mated"||Boolean(validatedBond);
  const continuity=continuityPrompt({relationship,milestones:context.milestones,facts:context.memory.filter(m=>m.kind==="canon"),knowledge:context.knowledge,vault,storyId,chatId});
  const assembled={precedence:["hardRules","oocInstruction","sexualRedLines","storySettings","agencyAndRpPolicy","canonAndContinuity","mateBondCanon","sceneState","characters","relationship","lore","memory","recentMessages","style"],
    hardRules:context.hardRules,story:context.story,oocInstruction:String(oocInstruction||"").trim(),sexualRedLines:compileSexualRedLines(),greenLines:compileGreenLines(preferenceLines,storySettings),storySettings,agencyAndRpPolicy:compileRpPolicy(),canonAndContinuity:continuity,mateBondCanon:mateBond?{...compileMateBondPrompt(),participantIds:validatedBond?.participants||relationship?.participantIds||[]}:null,sceneState:context.sceneState,persona:context.persona,characters:context.characters,relationship,milestones:context.milestones,lore:context.lore,memory:context.memory,recentMessages};
  assembled.intimacyStyle=intimacyStyle;
  assembled.intimacyStyleDirective=compileIntimacyStyle(intimacyStyle);
  return filterMemoryForModel(assembled,vault.memoryEntries,storyId);
}

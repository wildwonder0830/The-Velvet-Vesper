import { assemblePrompt } from "../prompt/prompt-assembler.js";
import { sendOpenRouterChat } from "../provider/openrouter.js";
import { validateModelOutput, buildRepairInstruction } from "../validation/output-gate.js";

function toProviderMessages(a){const system=[JSON.stringify({hardRules:a.hardRules,sexualRedLines:a.sexualRedLines,storySettings:a.storySettings,rpPolicy:a.agencyAndRpPolicy,continuity:a.canonAndContinuity,mateBondCanon:a.mateBondCanon,scene:a.sceneState,persona:a.persona,characters:a.characters,relationship:a.relationship,milestones:a.milestones,lore:a.lore,memory:a.memory,greenLines:a.greenLines}),a.oocInstruction?`CURRENT OOC INSTRUCTION: ${a.oocInstruction}`:""].filter(Boolean).join("\n\n");return [{role:"system",content:system},...a.recentMessages.map(m=>({role:m.role,content:m.text}))];}
const extractText=d=>d?.choices?.[0]?.message?.content||"";
export async function runTurn({vault,storyId,chatId,model,preferenceLines=[],storySettings={},oocInstruction="",temperature,maxTokens,signal}){
 const assembled=assemblePrompt({vault,storyId,chatId,preferenceLines,storySettings,oocInstruction}),messages=toProviderMessages(assembled);
 const first=await sendOpenRouterChat({model,messages,temperature,maxTokens,signal});let text=extractText(first);
 const continuity={mateBond:Boolean(assembled.mateBondCanon)};let validation=validateModelOutput({text,continuity});
 if(validation.issues.length){
   const repaired=await sendOpenRouterChat({model,messages:[...messages,{role:"assistant",content:text},{role:"system",content:buildRepairInstruction(validation)}],temperature,maxTokens,signal});
   text=extractText(repaired);validation=validateModelOutput({text,continuity});
   if(!validation.ok||validation.needsRepair)return {text:"",validation,usage:[first.usage,repaired.usage].filter(Boolean),repaired:true,blocked:true};
   return {text,validation,usage:[first.usage,repaired.usage].filter(Boolean),repaired:true,blocked:false};
 }
 return {text,validation,usage:[first.usage].filter(Boolean),repaired:false,blocked:false};
}

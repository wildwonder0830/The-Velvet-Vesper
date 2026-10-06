import { assemblePrompt } from "../prompt/prompt-assembler.js";
import { sendOpenRouterChat } from "../provider/openrouter.js";
import { validateModelOutput, buildRepairInstruction } from "../validation/output-gate.js";

function toProviderMessages(a){const system=[JSON.stringify({hardRules:a.hardRules,sexualRedLines:a.sexualRedLines,storySettings:a.storySettings,rpPolicy:a.agencyAndRpPolicy,continuity:a.canonAndContinuity,mateBondCanon:a.mateBondCanon,storyPremise:a.story?.premise||null,openingScene:a.story?.openingScene||null,prophecy:a.story?.prophecy||null,scene:a.sceneState,persona:a.persona,characters:a.characters,relationship:a.relationship,milestones:a.milestones,lore:a.lore,memory:a.memory,greenLines:a.greenLines}),a.oocInstruction?`CURRENT OOC INSTRUCTION: ${a.oocInstruction}`:""].filter(Boolean).join("\n\n");return [{role:"system",content:system},...a.recentMessages.map(m=>({role:m.role,content:m.text}))];}
const extractText=d=>d?.choices?.[0]?.message?.content||"";
export async function runTurn({vault,storyId,chatId,model,preferenceLines=[],storySettings={},oocInstruction="",opening=false,temperature,maxTokens,signal}){
 const assembled=assemblePrompt({vault,storyId,chatId,preferenceLines,storySettings,oocInstruction}),messages=toProviderMessages(assembled); if(opening) messages.push({role:"system",content:"OPENING TURN: Begin the configured opening scene now. Follow openingScene facts exactly. Write only model-controlled characters and neutral environment. Do not narrate the user-controlled persona in any way. Make the opening substantial and immersive: establish the setting and social tension, give each major model-controlled character a distinct beat and voice, and fully play through the configured opening incident before stopping. Aim for roughly 700-1000 words unless the configured scene naturally requires less. Use readable paragraph breaks. Stop at the first strong natural point where the persona can respond; do not say your move."});
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

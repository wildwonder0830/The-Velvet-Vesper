import { assemblePrompt } from "../prompt/prompt-assembler.js";
import { sendOpenRouterChat } from "../provider/openrouter.js";
import { validateModelOutput, buildRepairInstruction } from "../validation/output-gate.js";
import { filterMemoryForModel } from "../memory/memory-manager.js";

function providerRole(role){return role==="assistant"?"assistant":"user";}
function toProviderMessages(a){const system=[JSON.stringify({hardRules:a.hardRules,sexualRedLines:a.sexualRedLines,storySettings:a.storySettings,rpPolicy:a.agencyAndRpPolicy,continuity:a.canonAndContinuity,mateBondCanon:a.mateBondCanon,storyPremise:a.story?.premise||null,openingScene:a.story?.openingScene||null,prophecy:a.story?.prophecy||null,scene:a.sceneState,persona:a.persona,protagonistIdentity:a.protagonistIdentity,characters:a.characters,relationship:a.relationship,milestones:a.milestones,lore:a.lore,memory:a.memory,greenLines:a.greenLines,...(a.authoritativeEdits?{authoritativeEdits:a.authoritativeEdits}:{}),...(a.phoneContinuity?{phoneContinuity:{kind:"electronic exchanges; not physical milestone evidence",messages:a.phoneContinuity}}:{}),...(a.intimacyStyleDirective?{intimacyStyle:a.intimacyStyleDirective}:{})}),a.oocInstruction?`CURRENT OOC INSTRUCTION: ${a.oocInstruction}`:""].filter(Boolean).join("\n\n");return [{role:"system",content:system},...a.recentMessages.map(m=>({role:providerRole(m.role),content:m.text}))];}
const extractText=d=>d?.choices?.[0]?.message?.content||"";
export async function runTurn({vault,storyId,chatId,model,preferenceLines=[],storySettings={},oocInstruction="",opening=false,personaDraft=false,temperature,maxTokens,signal,repairAttempts=2}){
 const assembled=assemblePrompt({vault,storyId,chatId,preferenceLines,storySettings,oocInstruction}),messages=toProviderMessages(assembled); if(personaDraft){messages.push({role:"system",content:`MY TURN DRAFT MODE: Generate ONLY a proposed next turn for the assigned user-controlled persona ${assembled.persona?.name||"the protagonist"}. Do not acknowledge instructions, discuss the previous response, promise future behavior, say you are ready, or write model-controlled characters. Output only the draft prose this persona could send. Keep it consistent with current canon and scene context. End the draft on a complete sentence and complete beat.`});}else{messages.push({role:"system",content:"TURN ENDING RULE: End every roleplay reply on a complete sentence and a complete narrative beat. Never end on a fragment, dangling transition, teaser fragment, or truncated phrase. If the response approaches the token limit, conclude the current beat cleanly rather than beginning another sentence or paragraph."});} if(opening) messages.push({role:"system",content:"OPENING TURN: Begin the configured opening scene now. Follow openingScene facts exactly. Protect the user-controlled persona's meaningful agency: do not invent her voluntary choices, substantive dialogue, thoughts, feelings, intentions, trust, consent, or consequential decisions. You MAY narrate involuntary, unavoidable, mechanically necessary, or explicitly configured opening events involving her when they do not imply a voluntary choice. If she could reasonably choose not to do something, leave that action to the user. OPENING COMPLETION RULE: The opening sequence may be as long as necessary to complete every configured openingScene fact, beat, reveal, character reaction, and required event properly. Completeness takes priority over brevity or ordinary turn length. Never abbreviate, summarize, rush, or prematurely stop an opening merely to meet a target length. Establish the setting and social tension, give each major model-controlled character a distinct beat and voice, and fully play through the configured opening incident before stopping. Use readable paragraph breaks. Stop at the first strong natural point where the persona can respond; do not say your move."});
 const first=await sendOpenRouterChat({model,messages:filterMemoryForModel(messages,vault.memoryEntries,storyId),temperature,maxTokens,signal});let text=extractText(first);
 let continuity={mateBond:Boolean(assembled.mateBondCanon)};
 const priorUserText=[...assembled.recentMessages].reverse().find(m=>m.role==="user")?.text||"";
 let validation=validateModelOutput({text,continuity,opening,personaDraft,priorUserText,persona:assembled.persona});
 const usage=[first.usage].filter(Boolean);
 if(validation.issues.length){
   for(let attempt=0;attempt<repairAttempts;attempt++){
     const current=assemblePrompt({vault,storyId,chatId,preferenceLines,storySettings,oocInstruction});
     continuity={mateBond:Boolean(current.mateBondCanon)};
     validation=validateModelOutput({text,continuity,opening,personaDraft,priorUserText,persona:current.persona});
     const refreshed=toProviderMessages(current);
     const modeInstructions=messages.slice(1+assembled.recentMessages.length);
     const repaired=await sendOpenRouterChat({model,messages:filterMemoryForModel([...refreshed,...modeInstructions,{role:"assistant",content:text},{role:"system",content:buildRepairInstruction(validation,{opening,personaDraft,persona:current.persona})}],vault.memoryEntries,storyId),temperature,maxTokens,signal});
     if(repaired.usage)usage.push(repaired.usage);
     text=extractText(repaired);validation=validateModelOutput({text,continuity,opening,personaDraft,priorUserText,persona:current.persona});
     if(validation.ok&&!validation.needsRepair)return {text,validation,usage,repaired:true,blocked:false};
   }
   return {text,blockedText:text,validation,usage,repaired:true,blocked:true,issueTypes:[...new Set((validation.issues||[]).map(x=>x.type))]};
 }
 return {text,validation,usage,repaired:false,blocked:false};
}

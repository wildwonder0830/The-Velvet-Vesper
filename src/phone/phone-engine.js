import { assemblePrompt } from '../prompt/prompt-assembler.js';
import { buildPhoneContext, filterPhoneProvenance } from './phone-context.js';
import { validateStoryPhone } from './phone-state.js';
import {orderedPhoneMessages} from './phone-state.js';
import { sendOpenRouterChat } from '../provider/openrouter.js';
import { validateModelOutput } from '../validation/output-gate.js';

export async function runPhoneTurn({vault,storyId,threadId,action,signal,send=sendOpenRouterChat}) {
  if (!['send','continue'].includes(action)) throw new Error('Choose Send or Continue explicitly.');
  const story=vault.stories.find(s=>s.id===storyId);if(!story)throw new Error('Story unavailable.');
  validateStoryPhone(story,vault);
  const thread=story.phone?.threads.find(t=>t.id===threadId);if(!thread)throw new Error('Phone thread unavailable.');
  if(thread.historicalOnly||thread.participantIds.some(id=>!vault.characters.some(c=>c.id===id)))throw new Error('Historical contact archives are read-only; no AI request was made.');
  const settings=story.settings||{},a=assemblePrompt({vault,storyId,chatId:thread.chatId,preferenceLines:vault.preferenceLines,storySettings:settings});
  const characters=a.characters.filter(c=>thread.participantIds.includes(c.id));
  if (characters.length !== thread.participantIds.length) throw new Error('A thread participant is no longer in this story. Edit membership before continuing.');
  const history=buildPhoneContext(vault,{storyId,chatId:thread.chatId,respondingCharacterIds:thread.participantIds,threadId});
  // Main transcript is intentionally withheld: it has no reliable per-character audience metadata.
  // Character-owned context is admitted only when all responding participants own it.
  const shared = record => {
    const data=record.data&&typeof record.data==='object'?record.data:{};
    const knower=record.knowerId??data.knowerId;
    const character=record.characterId??data.characterId;
    const owners=knower?[knower]:character?[character]:(record.knowerIds||data.knowerIds||record.participantIds||data.participantIds||record.subjectIds||data.subjectIds||null);
    return !owners || thread.participantIds.every(id=>owners.includes(id));
  };
  const memory=a.memory.filter(shared),lore=a.lore.filter(r=>r.scope!=='character'||thread.participantIds.every(id=>id===r.characterId));
  const relationship=a.relationship&&shared(a.relationship)?a.relationship:null;
  const milestones=a.milestones.filter(shared);
  // Avoid continuity's combined knowledge block; regenerate only from admitted canonical sources.
  const payload=filterPhoneProvenance(vault,{hardRules:a.hardRules,sexualRedLines:a.sexualRedLines,greenLines:a.greenLines,storySettings:a.storySettings,
    rpPolicy:a.agencyAndRpPolicy,persona:a.persona,characters,relationship,milestones,memory,lore,
    storyPremise:a.story.premise||null,...(a.intimacyStyleDirective?{intimacyStyle:a.intimacyStyleDirective}:{}),
    phone:{participants:thread.participantIds,history,action},
    rules:'Text-only phone exchange. Return only a JSON array of {speakerId, text}. Use canonical participant IDs, each character’s established distinct voice, and no narration or persona-authored replies. Not every participant needs to reply. Green lines permit but never require content. Preserve all limits, adult requirements and CNC permissions; no permission toggle forces a dynamic. These are electronic exchanges, not physical milestone evidence. Do not infer private knowledge or past group history not supplied here.'},storyId,thread.chatId);
  const sources={sourceMemoryIds:[...new Set([...payload.memory.map(m=>m.id),...history.flatMap(m=>m.sourceMemoryIds)])],
    sourceMessageIds:[...new Set(history.flatMap(m=>m.sourceMessageIds))],
    sourceMilestoneIds:[...new Set([...payload.milestones.map(m=>m.id),...history.flatMap(m=>m.sourceMilestoneIds)])]};
  const pending=[{value:payload,inMemory:false}];
  const memoryIds=new Set(sources.sourceMemoryIds),messageIds=new Set(sources.sourceMessageIds),milestoneIds=new Set(sources.sourceMilestoneIds);
  while(pending.length){
    const {value,inMemory}=pending.pop();if(!value||typeof value!=='object')continue;
    if(Array.isArray(value)){pending.push(...value.map(value=>({value,inMemory})));continue;}
    for(const id of [value.sourceMemoryId,...(value.sourceMemoryIds||[])].filter(Boolean))memoryIds.add(id);
    for(const id of [value.sourceMilestoneId,value.milestoneId,...(value.sourceMilestoneIds||[])].filter(Boolean))milestoneIds.add(id);
    // Memory records are already cited by their IDs; their shared-story proof need not become a direct chat citation.
    const memoryRecord=inMemory;
    if(!memoryRecord)for(const id of [value.sourceMessageId,...(value.sourceMessageIds||[])].filter(Boolean))messageIds.add(id);
    pending.push(...Object.entries(value).map(([key,child])=>({value:child,inMemory:inMemory||(value===payload&&key==='memory')})));
  }
  sources.sourceMemoryIds=[...memoryIds];sources.sourceMessageIds=[...messageIds];sources.sourceMilestoneIds=[...milestoneIds];
  const response=await send({model:settings.model,messages:[{role:'system',content:JSON.stringify(payload)}],temperature:settings.temperature,maxTokens:settings.maxTokens,signal});
  try {
  let rows;
  try {rows=JSON.parse(response?.choices?.[0]?.message?.content||'');}catch{throw new Error('Vesper returned an unreadable phone reply. Use Continue to try again.');}
  if (!Array.isArray(rows)||!rows.length||rows.length>20) throw new Error('Vesper returned no valid phone messages.');
  const messages=rows.map(row=>{
    if (!row||!thread.participantIds.includes(row.speakerId)||typeof row.text!=='string'||!row.text.trim()||row.text.length>80000)throw new Error('Vesper returned an invalid phone speaker or message.');
    const validation=validateModelOutput({text:row.text,continuity:{mateBond:Boolean(relationship?.stage==='mated')},priorUserText:orderedPhoneMessages(thread).reverse().find(m=>m.senderType==='persona')?.text||''});
    if(!validation.ok||validation.needsRepair)throw new Error('Vesper’s phone reply failed story boundaries or continuity validation. Use Continue to try again.');
    return {senderType:'character',senderId:row.speakerId,text:row.text.trim(),storyId,chatId:thread.chatId,audienceIds:[...new Set([story.personaId,...thread.participantIds])],...sources};
  });
  return {messages,usage:response.usage||null};
  } catch(error) { error.phoneUsage=response.usage||null; throw error; }
}

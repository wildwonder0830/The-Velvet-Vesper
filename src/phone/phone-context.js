import { projectEditedContext, assistantTextVersions } from "../chat/message-edit.js";
import {extendedCandidateIndex} from './phone-history-parser.js';
import { filterMemoryForModel } from '../memory/memory-manager.js';
import { canonicalMilestones, milestoneDerivedRecordIsCanonical } from '../milestones/verifier.js';
import {orderedPhoneMessages,recoveredSourceCurrent} from './phone-state.js';

function sourcesAvailable(vault,message,checkOwner=true) {
  const pending=[{record:message,root:checkOwner}],visited=new Set();
  while(pending.length){
    const {record,root}=pending.pop();
    for(const owner of [record,record.data].filter(v=>v&&typeof v==='object'&&!Array.isArray(v))){
      for(const [single,multiple,collection] of [['sourceMessageId','sourceMessageIds','messages'],['sourceMemoryId','sourceMemoryIds','memoryEntries'],['sourceMilestoneId','sourceMilestoneIds','milestones']]){
        if(owner[multiple]!=null&&!Array.isArray(owner[multiple]))return false;
        const references=[owner[single],...(owner[multiple]||[])].filter(id=>id!=null);
        for(const id of references){
          const source=vault[collection].find(r=>r.id===id);if(!source)return false;
          if(root&&collection!=='memoryEntries'&&(source.storyId!==message.storyId||(collection==='messages'&&source.chatId&&source.chatId!==message.chatId)))return false;
          const key=collection+':'+id;
          if(collection!=='messages'&&!visited.has(key)){visited.add(key);pending.push({record:source,root:false});}
        }
      }
    }
  }
  return true;
}
export function phoneMessageVisible(vault, message, respondingCharacterIds,candidateIndex) {
  if (!respondingCharacterIds?.length || !respondingCharacterIds.every(id => message.audienceIds?.includes(id)) || !sourcesAvailable(vault,message)||!recoveredSourceCurrent(message,vault,{candidateIndex})) return false;
  if ((message.sourceMilestoneIds || []).some(id => !canonicalMilestones(vault,message.storyId,message.chatId).some(m => m.id === id))) return false;
  const filtered = filterMemoryForModel([message],vault.memoryEntries,message.storyId);
  return filtered.length === 1 && filtered[0].text === message.text;
}
export function buildPhoneContext(vault,{storyId,chatId,respondingCharacterIds,threadId,maxMessages=40}) {
  vault=projectEditedContext(vault);
  const story=vault.stories.find(s=>s.id===storyId);
  if (!story || !vault.chats.some(c=>c.id===chatId&&c.storyId===storyId)) return [];
  const cast=new Set([story.primaryCharacterId,...(story.characterIds||[])].filter(Boolean));
  if (!respondingCharacterIds?.length || respondingCharacterIds.some(id=>!cast.has(id))) return [];
  const candidateIndex=story.phone?.threads.some(t=>t.messages.some(m=>m.recovery?.version===2))?extendedCandidateIndex(vault,storyId):null;
  return (story.phone?.threads||[]).filter(t=>t.storyId===storyId&&t.chatId===chatId&&(!threadId||t.id===threadId))
    .flatMap(t=>orderedPhoneMessages(t).filter(m=>m.storyId===storyId&&m.chatId===chatId&&phoneMessageVisible(vault,m,respondingCharacterIds,candidateIndex))
      .map(m=>({threadId:t.id,threadKind:t.kind,senderId:m.senderId,text:m.text,createdAt:m.createdAt,
        ...(m.recovery?{chronology:'Recovered in transcript order; relation to live phone messages unverified',sourceOrder:[m.recovery.transcriptOrder,m.recovery.start]}:{}),
        audienceIds:[...m.audienceIds],sourceMessageIds:m.sourceMessageIds||[],sourceMemoryIds:m.sourceMemoryIds||[],sourceMilestoneIds:m.sourceMilestoneIds||[]})))
    .sort((a,b)=>a.sourceOrder&&b.sourceOrder?a.sourceOrder[0]-b.sourceOrder[0]||a.sourceOrder[1]-b.sourceOrder[1]:a.sourceOrder?-1:b.sourceOrder?1:a.createdAt.localeCompare(b.createdAt)).slice(-maxMessages);
}
export function reconcilePhoneDependencies(vault,{historicalBase=vault}={}) {
  const next=structuredClone(vault);
  // Keep an already-reviewed identity only while its actual surviving source
  // still documents that exact name. This does not infer replacement evidence.
  for(const s of next.stories){const p=s.phone,base=historicalBase.stories.find(x=>x.id===s.id)?.phone;if(!p||!base)continue;
    for(const [field,label] of [['historicalContacts','canonicalName'],['historicalAliases','label']]){
      if(base[field]===undefined)continue;
      p[field]=base[field].map(record=>({...structuredClone(record),sourceMessageIds:record.sourceMessageIds.filter(id=>next.messages.some(m=>m.id===id&&m.storyId===s.id&&assistantTextVersions(m).some(text=>text.toLocaleLowerCase().includes(record[label].toLocaleLowerCase()))))})).filter(record=>record.sourceMessageIds.length);
    }
  }
  for (const s of next.stories) {const candidateIndex=s.phone?.threads.some(t=>t.messages.some(m=>m.recovery?.version===2))?extendedCandidateIndex(next,s.id,{includeExcluded:true}):null;for (const t of s.phone?.threads||[]) {
    // Historical excluded sources remain stored; missing/removed branch sources cannot leave dangling references.
    t.messages=t.messages.filter(m=>sourcesAvailable(next,m)&&recoveredSourceCurrent(m,next,{includeExcluded:true,candidateIndex}));
  }
  }
  for(const s of next.stories){const p=s.phone;if(!p)continue;
    const oldContactIds=new Set((historicalBase.stories.find(x=>x.id===s.id)?.phone?.historicalContacts||[]).map(c=>c.id));
    const evidence=ids=>ids.filter(id=>next.messages.some(m=>m.id===id&&m.storyId===s.id));
    if(p.historicalContacts)p.historicalContacts=p.historicalContacts.map(c=>({...c,sourceMessageIds:evidence(c.sourceMessageIds)})).filter(c=>c.sourceMessageIds.length);
    const known=new Set([s.personaId,...next.characters.map(c=>c.id),...(p.historicalContacts||[]).map(c=>c.id)]);
    if(p.historicalAliases)p.historicalAliases=p.historicalAliases.map(a=>({...a,sourceMessageIds:evidence(a.sourceMessageIds)})).filter(a=>known.has(a.id)&&a.sourceMessageIds.length);
    p.threads=p.threads.filter(t=>!(t.historicalOnly&&!t.messages.length&&t.participantIds.some(id=>!known.has(id))));
    for(const id of oldContactIds)if(!known.has(id))delete p.contactDisplayNames[id];
  }
  return next;
}

// Filter model input only; stored historical records and canonical identities are untouched.
export function filterPhoneProvenance(vault,value,storyId,chatId) {
  if(Array.isArray(value))return value.map(v=>filterPhoneProvenance(vault,v,storyId,chatId)).filter(v=>v!==undefined);
  if(!value||typeof value!=='object')return value;
  if(!sourcesAvailable(vault,value,false)||!milestoneDerivedRecordIsCanonical(value,vault,storyId,chatId))return undefined;
  return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,filterPhoneProvenance(vault,child,storyId,chatId)]).filter(([,child])=>child!==undefined));
}

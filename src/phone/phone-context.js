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
export function phoneMessageVisible(vault, message, respondingCharacterIds) {
  if (!respondingCharacterIds?.length || !respondingCharacterIds.every(id => message.audienceIds?.includes(id)) || !sourcesAvailable(vault,message)||!recoveredSourceCurrent(message,vault)) return false;
  if ((message.sourceMilestoneIds || []).some(id => !canonicalMilestones(vault,message.storyId,message.chatId).some(m => m.id === id))) return false;
  const filtered = filterMemoryForModel([message],vault.memoryEntries,message.storyId);
  return filtered.length === 1 && filtered[0].text === message.text;
}
export function buildPhoneContext(vault,{storyId,chatId,respondingCharacterIds,threadId,maxMessages=40}) {
  const story=vault.stories.find(s=>s.id===storyId);
  if (!story || !vault.chats.some(c=>c.id===chatId&&c.storyId===storyId)) return [];
  const cast=new Set([story.primaryCharacterId,...(story.characterIds||[])].filter(Boolean));
  if (!respondingCharacterIds?.length || respondingCharacterIds.some(id=>!cast.has(id))) return [];
  return (story.phone?.threads||[]).filter(t=>t.storyId===storyId&&t.chatId===chatId&&(!threadId||t.id===threadId))
    .flatMap(t=>orderedPhoneMessages(t).filter(m=>m.storyId===storyId&&m.chatId===chatId&&phoneMessageVisible(vault,m,respondingCharacterIds))
      .map(m=>({threadId:t.id,threadKind:t.kind,senderId:m.senderId,text:m.text,createdAt:m.createdAt,
        ...(m.recovery?{chronology:'Recovered in transcript order; relation to live phone messages unverified',sourceOrder:[m.recovery.transcriptOrder,m.recovery.start]}:{}),
        audienceIds:[...m.audienceIds],sourceMessageIds:m.sourceMessageIds||[],sourceMemoryIds:m.sourceMemoryIds||[],sourceMilestoneIds:m.sourceMilestoneIds||[]})))
    .sort((a,b)=>a.sourceOrder&&b.sourceOrder?a.sourceOrder[0]-b.sourceOrder[0]||a.sourceOrder[1]-b.sourceOrder[1]:a.sourceOrder?-1:b.sourceOrder?1:a.createdAt.localeCompare(b.createdAt)).slice(-maxMessages);
}
export function reconcilePhoneDependencies(vault) {
  const next=structuredClone(vault);
  for (const s of next.stories) for (const t of s.phone?.threads||[]) {
    // Historical excluded sources remain stored; missing/removed branch sources cannot leave dangling references.
    t.messages=t.messages.filter(m=>sourcesAvailable(next,m)&&recoveredSourceCurrent(m,next,{includeExcluded:true}));
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

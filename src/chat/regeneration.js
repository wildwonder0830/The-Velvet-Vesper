export function createRegenerationPlan(messages, targetMessageId) {
  const index = messages.findIndex(message => message.id === targetMessageId);
  if (index < 0) throw new Error("Message to regenerate was not found.");

  const target = messages[index];
  if (target.role !== "assistant") throw new Error("Only model replies can be regenerated.");

  return {
    targetMessageId,
    preservedBefore: messages.slice(0, index),
    replacedMessage: target,
    preservedAfter: messages.slice(index + 1),
    // The caller chooses whether descendants are retained as an alternate branch.
    requiresDescendantDecision: index < messages.length - 1
  };
}

export function commitRegeneration(messages, plan, replacement, { keepDescendants = false } = {}) {
  const prefix = plan.preservedBefore;
  const suffix = keepDescendants ? plan.preservedAfter : [];
  return [...prefix, { ...replacement, regeneratedFromId: plan.targetMessageId }, ...suffix];
}

import {reconcilePhoneDependencies} from '../phone/phone-context.js';
import {validateVesperBackup,requireValidBackup} from '../backup/backup-validation.js';
import {canonicalMilestones,milestoneSupportsRelationship} from '../milestones/verifier.js';
import {isMemoryVisible} from '../memory/memory-manager.js';
const referenceFields=new Set(['sourceMessageId','sourceMessageIds','sourceMemoryId','sourceMemoryIds','sourceMilestoneId','sourceMilestoneIds','milestoneId','relationshipId']);
const list=value=>Array.isArray(value)?value:[];
const hidden=record=>['forgotten','deleted','excluded'].includes(record.status)||record.forgotten||record.deleted||record.excluded||record.forgottenAt||record.deletedAt||record.excludedAt;

// A branch edit is prepared on a copy. Unsupported aggregates are not salvaged
// by merely deleting citations: their prose can still contain discarded facts.
export function prepareVaultRegeneration(vault,targetMessageId){
 const target=vault.messages.find(m=>m.id===targetMessageId);
 if(!target||target.role!=='assistant')throw new Error('Only an existing model reply can be regenerated.');
 if(!vault.chats.some(c=>c.id===target.chatId&&c.storyId===target.storyId))throw new Error('Regeneration chat ownership does not match the story.');
 const chatMessages=vault.messages.filter(m=>m.storyId===target.storyId&&m.chatId===target.chatId).sort((a,b)=>{
  const x=Number(a.ordinal),y=Number(b.ordinal);return Number.isFinite(x)&&Number.isFinite(y)&&x!==y?x-y:String(a.createdAt||'').localeCompare(String(b.createdAt||''));
 });
 const index=chatMessages.findIndex(m=>m.id===target.id),removedMessageIds=new Set(chatMessages.slice(index).map(m=>m.id));
 let next=structuredClone(vault);next.messages=next.messages.filter(m=>!removedMessageIds.has(m.id));
 const unavailable={messages:new Set(removedMessageIds),memoryEntries:new Set(),milestones:new Set(),relationships:new Set()};
 const referenceType=key=>key.startsWith('sourceMessage')?'messages':key.startsWith('sourceMemory')?'memoryEntries':key==='relationshipId'?'relationships':'milestones';
 const gone=(key,id)=>unavailable[referenceType(key)].has(id);
 const unavailableCount=()=>Object.values(unavailable).reduce((sum,ids)=>sum+ids.size,0);
 function discard(record,collection){if(record&&typeof record==='object'){
  if(record.id&&record.storyId&&unavailable[collection])unavailable[collection].add(record.id);
  for(const child of Object.values(record))if(child&&typeof child==='object'){
   if(Array.isArray(child))child.forEach(record=>discard(record,collection));else discard(child,collection);
  }
 }}
 function survivingProof(record,owner){
  if(record.kind==='summary'||record.kind==='scene')return false;
  const text=record.evidence||record.text;
  if(typeof text!=='string'||!text.trim())return false;
  // A partial citation can retain plain canon only when its whole content is
  // quoted by surviving evidence. Structured facts need the exact JSON too.
  const data=record.data&&typeof record.data==='object'&&!Array.isArray(record.data)?Object.fromEntries(Object.entries(record.data).filter(([key])=>!referenceFields.has(key)&&key!=='key')):record.data;
  const details=[data&&Object.keys(data).length?JSON.stringify(data):null,record.value!=null?JSON.stringify(record.value):null].filter(Boolean);
  const matches=body=>typeof body==='string'&&body.includes(text)&&details.every(detail=>body.includes(detail));
  const sources=[record.sourceMessageId,...list(record.sourceMessageIds)];
  const messageProof=next.messages.some(m=>sources.includes(m.id)&&m.storyId===owner.storyId&&
   (!owner.chatId||m.chatId===owner.chatId)&&!m.provisional&&m.status!=='draft'&&
   (m.role==='user'||record.verification?.verifiedBy==='user')&&matches(m.text));
  const memorySources=[record.sourceMemoryId,...list(record.sourceMemoryIds)];
  const memoryProof=(next.memoryEntries||[]).some(m=>memorySources.includes(m.id)&&!gone("sourceMemoryId",m.id)&&m.storyId===owner.storyId&&m.kind==='canon'&&isMemoryVisible(m)&&matches(m.text));
  return messageProof||memoryProof;
 }
 function clean(value,owner={},collection='',preserveTombstone=false){
  if(Array.isArray(value))return value.map(v=>clean(v,owner,collection,preserveTombstone)).filter(v=>v!==undefined);
  if(!value||typeof value!=='object')return value;
  const own={storyId:value.storyId??owner.storyId,chatId:value.chatId??owner.chatId};
  const tombstone=preserveTombstone||(collection==='memoryEntries'&&hidden(value));
  const provenance={...(value.data&&!Array.isArray(value.data)&&typeof value.data==='object'?value.data:{}),...value};
  const broken=Object.keys(provenance).filter(key=>referenceFields.has(key)&&
   (Array.isArray(provenance[key])?provenance[key]:[provenance[key]]).some(id=>gone(key,id)));
  if(broken.length&&!tombstone){
   const messageOnly=broken.every(key=>key==='sourceMessageId'||key==='sourceMessageIds');
   const memoryOnly=broken.every(key=>key==='sourceMemoryId'||key==='sourceMemoryIds');
   const milestoneOnly=broken.every(key=>['sourceMilestoneId','sourceMilestoneIds','milestoneId'].includes(key));
   const remainingMilestones=[provenance.sourceMilestoneId,provenance.milestoneId,...list(provenance.sourceMilestoneIds)].filter(id=>id&&!gone("sourceMilestoneId",id));
   const supportedRelationship=milestoneOnly&&value.stage&&canonicalMilestones(next,own.storyId,own.chatId).some(m=>remainingMilestones.includes(m.id)&&milestoneSupportsRelationship(m,value,value.stage));
   if(!((messageOnly||memoryOnly)&&survivingProof(value,own))&&!supportedRelationship){
    const independentFacts=list(value.establishedFacts).some(fact=>typeof fact==='string'||(isMemoryVisible(fact)&&!Object.entries(fact).some(([key,refs])=>referenceFields.has(key)&&(Array.isArray(refs)?refs:[refs]).some(id=>gone(key,id)))));
    if(independentFacts)throw new Error('Regeneration cannot safely discard a relationship containing independent canonical facts. Original data was kept.');
    discard(value,collection);return undefined;
   }
  }
  const transient=(collection==='sceneStates'&&Object.hasOwn(value,'storyId')&&Object.hasOwn(value,'chatId'))||['summary','scene','legacy-story-stats','legacy-ledger'].includes(value.kind)||value.scope==='scene';
  const sourced=Object.keys(value).some(key=>referenceFields.has(key)&&value[key]!=null&&(!Array.isArray(value[key])||value[key].length));
  const historical=Number.isFinite(Date.parse(value.updatedAt))&&Number.isFinite(Date.parse(target.createdAt))&&Date.parse(value.updatedAt)<Date.parse(target.createdAt);
  if(!tombstone&&transient&&own.storyId===target.storyId&&own.chatId===target.chatId&&!sourced&&!historical){discard(value,collection);return undefined;}
  const result={};
  for(const [key,child] of Object.entries(value)){
   if(referenceFields.has(key)){
    if(Array.isArray(child))result[key]=child.filter(id=>!gone(key,id));
    else if(!gone(key,child))result[key]=child;
    else if(key==='sourceMessageId'&&!tombstone){
     const alternative=list(value.sourceMessageIds).find(id=>!gone("sourceMessageId",id)&&next.messages.some(m=>m.id===id&&m.storyId===own.storyId&&(!own.chatId||m.chatId===own.chatId)&&m.text?.includes(value.evidence||value.text)));
     if(alternative)result[key]=alternative;
    }
   }else{const cleaned=clean(child,own,collection,tombstone);if(cleaned!==undefined)result[key]=cleaned;}
  }
  return result;
 }
 // IDs removed through nested facts or derived ledgers can invalidate additional
 // collections. Repeat to a fixed point, without touching the caller's vault.
 let size;
 do{size=unavailableCount();const result={};for(const [key,value] of Object.entries(next))result[key]=clean(value,{},key);next=result;}while(unavailableCount()!==size);
 next=reconcilePhoneDependencies(next,{historicalBase:vault});
 requireValidBackup(validateVesperBackup(next),'regeneration');
 return {vault:next,targetMessageId,storyId:target.storyId,chatId:target.chatId,
  ordinal:Number.isFinite(Number(target.ordinal))?Number(target.ordinal):index,
  removedMessageIds:[...removedMessageIds],expectedRevision:vault.storageRevision};
}

export function completeVaultRegeneration(plan,replacement,usageEntries=[]){
 if(replacement.storyId!==plan.storyId||replacement.chatId!==plan.chatId||replacement.role!=='assistant'||replacement.id===plan.targetMessageId)throw new Error('Replacement message ownership does not match regeneration.');
 const next=structuredClone(plan.vault);next.messages.push({...replacement});
 next.usageEntries.push(...usageEntries);
 requireValidBackup(validateVesperBackup(next),'regenerated Vesper');return next;
}

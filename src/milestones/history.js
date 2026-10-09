import {scanMilestoneEvents,confirmMilestoneEvent,relationshipMilestoneKey} from './events.js';
import {validateCanonicalMilestone} from './verifier.js';
export function previewHistoricalMilestones(vault,storyId){
 if(!vault.stories.some(s=>s.id===storyId))throw new Error('Select a story before reviewing its history.');
 const messages=vault.messages.filter(m=>m.storyId===storyId).sort((a,b)=>String(a.chatId).localeCompare(String(b.chatId))||(a.ordinal??0)-(b.ordinal??0));
 const proposed=scanMilestoneEvents(vault,messages.map(m=>m.id)),existing=new Set(vault.milestones.map(m=>m.id)),grouped=new Map();
 for(const m of proposed.milestones.filter(m=>!existing.has(m.id))){const key=relationshipMilestoneKey(m),previous=grouped.get(key);if(!previous||validateCanonicalMilestone(m,proposed).ok)grouped.set(key,m);}
 return {storyId,signature:JSON.stringify(vault),revision:vault.storageRevision,additions:[...grouped.values()],scannedMessages:messages.length};
}
export function applyHistoricalMilestones(vault,preview,{confirmed=false,selectedIds=preview?.additions?.map(m=>m.id)||[]}={}){
 if(!confirmed)throw new Error('Confirm the historical milestone preview before saving.');
 if(!preview||preview.signature!==JSON.stringify(vault)||preview.revision!==vault.storageRevision)throw new Error('Story or storage changed. Refresh the milestone preview before saving.');
 if(!Array.isArray(selectedIds)||new Set(selectedIds).size!==selectedIds.length||selectedIds.some(id=>!preview.additions.some(m=>m.id===id)))throw new Error('Invalid milestone selection.');
 let next=structuredClone(vault);
 for(const m of preview.additions.filter(m=>selectedIds.includes(m.id))){
  if(next.milestones.some(row=>relationshipMilestoneKey(row)===relationshipMilestoneKey(m)&&validateCanonicalMilestone(row,next).ok))continue;
  next.milestones.push(structuredClone(m));
  if(m.status==='candidate')next=confirmMilestoneEvent(next,m.id);
  if(!validateCanonicalMilestone(next.milestones.find(row=>row.id===m.id),next).ok)throw new Error('Historical milestone evidence is no longer valid. Nothing was saved.');
 }
 return next;
}

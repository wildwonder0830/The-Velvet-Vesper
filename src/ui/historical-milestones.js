import {previewHistoricalMilestones,applyHistoricalMilestones} from '../milestones/history.js';
import {milestonePresentation} from '../milestones/events.js';
export function mountHistoricalMilestones(host,{getSnapshot,commit,isBusy,onDone,onError}){
 const doc=host.ownerDocument,node=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
 const controls=node('section');controls.className='data-card';
 const launch=node('button','Review historical milestones');launch.type='button';launch.className='ghost';
 const region=node('div');region.setAttribute('aria-live','polite');controls.append(launch,region);host.append(controls);
 let busy=false;
 const fail=message=>{const warning=node('p',message);warning.setAttribute('role','alert');region.prepend(warning);onError(message);};
 launch.onclick=async()=>{
  if(busy||isBusy())return;busy=true;launch.disabled=true;region.replaceChildren(node('p','Reading saved story history locally. No AI request or saved-data change.'));
  try{
   await new Promise(resolve=>setTimeout(resolve,0));const {vault,storyId}=getSnapshot(),preview=previewHistoricalMilestones(vault,storyId);
   region.replaceChildren(node('p',`${preview.scannedMessages} saved messages checked. ${preview.additions.length} proposed milestones. Nothing has been saved. Review each event and its participants before confirming.`));
   if(!preview.additions.length){region.append(node('p','No additional supported milestones found. Unnamed participants, pronoun-only exchanges and unsupported formats remain unawarded.'));return;}
   const choices=[];
   for(const milestone of preview.additions){const card=node('article');card.className='data-card';const label=node('label'),checkbox=node('input');checkbox.type='checkbox';checkbox.checked=milestone.status==='confirmed';checkbox.setAttribute('aria-label','Include '+milestone.title);choices.push({checkbox,id:milestone.id});
    const participants=milestone.participants.map(id=>[...vault.personas,...vault.characters].find(p=>p.id===id)?.name||id).join(' · '),chat=vault.chats.find(c=>c.id===milestone.chatId),source=vault.messages.find(m=>m.id===milestone.sourceMessageId);
    label.append(checkbox,doc.createTextNode(` ${milestonePresentation[milestone.type]?.icon||'✦'} ${milestone.title} — ${participants}`));card.append(label,node('p',milestone.status==='confirmed'?'Explicit player-authored completion':'Needs your verification — not yet canon'),node('p',`Chat: ${chat?.title||chat?.id} · Message ${source?.ordinal??'?'} · ${source?.createdAt||'Date unavailable'}`),node('blockquote',milestone.evidence));region.append(card);
   }
   const save=node('button','Confirm selected historical milestones');save.type='button';save.className='ghost';
   const cancel=node('button','Cancel preview');cancel.type='button';cancel.className='ghost';cancel.onclick=()=>region.replaceChildren(node('p','Preview cancelled. Nothing was saved.'));
   save.onclick=async()=>{
    if(busy||isBusy())return;const selectedIds=choices.filter(c=>c.checkbox.checked).map(c=>c.id);
    if(!selectedIds.length){fail('Select supported events before confirming. Nothing was saved.');return;}
    if(!doc.defaultView.confirm(`Record ${selectedIds.length} historical milestones for this story? Confirm that the selected events happened with the listed participants. Existing messages and milestone records will be preserved.`))return;
    busy=true;save.disabled=true;cancel.disabled=true;
    try{const current=getSnapshot().vault,next=applyHistoricalMilestones(current,preview,{confirmed:true,selectedIds});await commit(next,current.storageRevision);onDone(selectedIds.length);}catch(error){fail(error.message);}finally{busy=false;save.disabled=false;cancel.disabled=false;}
   };region.append(save,cancel);
  }catch(error){region.replaceChildren(node('p',error.message));onError(error.message);}finally{busy=false;launch.disabled=false;}
 };
}

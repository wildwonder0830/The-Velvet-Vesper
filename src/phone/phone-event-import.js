import {eventSourceCurrent,verifyEventProof,sha256,canonicalJSON} from './phone-event-evidence.js';
import {validateStoryPhone} from './phone-state.js';
import {validateVesperBackup,requireValidBackup} from '../backup/backup-validation.js';
import {buildPortableBackup,parseVesperBackup} from '../backup/vesper-backup.js';
import {saveVaultAtomic,VaultConflictError} from '../storage/vault-store.js';
const fail=message=>{throw new Error('Phone recovery: '+message+' Nothing was changed.');};
const fingerprint=v=>sha256(canonicalJSON(v));
function alreadyRepresented(vault,claim) {
 const e=claim.event;
 return vault.stories.filter(s=>s.id===e.storyId).flatMap(s=>s.phone?.threads||[]).filter(t=>t.chatId===e.chatId&&t.kind===claim.kind).some(t=>t.messages.some(m=>m.recovery&&m.text===e.text&&m.senderId===claim.senderId&&canonicalJSON([...m.audienceIds].sort())===canonicalJSON([...claim.audienceIds].sort())&&e.representations.some(r=>m.recovery.sourceMessageId===r.sourceMessageId&&m.recovery.start===r.start&&m.recovery.end===r.end)));
}
const recoveryMessage=(entry,now)=>{
 const c=entry.claim,e=c.event;
 return {id:'phone-event:'+e.id,storyId:e.storyId,chatId:e.chatId,senderId:c.senderId,senderType:c.senderType,text:e.text,audienceIds:[...c.audienceIds],createdAt:null,sourceMessageIds:c.sourceChecks.map(s=>s.id),
  recovery:{version:3,key:e.id,root:entry.root,proof:structuredClone(entry.proof),claim:structuredClone(c),sourceMessageId:e.sourceMessageId,start:e.start,end:e.end,sourceOrdinal:e.sourceOrdinal,transcriptOrder:e.sourceOrdinal,timestampText:e.timestampText||null,importedAt:now}};
};
function mergeContacts(story,claim) {
 story.phone??={version:1,contactDisplayNames:{},threads:[]};
 for(const contact of claim.contacts){
  story.phone.historicalContacts??=[];
  const old=story.phone.historicalContacts.find(c=>c.id===contact.id);
  if(old){if(old.canonicalName.toLocaleLowerCase()!==contact.canonicalName.toLocaleLowerCase())fail('An existing contact contradicts the verified identity.');}
  else story.phone.historicalContacts.push(structuredClone(contact));
 }
}
export function previewPhoneEvents(vault,packageData,now=new Date().toISOString()) {
 requireValidBackup(validateVesperBackup(vault),'Vesper');
 if(packageData?.version!==1||!Array.isArray(packageData.entries))fail('Unsupported event package.');
 const accepted=[],excluded=[],duplicates=[],seen=new Set(),existing=new Set(vault.stories.flatMap(s=>(s.phone?.threads||[]).flatMap(t=>t.messages.flatMap(m=>m.recovery?.version===3?[m.recovery.key]:[]))));
 const probe=structuredClone(vault);
 for(const entry of packageData.entries){
  const id=entry?.claim?.event?.id;
  if(!verifyEventProof(entry)){excluded.push({eventId:id||null,reason:'Unapproved or altered source/identity/audience evidence'});continue;}
  if(seen.has(id)||existing.has(id)||alreadyRepresented(vault,entry.claim)){duplicates.push(id);continue;}seen.add(id);
  try{
   const story=probe.stories.find(s=>s.id===entry.claim.event.storyId);if(!story)fail('Source story is unavailable.');
   mergeContacts(story,entry.claim);
   if(!eventSourceCurrent(recoveryMessage(entry,now),probe,{includeExcluded:true}))fail('Source, ownership, or identity no longer matches the verified ledger.');
   accepted.push(structuredClone(entry));
  }catch(error){excluded.push({eventId:id,reason:error.message});}
 }
 return {version:1,baseRevision:vault.storageRevision??null,baseFingerprint:fingerprint(vault),accepted,excluded,duplicates,createdAt:now};
}
export function applyPhoneEvents(vault,preview,{confirmed=false}={},now=new Date().toISOString()) {
 if(!confirmed)fail('Confirm the read-only preview before importing.');
 if(preview?.version!==1||preview.baseFingerprint!==fingerprint(vault))fail('The vault changed after preview; refresh and preview again.');
 if(preview.baseRevision!==null&&preview.baseRevision!==vault.storageRevision)throw new VaultConflictError(preview.baseRevision,vault.storageRevision);
 const checked=previewPhoneEvents(vault,{version:1,entries:preview.accepted},now);
 if(checked.excluded.length||checked.duplicates.length)fail('Preview evidence changed; refresh before importing.');
 const next=structuredClone(vault),events=checked.accepted.sort((a,b)=>a.claim.event.sourceOrdinal-b.claim.event.sourceOrdinal||a.claim.event.start-b.claim.event.start);
 for(const entry of events){
  const c=entry.claim,e=c.event,story=next.stories.find(s=>s.id===e.storyId);mergeContacts(story,c);
  const phone=story.phone;
  let t=phone.threads.find(t=>t.chatId===e.chatId&&t.historyConversationKeys?.includes(e.conversationId));
  if(!t&&c.kind==='private')t=phone.threads.find(t=>t.chatId===e.chatId&&t.kind==='private'&&t.participantIds.length===1&&t.participantIds[0]===c.participantIds[0]);
  // An empty default Story Cast can receive its proven historical group. A
  // populated/custom group is never selected merely because it is a group.
  if(!t&&c.kind==='group')t=phone.threads.find(t=>t.chatId===e.chatId&&t.kind==='group'&&t.title==='Story Cast'&&!t.messages.length&&canonicalJSON([...t.participantIds].sort())===canonicalJSON([...c.participantIds].sort()));
  if(!t){t={id:'phone-history:'+sha256(e.storyId+':'+e.chatId+':'+e.conversationId),storyId:e.storyId,chatId:e.chatId,kind:c.kind,title:c.title,participantIds:[...c.participantIds],...(c.contacts.length?{historicalOnly:true}:{}),createdAt:now,updatedAt:now,readThroughOrdinal:0,messages:[]};phone.threads.push(t);}
  t.historyConversationKeys??=[];if(!t.historyConversationKeys.includes(e.conversationId))t.historyConversationKeys.push(e.conversationId);
  const message=recoveryMessage(entry,now);message.ordinal=Math.max(0,t.readThroughOrdinal,...t.messages.map(m=>m.ordinal))+1;t.messages.push(message);
 }
 for(const s of next.stories)validateStoryPhone(s,next);
 requireValidBackup(validateVesperBackup(next),'Vesper');return next;
}
// This is the only persistence entry point. Preparing or applying a preview is
// pure. A verified portable rollback checkpoint is returned BEFORE any write.
export async function preparePhoneEventCommit(vault,preview,options={}) {
 const checkpoint=buildPortableBackup(vault);
 requireValidBackup(validateVesperBackup(checkpoint),'Vesper');
 const text=JSON.stringify(checkpoint);parseVesperBackup(text);
 return {vault:applyPhoneEvents(vault,preview,options),checkpoint:text,checkpointSha256:sha256(text),expectedRevision:vault.storageRevision};
}
export async function commitPhoneEvents(db,vault,preview,{confirmed=false,onCheckpoint}={}) {
 if(!Number.isSafeInteger(vault.storageRevision))fail('Load the current persisted vault before importing.');
 const prepared=await preparePhoneEventCommit(vault,preview,{confirmed});
 if(preview.accepted.length&&typeof onCheckpoint!=='function')fail('Save the verified rollback backup before importing.');
 if(onCheckpoint)await onCheckpoint({text:prepared.checkpoint,sha256:prepared.checkpointSha256});
 return saveVaultAtomic(db,prepared.vault,{expectedRevision:prepared.expectedRevision});
}

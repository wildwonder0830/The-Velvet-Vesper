import { assistantTextVersions, historicalReplyVault } from "../chat/message-edit.js";
import {eventSourceCurrent} from './phone-event-evidence.js';
import {extendedCandidateIndex} from './phone-history-parser.js';
import {historyIdentities,proposedIdentity,historyContactId} from './phone-history-contacts.js';
import { makeId } from '../schema.js';

const text = (s, max = 120) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const ids = v => Array.isArray(v) && v.every(x => typeof x === 'string' && x.trim().length > 0) && new Set(v).size === v.length;
const fail = message => { throw new Error(`Phone data: ${message} Nothing was changed.`); };
export function getPhoneContacts(vault, storyId) {
  const story = vault.stories.find(s => s.id === storyId);
  if (!story) return [];
  const cast = new Set([story.primaryCharacterId, ...(story.characterIds || [])].filter(Boolean));
  return [...vault.characters.filter(c => cast.has(c.id)).map(c => ({id:c.id, canonicalName:c.name})),...(story.phone?.historicalContacts||[]).map(c=>({id:c.id,canonicalName:c.canonicalName,archiveOnly:true}))].map(c=>({...c,displayName:Object.hasOwn(story.phone?.contactDisplayNames||{},c.id)?story.phone.contactDisplayNames[c.id]:c.canonicalName}));
}
function owner(vault, storyId, chatId) {
  const story = vault.stories.find(s => s.id === storyId);
  if (!story || !vault.chats.some(c => c.id === chatId && c.storyId === storyId)) fail('Story chat is unavailable.');
  if (!vault.personas.some(p => p.id === story.personaId)) fail('Story persona is unavailable.');
  return story;
}
function edit(vault, storyId, change) {
  const next = structuredClone(vault), story = next.stories.find(s => s.id === storyId);
  if (!story?.phone) fail('Open the story phone first.');
  change(story); validateStoryPhone(story,next); return next;
}
export function ensureStoryPhone(vault, storyId, chatId, now = new Date().toISOString()) {
  owner(vault,storyId,chatId);
  const next = structuredClone(vault), story = next.stories.find(s => s.id === storyId);
  if (!story.phone) story.phone = {version:1,contactDisplayNames:{},threads:[]};
  const participantIds = getPhoneContacts(next,storyId).filter(c=>!c.archiveOnly).map(c => c.id);
  if (!story.phone.threads.some(t => t.kind === 'group') && participantIds.length) {
    story.phone.threads.push({id:makeId('phone-thread'),storyId,chatId,kind:'group',title:'Story Cast',participantIds,
      createdAt:now,updatedAt:now,readThroughOrdinal:0,messages:[]});
  }
  validateStoryPhone(story,next); return next;
}
export function openPrivateThread(vault, storyId, chatId, characterId, now = new Date().toISOString()) {
  const next = ensureStoryPhone(vault,storyId,chatId,now), story = next.stories.find(s => s.id === storyId);
  const contact = getPhoneContacts(next,storyId).find(c => c.id === characterId);
  if (!contact) fail('Contact is not in this story.');
  let thread = story.phone.threads.find(t => t.kind === 'private' && t.chatId === chatId && t.participantIds[0] === characterId);
  if (!thread) { thread = {id:makeId('phone-thread'),storyId,chatId,kind:'private',title:contact.canonicalName,
    participantIds:[characterId],...(contact.archiveOnly?{historicalOnly:true}:{}),createdAt:now,updatedAt:now,readThroughOrdinal:0,messages:[]}; story.phone.threads.push(thread); }
  return {vault:next,threadId:thread.id};
}
export function updatePhoneThread(vault, storyId, threadId, patch, now = new Date().toISOString()) {
  return edit(vault,storyId,story => {
    const t = story.phone.threads.find(t => t.id === threadId); if (!t) fail('Thread not found.');
    if (patch.title !== undefined) { if (!text(patch.title)) fail('Choose a group name of 1–120 characters.'); t.title = patch.title.trim(); }
    if (patch.participantIds !== undefined) {
      if (t.kind !== 'group' || !ids(patch.participantIds) || !patch.participantIds.length) fail('Select at least one group contact.');
      const cast = getPhoneContacts(vault,storyId).map(c => c.id);
      if (patch.participantIds.some(id => !cast.includes(id))) fail('Group contact is not in this story.');
      t.participantIds = [...patch.participantIds];
    }
    t.updatedAt = now;
  });
}
export function setContactDisplayName(vault, storyId, characterId, displayName) {
  if (!getPhoneContacts(vault,storyId).some(c => c.id === characterId)) fail('Contact is not in this story.');
  if (typeof displayName !== 'string' || displayName.length > 120) fail('Nickname must be at most 120 characters.');
  return edit(vault,storyId,s => {
    if (displayName.trim()) Object.defineProperty(s.phone.contactDisplayNames,characterId,{value:displayName.trim(),enumerable:true,writable:true,configurable:true});
    else delete s.phone.contactDisplayNames[characterId];
  });
}
export function appendPhoneMessage(vault, storyId, threadId, message) {
  return edit(vault,storyId,s => {
    const t = s.phone.threads.find(t => t.id === threadId); if (!t) fail('Thread not found.');
    if(t.historicalOnly)fail('Historical archives are read-only.');
    const audienceIds=[...new Set([s.personaId,...t.participantIds])];
    if ((message.storyId && message.storyId !== storyId) || (message.chatId && message.chatId !== t.chatId)) fail('Reply belongs to another story chat.');
    if (message.audienceIds && (!ids(message.audienceIds) || message.audienceIds.length !== audienceIds.length || !audienceIds.every(id=>message.audienceIds.includes(id)))) fail('Thread membership changed. Refresh before saving the reply.');
    const senderAllowed = message.senderType === 'persona' ? message.senderId === s.personaId : t.participantIds.includes(message.senderId);
    if (!senderAllowed) fail('Sender is not a current thread participant.');
    t.messages.push({...message,id:message.id || makeId('phone-message'),storyId,chatId:t.chatId,
      ordinal:Math.max(t.readThroughOrdinal,0,...t.messages.map(m => m.ordinal))+1,
      audienceIds,createdAt:message.createdAt || new Date().toISOString()});
    t.updatedAt = t.messages.at(-1).createdAt;
  });
}
export function markPhoneThreadRead(vault, storyId, threadId) {
  return edit(vault,storyId,s => {const t = s.phone.threads.find(t => t.id === threadId);if (!t) fail('Thread not found.');
    t.readThroughOrdinal = Math.max(t.readThroughOrdinal,0,...t.messages.map(m => m.ordinal));});
}
export function phoneUnreadCount(story) {
  return (story?.phone?.threads || []).reduce((n,t) => n + t.messages.filter(m => isPhoneMessageUnread(m,t)).length,0);
}
export const isPhoneMessageUnread=(message,thread)=>!message.recovery&&message.senderType==='character'&&message.ordinal>thread.readThroughOrdinal;
// Transcript history is a separate ordered section: its relation to live phone
// messages is unknown unless the source establishes a real send timestamp.
export function orderedPhoneMessages(thread) {
 const recovered=thread.messages.filter(m=>m.recovery).sort((a,b)=>a.recovery.transcriptOrder-b.recovery.transcriptOrder||a.recovery.start-b.recovery.start);
 return [...recovered,...thread.messages.filter(m=>!m.recovery)];
}
export function recoveredSourceCurrent(message,vault,{includeExcluded=false,candidateIndex}={}) {
 if(recoveredSourceMatches(message,vault,{includeExcluded,candidateIndex}))return true;
 const historical=includeExcluded?historicalReplyVault(vault,message.recovery?.importedAt):vault;
 return historical!==vault&&recoveredSourceMatches(message,historical,{includeExcluded});
}
function recoveredSourceMatches(message,vault,{includeExcluded=false,candidateIndex}={}) {
 if(message.recovery?.version===3)return eventSourceCurrent(message,vault,{includeExcluded});
 if(message.recovery?.version===2){const c=(candidateIndex||extendedCandidateIndex(vault,message.storyId,{includeExcluded})).get(message.recovery.key);return Boolean(c&&c.text===message.text&&c.chatId===message.chatId&&JSON.stringify(c.participantLabels)===JSON.stringify(message.recovery.participantLabels)&&c.senderLabel===message.recovery.senderLabel&&c.conversationKey===message.recovery.conversationKey&&JSON.stringify(c.sourceMessageIds)===JSON.stringify(message.sourceMessageIds)&&c.timestampText===message.recovery.timestampText);}
 if(!message.recovery)return true;
 const r=message.recovery,source=vault.messages.find(m=>m.id===r.sourceMessageId);
 if(!source||(!includeExcluded&&(['forgotten','retired','deleted','excluded'].includes(source.status)||source.forgotten||source.retired||source.deleted||source.excluded||source.forgottenAt||source.retiredAt||source.deletedAt||source.excludedAt)))return false;
 return source?.storyId===message.storyId&&source?.chatId===message.chatId&&typeof source.text==='string'&&source.text.slice(r.start,r.end)===message.text&&source.text.slice(r.headerStart,r.headerEnd)===r.contextText&&source.text.slice(source.text.lastIndexOf('\n',r.start-1)+1,r.start)===r.linePrefix;
}
export function phoneTimestampInstant(s) {
 const parts=typeof s==='string'&&s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
 if(!parts||!Number.isFinite(Date.parse(s)))return false;
 const [,year,month,day,hour,minute,second]=parts.map(Number),days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
 return year>0&&month>=1&&month<=12&&day>=1&&day<=days[month-1]&&hour<=23&&minute<=59&&second<=59;
}
function validateRecovery(m,vault,known,candidateIndex) {
 try{return validateRecoveryVersion(m,vault,known,candidateIndex);}catch(error){
  const historical=historicalReplyVault(vault,m.recovery?.importedAt);if(historical===vault)throw error;
  const index=m.recovery?.version===2?extendedCandidateIndex(historical,m.storyId,{includeExcluded:true}):undefined;
  return validateRecoveryVersion(m,historical,known,index);
 }
}
function validateRecoveryVersion(m,vault,known,candidateIndex) {
 if(m.recovery?.version===3){if(!eventSourceCurrent(m,vault,{includeExcluded:true}))fail('Invalid verified event evidence.');return;}
 if(m.recovery?.version===2){validateExtendedRecovery(m,vault,known,candidateIndex);return;}
 const r=m.recovery,source=vault.messages.find(s=>s.id===r?.sourceMessageId);
 if(!object(r)||r.version!==1||!source||!recoveredSourceCurrent(m,vault,{includeExcluded:true})||!Number.isSafeInteger(r.start)||r.start<0||!Number.isSafeInteger(r.end)||r.end<=r.start||r.end>source.text.length||!Number.isSafeInteger(r.headerStart)||r.headerStart<0||!Number.isSafeInteger(r.headerEnd)||r.headerEnd<r.headerStart||r.headerEnd>source.text.length||!(r.sourceOrdinal===null||Number.isFinite(r.sourceOrdinal))||!Number.isSafeInteger(r.sourcePosition)||r.sourcePosition<0||!text(r.senderLabel)||!ids(r.participantLabels)||!r.participantLabels.length||!Array.isArray(r.identities)||!text(r.importedAt)||!Number.isFinite(Date.parse(r.importedAt)))fail('Invalid recovered message source or metadata.');
 if(r.key!==JSON.stringify([m.storyId,m.chatId,r.sourceMessageId,r.start,r.end])||!Array.isArray(m.sourceMessageIds)||m.sourceMessageIds.length!==1||m.sourceMessageIds[0]!==r.sourceMessageId)fail('Invalid recovered source key.');
 const labels=[...new Set([r.senderLabel,...r.participantLabels])];
 if(!Number.isSafeInteger(r.transcriptOrder)||r.transcriptOrder<0)fail('Invalid recovered transcript order.');
 if(r.identities.length!==labels.length||r.identities.some(entry=>!object(entry)||!text(entry.label)||!labels.includes(entry.label)||!known.has(entry.id))||new Set(r.identities.map(entry=>entry.label)).size!==labels.length)fail('Invalid recovered sender identity.');
 const identities=Object.fromEntries(r.identities.map(entry=>[entry.label,entry.id]));
 if(identities[r.senderLabel]!==m.senderId)fail('Invalid recovered sender identity.');
 const audience=[...new Set(r.participantLabels.map(label=>identities[label]))];
 if(audience.length!==m.audienceIds.length||audience.some(id=>!m.audienceIds.includes(id)))fail('Recovered recipients do not match reviewed evidence.');
 const names=[...vault.personas.filter(p=>p.id===vault.stories.find(s=>s.id===m.storyId)?.personaId),...vault.characters];
 for(const label of labels){const matches=names.filter(p=>p.name?.toLocaleLowerCase()===label.toLocaleLowerCase());if(matches.length===1&&matches[0].id!==identities[label])fail('Recovered identity contradicts the source name.');}
 const header=r.contextText?.trim().replace(/^\*\*(.*?)\*\*$/,'$1');
 const group=header?.match(/^Group chat:\s*(.+?)\s*\(Members:\s*(.+?)\)$/i),privateBlock=header?.match(/^(?:Text conversation|Texts between):\s*(.+)$/i),inline=header?.match(/^([^:\n]+?) (?:texted|sent a text to|replied by text to) ([^:\n]+?):[ \t]*["“]/i);
 const cleanLabel=s=>s.trim().replace(/^\*\*(.*?)\*\*$/,'$1');
 const participants=group?group[2].split(',').map(cleanLabel):privateBlock?privateBlock[1].split(',').map(cleanLabel):inline?[cleanLabel(inline[1]),cleanLabel(inline[2])]:null;
 if(!participants||JSON.stringify(participants)!==JSON.stringify(r.participantLabels)||!r.linePrefix.toLocaleLowerCase().includes(r.senderLabel.toLocaleLowerCase()))fail('Recovered recipient or sender labels lack source evidence.');
 if(r.timestampText!==null&&(!text(r.timestampText)||!source.text.slice(r.headerEnd,r.end).includes('['+r.timestampText+']')))fail('Invalid recovered timestamp evidence.');
 if(r.timestampText!==null&&!phoneTimestampInstant(r.timestampText)&&!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(r.timestampText))fail('Invalid recovered send time.');
 const full=typeof r.timestampText==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(r.timestampText);
 if(full?m.createdAt!==r.timestampText||!phoneTimestampInstant(m.createdAt):m.createdAt!==null)fail('Recovered messages must preserve unknown send times.');
}
export function validateStoryPhone(story, vault) {
  if (story.phone === undefined) return;
  const p = story.phone;
  if (!object(p) || p.version !== 1 || !object(p.contactDisplayNames) || !Array.isArray(p.threads)) fail('Unsupported or incomplete phone format.');
  const castIds = new Set(getPhoneContacts(vault,story.id).map(c=>c.id));
  const characterIds = new Set(vault.characters.map(c => c.id)), historicalIds=new Set((p.historicalContacts||[]).map(c=>c.id)),known = new Set([story.personaId,...characterIds,...historicalIds]);
  const recoveredKnown = new Set([story.personaId,...castIds,...historicalIds]);
  validateHistoricalContacts(story,vault,recoveredKnown);
  const candidateIndex=p.threads.some(t=>t.messages?.some(m=>m.recovery?.version===2))?extendedCandidateIndex(vault,story.id,{includeExcluded:true}):null;
  for (const [id,name] of Object.entries(p.contactDisplayNames)) if ((!characterIds.has(id)&&!historicalIds.has(id)) || !text(name)) fail('Invalid contact nickname.');
  const threads = new Set(), messages = new Set(), privateKeys = new Set(), recoveryKeys=new Set();
  for (const t of p.threads) {
    if (!object(t) || !text(t.id) || threads.has(t.id)||t.historicalOnly!==undefined&&typeof t.historicalOnly!=='boolean'||t.historyConversationKeys!==undefined&&!ids(t.historyConversationKeys)) fail('Invalid or duplicate thread ID.');threads.add(t.id);
    owner(vault,story.id,t.chatId);
    if (t.storyId !== story.id || !['private','group'].includes(t.kind) || !text(t.title) || !ids(t.participantIds) || !t.participantIds.length || t.participantIds.some(id => !castIds.has(id))) fail('Invalid thread ownership or participants.');
    if (t.kind === 'private') {const key=JSON.stringify([t.chatId,[...t.participantIds].sort()]);if((!t.historicalOnly&&t.participantIds.length!==1) || privateKeys.has(key))fail('Invalid or duplicate private thread.');privateKeys.add(key);}
    if (![t.createdAt,t.updatedAt].every(v => typeof v === 'string' && Number.isFinite(Date.parse(v))) || !Number.isSafeInteger(t.readThroughOrdinal) || t.readThroughOrdinal < 0 || !Array.isArray(t.messages)) fail('Invalid thread timestamps or read cursor.');
    let ordinal=0;
    for (const m of t.messages) {
      if (!object(m) || !text(m.id) || messages.has(m.id)) fail('Invalid or duplicate message ID.');messages.add(m.id);
      if (m.storyId !== story.id || m.chatId !== t.chatId || !Number.isSafeInteger(m.ordinal) || m.ordinal <= ordinal || !text(m.text,80000) || (!m.recovery&&(typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt))))) fail('Invalid message content, time, or ownership.'); ordinal=m.ordinal;
      if (!ids(m.audienceIds) || (!m.audienceIds.includes(story.personaId)&&!(m.recovery?.version===2&&t.historicalOnly)) || !m.audienceIds.includes(m.senderId) || m.audienceIds.some(id => !known.has(id))) fail('Invalid historical message recipients.');
      if (!(m.senderType === 'persona' && m.senderId === story.personaId) && !(m.senderType === 'character' && characterIds.has(m.senderId)) && !([2,3].includes(m.recovery?.version)&&m.senderType==='contact'&&historicalIds.has(m.senderId))) fail('Invalid canonical sender.');
      if(m.recovery){validateRecovery(m,vault,m.recovery.version===2?recoveredKnown:known,candidateIndex);if(recoveryKeys.has(m.recovery.key))fail('Duplicate recovered message.');recoveryKeys.add(m.recovery.key);}
      for (const [field,collection] of [['sourceMessageIds','messages'],['sourceMemoryIds','memoryEntries'],['sourceMilestoneIds','milestones']]) {
        if (m[field] === undefined) continue;
        if (!ids(m[field]) || m[field].some(id => !vault[collection].some(r => r.id === id))) fail('Unavailable message provenance.');
        if (field !== 'sourceMemoryIds' && m[field].some(id => {const r=vault[collection].find(r=>r.id===id);return r.storyId!==story.id || (field === 'sourceMessageIds' && r.chatId && r.chatId!==t.chatId);})) fail('Provenance belongs to another story chat.');
      }
    }
  }
}

function validateHistoricalContacts(story,vault,known) {
 const p=story.phone,contacts=p.historicalContacts||[],aliases=p.historicalAliases||[];
 if(!Array.isArray(contacts)||!Array.isArray(aliases))fail('Invalid historical contacts or aliases.');
 const idsSeen=new Set(),namesSeen=new Set();
 for(const c of contacts){if(!object(c)||!text(c.id,500)||c.id!==historyContactId(story.id,c.canonicalName||'')||!text(c.canonicalName)||c.archiveOnly!==true||idsSeen.has(c.id)||namesSeen.has(c.canonicalName.toLocaleLowerCase())||!ids(c.sourceMessageIds)||!c.sourceMessageIds.length)fail('Invalid historical contact identity.');idsSeen.add(c.id);namesSeen.add(c.canonicalName.toLocaleLowerCase());
  if(c.sourceMessageIds.some(id=>{const source=vault.messages.find(m=>m.id===id);return !source||source.storyId!==story.id||!assistantTextVersions(source).some(text=>text.toLocaleLowerCase().includes(c.canonicalName.toLocaleLowerCase()));}))fail('Historical contact lacks source evidence.');
 }
 const seen=new Set();for(const a of aliases){if(!object(a)||!text(a.label)||seen.has(a.label.toLocaleLowerCase())||!known.has(a.id)||!ids(a.sourceMessageIds)||!a.sourceMessageIds.length)fail('Invalid historical contact alias.');seen.add(a.label.toLocaleLowerCase());
  if(a.sourceMessageIds.some(id=>{const source=vault.messages.find(m=>m.id===id);return !source||source.storyId!==story.id||!assistantTextVersions(source).some(text=>text.toLocaleLowerCase().includes(a.label.toLocaleLowerCase()));}))fail('Historical alias lacks source evidence.');
  const suggested=proposedIdentity(vault,story.id,a.label);if(suggested&&suggested!==a.id)fail('Historical alias contradicts the source identity.');
 }
}
function validateExtendedRecovery(m,vault,known,index) {
 const r=m.recovery,c=index?.get(r.key),source=vault.messages.find(s=>s.id===r.sourceMessageId);
 if(r.headerStart!==0||!Number.isSafeInteger(r.headerEnd)||r.headerEnd<r.end||r.headerEnd>(source?.text.length||0)||r.contextText!==null||!Number.isSafeInteger(r.sourcePosition)||r.sourcePosition<0||r.linePrefix!==source?.text.slice(source.text.lastIndexOf('\n',r.start-1)+1,r.start))fail('Invalid extended recovered source bounds.');
 if(!c||!recoveredSourceCurrent(m,vault,{includeExcluded:true,candidateIndex:index})||c.issues.some(i=>['recipients','continuation','time','delivery','sender'].includes(i))||!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start!==c.start||r.end!==c.end||r.sourceOrdinal!==c.sourceOrdinal||r.transcriptOrder!==c.transcriptOrder||r.format!==c.format||m.createdAt!==null||typeof r.importedAt!=='string'||!Number.isFinite(Date.parse(r.importedAt))||!Array.isArray(r.identities))fail('Invalid extended recovered source evidence.');
 const labels=[...new Set([r.senderLabel,...r.participantLabels])];
 if(r.identities.length!==labels.length||new Set(r.identities.map(x=>x.label)).size!==labels.length||r.identities.some(x=>!object(x)||!labels.includes(x.label)||!known.has(x.id)))fail('Invalid recovered contact identities.');
 const identities=Object.fromEntries(r.identities.map(x=>[x.label,x.id]));if(identities[r.senderLabel]!==m.senderId)fail('Recovered sender contradicts evidence.');
 const audience=[...new Set(r.participantLabels.map(n=>identities[n]))];if(audience.length!==m.audienceIds.length||audience.some(id=>!m.audienceIds.includes(id)))fail('Recovered recipients contradict evidence.');
 const names=historyIdentities(vault,m.storyId);for(const label of labels){const exact=names.filter(n=>n.name.toLocaleLowerCase()===label.toLocaleLowerCase()),suggested=proposedIdentity(vault,m.storyId,label);if(exact.length===1&&exact[0].id!==identities[label]||suggested&&suggested!==identities[label])fail('Recovered identity contradicts the canonical source.');const alias=vault.stories.find(s=>s.id===m.storyId).phone.historicalAliases?.find(a=>a.label.toLocaleLowerCase()===label.toLocaleLowerCase());if(alias?.id!==identities[label])fail('Recovered alias has not been reviewed.');}
}

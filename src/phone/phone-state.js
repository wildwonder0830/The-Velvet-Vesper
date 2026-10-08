import { makeId } from '../schema.js';

const text = (s, max = 120) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const ids = v => Array.isArray(v) && v.every(x => typeof x === 'string' && x.trim().length > 0) && new Set(v).size === v.length;
const fail = message => { throw new Error(`Phone data: ${message} Nothing was changed.`); };
export function getPhoneContacts(vault, storyId) {
  const story = vault.stories.find(s => s.id === storyId);
  if (!story) return [];
  const cast = new Set([story.primaryCharacterId, ...(story.characterIds || [])].filter(Boolean));
  return vault.characters.filter(c => cast.has(c.id)).map(c => ({id:c.id, canonicalName:c.name,
    displayName:Object.hasOwn(story.phone?.contactDisplayNames||{},c.id)?story.phone.contactDisplayNames[c.id]:c.name}));
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
  const participantIds = getPhoneContacts(next,storyId).map(c => c.id);
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
    participantIds:[characterId],createdAt:now,updatedAt:now,readThroughOrdinal:0,messages:[]}; story.phone.threads.push(thread); }
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
  return (story?.phone?.threads || []).reduce((n,t) => n + t.messages.filter(m => m.senderType === 'character' && m.ordinal > t.readThroughOrdinal).length,0);
}
export function validateStoryPhone(story, vault) {
  if (story.phone === undefined) return;
  const p = story.phone;
  if (!object(p) || p.version !== 1 || !object(p.contactDisplayNames) || !Array.isArray(p.threads)) fail('Unsupported or incomplete phone format.');
  const castIds = new Set(getPhoneContacts(vault,story.id).map(c=>c.id));
  const characterIds = new Set(vault.characters.map(c => c.id)), known = new Set([story.personaId,...characterIds]);
  for (const [id,name] of Object.entries(p.contactDisplayNames)) if (!characterIds.has(id) || !text(name)) fail('Invalid contact nickname.');
  const threads = new Set(), messages = new Set(), privateKeys = new Set();
  for (const t of p.threads) {
    if (!object(t) || !text(t.id) || threads.has(t.id)) fail('Invalid or duplicate thread ID.');threads.add(t.id);
    owner(vault,story.id,t.chatId);
    if (t.storyId !== story.id || !['private','group'].includes(t.kind) || !text(t.title) || !ids(t.participantIds) || !t.participantIds.length || t.participantIds.some(id => !castIds.has(id))) fail('Invalid thread ownership or participants.');
    if (t.kind === 'private') {const key=JSON.stringify([t.chatId,t.participantIds]);if(t.participantIds.length!==1 || privateKeys.has(key))fail('Invalid or duplicate private thread.');privateKeys.add(key);}
    if (![t.createdAt,t.updatedAt].every(v => typeof v === 'string' && Number.isFinite(Date.parse(v))) || !Number.isSafeInteger(t.readThroughOrdinal) || t.readThroughOrdinal < 0 || !Array.isArray(t.messages)) fail('Invalid thread timestamps or read cursor.');
    let ordinal=0;
    for (const m of t.messages) {
      if (!object(m) || !text(m.id) || messages.has(m.id)) fail('Invalid or duplicate message ID.');messages.add(m.id);
      if (m.storyId !== story.id || m.chatId !== t.chatId || !Number.isSafeInteger(m.ordinal) || m.ordinal <= ordinal || !text(m.text,80000) || (typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt)))) fail('Invalid message content, time, or ownership.'); ordinal=m.ordinal;
      if (!ids(m.audienceIds) || !m.audienceIds.includes(story.personaId) || !m.audienceIds.includes(m.senderId) || m.audienceIds.some(id => !known.has(id))) fail('Invalid historical message recipients.');
      if (!(m.senderType === 'persona' && m.senderId === story.personaId) && !(m.senderType === 'character' && characterIds.has(m.senderId))) fail('Invalid canonical sender.');
      for (const [field,collection] of [['sourceMessageIds','messages'],['sourceMemoryIds','memoryEntries'],['sourceMilestoneIds','milestones']]) {
        if (m[field] === undefined) continue;
        if (!ids(m[field]) || m[field].some(id => !vault[collection].some(r => r.id === id))) fail('Unavailable message provenance.');
        if (field !== 'sourceMemoryIds' && m[field].some(id => {const r=vault[collection].find(r=>r.id===id);return r.storyId!==story.id || (field === 'sourceMessageIds' && r.chatId && r.chatId!==t.chatId);})) fail('Provenance belongs to another story chat.');
      }
    }
  }
}

import { messagePersonaId } from "../personas/persona-store.js";
// Display-only attribution. Never infer a speaker from prose or another story.
export function messageSpeakerLabel(vault,message){
  const story=(vault.stories||[]).find(s=>s.id===message.storyId);
  if(!story)return message.role==='user'?'You':'Vesper';
  if(message.role==='user')return (vault.personas||[]).find(p=>p.id===messagePersonaId(vault,message))?.name||'You';
  const chat=(vault.chats||[]).find(c=>c.id===message.chatId&&c.storyId===story.id);
  const owned=new Set([story.primaryCharacterId,...(story.characterIds||[])].filter(Boolean));
  const chatCast=chat?.characterIds||chat?.participantIds;
  const eligible=Array.isArray(chatCast)?new Set(chatCast.filter(id=>owned.has(id))):owned;
  const explicit=message.speakerIds||message.characterIds||[message.characterId||message.speakerId||message.senderId].filter(Boolean);
  const ids=explicit.length?explicit:[...eligible];
  const names=[...new Set(ids)].filter(id=>eligible.has(id)).map(id=>(vault.characters||[]).find(c=>c.id===id&&(!c.storyId||c.storyId===story.id))?.name).filter(Boolean);
  return names.join(' · ')||'Vesper';
}

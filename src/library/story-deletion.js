import {storyPersonaIds} from '../personas/persona-store.js';
import {prepareVaultBranchDeletion} from '../chat/regeneration.js';
import {reconcilePhoneDependencies} from '../phone/phone-context.js';
import {validateVesperBackup,requireValidBackup} from '../backup/backup-validation.js';
// Pure preparation. Only an explicit confirmed UI action commits this candidate.
export function prepareStoryDeletion(vault,storyId){
 if(!vault.stories.some(s=>s.id===storyId))throw new Error('Story unavailable.');
 let next=structuredClone(vault);
 for(const chat of next.chats.filter(c=>c.storyId===storyId)){
  const first=next.messages.filter(m=>m.storyId===storyId&&m.chatId===chat.id).sort((a,b)=>(a.ordinal??0)-(b.ordinal??0))[0];
  if(first)next=prepareVaultBranchDeletion(next,first.id);
 }
 const remaining=next.stories.filter(s=>s.id!==storyId),cast=new Set(remaining.flatMap(s=>[s.primaryCharacterId,...s.characterIds||[]]).filter(Boolean)),personas=new Set(remaining.flatMap(storyPersonaIds));
 const retain=(rows,references)=>rows.filter(r=>r.storyId!==storyId||references.has(r.id)).map(r=>{if(r.storyId!==storyId)return r;const {storyId:removed,...shared}=r;return shared;});
 next.characters=retain(next.characters,cast);next.personas=retain(next.personas,personas);
 for(const key of ['messages','memoryEntries','milestones','relationships','statEvents','sceneStates','knowledgeEntries','loreEntries','usageEntries'])next[key]=next[key].filter(r=>r.storyId!==storyId);
 const knownCharacters=new Set(next.characters.map(c=>c.id)),knownPersonas=new Set(next.personas.map(p=>p.id));
 next.loreEntries=next.loreEntries.filter(r=>r.scope!=='character'||knownCharacters.has(r.characterId)).filter(r=>r.scope!=='persona'||knownPersonas.has(r.personaId));
 next.chats=next.chats.filter(c=>c.storyId!==storyId);next.stories=remaining;next=reconcilePhoneDependencies(next,{historicalBase:vault});next.updatedAt=new Date().toISOString();
 requireValidBackup(validateVesperBackup(next),'story deletion');return next;
}

import {makeId} from '../schema.js';
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
export const activePersonaId=story=>story?.personaBinding?.personaId||story?.personaId;
export const storyPersonaIds=story=>[...new Set([story?.personaId,activePersonaId(story),...(story?.personaBinding?.history||[]).map(h=>h.personaId)].filter(Boolean))];
export function personaAssignments(vault,id){return (vault.stories||[]).filter(s=>activePersonaId(s)===id);}
export function messagePersonaId(vault,message){const story=vault.stories.find(s=>s.id===message.storyId);if(message.personaId)return storyPersonaIds(story).includes(message.personaId)?message.personaId:null;return story?.personaBinding?.history.find(h=>h.messageIds.includes(message.id))?.personaId||story?.personaId;}
function references(vault,id){return vault.personas.some(p=>p.librarySourceId===id)||vault.stories.some(s=>storyPersonaIds(s).includes(id))||['messages','memoryEntries','milestones','relationships','knowledgeEntries'].some(k=>(vault[k]||[]).some(r=>r.personaId===id||r.senderId===id||r.knowerId===id||r.subjectId===id||[...(r.participants||[]),...(r.participantIds||[]),...(r.audienceIds||[])].includes(id)));}
export function savePersona(vault,data,{confirmShared=false}={}){
 if(!object(data)||typeof data.name!=='string'||!data.name.trim()||data.profile!==undefined&&!object(data.profile))throw new Error('Enter a name and a valid profile.');
 const previous=vault.personas.find(p=>p.id===data.id),assigned=previous?personaAssignments(vault,previous.id):[];
 if((assigned.length>1||assigned.some(s=>s.personaBinding?.shared))&&!confirmShared)throw new Error('Please confirm edits to a shared persona and its assigned stories.');
 if(data.tags!==undefined&&(!Array.isArray(data.tags)||data.tags.some(t=>typeof t!=='string')))throw new Error('Persona tags must be text.');
 const next=structuredClone(vault),now=new Date().toISOString();
 const row={...(previous||{}),...structuredClone(data),id:previous?.id||makeId('persona'),name:data.name.trim(),profile:{...(previous?.profile||{}),...(data.profile||{})},createdAt:previous?.createdAt||now,updatedAt:now};
 if(previous)row.versions=[...(previous.versions||[]),{name:previous.name,profile:structuredClone(previous.profile||{}),at:previous.updatedAt||previous.createdAt||now}];
 if(previous)next.personas[next.personas.findIndex(p=>p.id===previous.id)]=row;else next.personas.push(row);next.updatedAt=now;return next;
}
export function assignPersona(vault,storyId,personaId,{shared=false}={}){
 const next=structuredClone(vault),story=next.stories.find(s=>s.id===storyId),source=next.personas.find(p=>p.id===personaId);
 if(!story||!source||source.archived)throw new Error('Choose an available protagonist and story.');
 const now=new Date().toISOString(),oldId=activePersonaId(story),old=story.personaBinding;
 const history=[...(old?.history||[])];const known=new Set(history.flatMap(h=>h.messageIds));
 const messages=next.messages.filter(m=>m.storyId===storyId&&!known.has(m.id));history.push({personaId:oldId,at:now,messageIds:messages.map(m=>m.id)});
 let selected=source;
 if(!shared){selected={...structuredClone(source),id:makeId('persona'),storyId,librarySourceId:source.id,createdAt:now,updatedAt:now};delete selected.versions;next.personas.push(selected);}
 story.personaBinding={version:1,personaId:selected.id,shared:Boolean(shared),history};next.updatedAt=now;return next;
}
export function archivePersona(vault,id,{confirmed=false}={}){
 const next=structuredClone(vault),p=next.personas.find(p=>p.id===id);if(!p)throw new Error('Persona unavailable.');
 if(references(next,id)){if(!confirmed)throw new Error('Confirm archiving this assigned or historically referenced persona.');p.archived=true;}else next.personas=next.personas.filter(p=>p.id!==id);
 return next;
}
export function validatePersonaBindings(vault){
 const errors=[];if(Array.isArray(vault.personas))for(const p of vault.personas){if(!object(p))continue;if(p.archived!==undefined&&typeof p.archived!=='boolean')errors.push('Invalid archived persona.');if(p.versions!==undefined&&(!Array.isArray(p.versions)||p.versions.some(v=>!object(v)||typeof v.name!=='string'||!object(v.profile)||!Number.isFinite(Date.parse(v.at)))))errors.push('Invalid historical persona profile.');}
 if(!Array.isArray(vault.stories)||!Array.isArray(vault.personas)||!Array.isArray(vault.messages))return errors;for(const s of vault.stories){if(!object(s))continue;const b=s.personaBinding;if(b===undefined)continue;
 if(!object(b)||b.version!==1||typeof b.shared!=='boolean'||!Array.isArray(b.history)||!vault.personas.some(p=>p?.id===b.personaId)){errors.push('Invalid story persona assignment.');continue;}
 const p=vault.personas.find(p=>p?.id===b.personaId);if(!b.shared&&p.storyId!==s.id)errors.push('Independent persona assignment must belong to its story.');
 const used=new Set();for(const h of b.history){if(!object(h)||!vault.personas.some(p=>p?.id===h.personaId)||!Array.isArray(h.messageIds)||!Number.isFinite(Date.parse(h.at))){errors.push('Invalid historical persona assignment.');continue;}for(const id of h.messageIds){if(used.has(id)||!vault.messages.some(m=>m?.id===id&&m.storyId===s.id))errors.push('Invalid historical persona message ownership.');used.add(id);}}
 }return errors;
}
export function personaModelVault(vault,storyId){
 const story=vault.stories.find(s=>s.id===storyId);if(!story?.personaBinding)return {...vault,personas:vault.personas.map(p=>({...Object.fromEntries(Object.entries(p).filter(([k])=>k!=='versions')),...(p.versions?.length?{historicalNames:[...new Set(p.versions.map(v=>v.name))]}:{})}))};
 const id=activePersonaId(story),old=new Set(storyPersonaIds(story).filter(x=>x!==id));
 const personal=r=>old.has(r.personaId)||old.has(r.subjectId)||old.has(r.knowerId)||(r.participantIds||r.participants||[]).some(x=>old.has(x));
 const oldSources=new Set(vault.messages.filter(m=>m.storyId===storyId&&m.role==='user'&&old.has(messagePersonaId(vault,m))).map(m=>m.id));
 const sourced=r=>[r.sourceMessageId,...(r.sourceMessageIds||[])].some(x=>oldSources.has(x));
 const withheld=new Set(vault.memoryEntries.filter(r=>r.storyId===storyId&&(personal(r)||sourced(r)&&r.kind!=='canon'||old.size&&r.kind==='summary'&&!r.sourceMessageId&&!(r.sourceMessageIds||[]).length)).map(r=>r.id));
 let added;do{added=false;for(const r of vault.memoryEntries){if(!withheld.has(r.id)&&[r.sourceMemoryId,...(r.sourceMemoryIds||[])].some(x=>withheld.has(x))){withheld.add(r.id);added=true;}}}while(added);
 return {...vault,stories:vault.stories.map(s=>s.id===storyId?Object.fromEntries(Object.entries({...s,personaId:id}).filter(([k])=>k!=='personaBinding')):s),personas:vault.personas.map(p=>({...Object.fromEntries(Object.entries(p).filter(([k])=>k!=='versions')),...(p.versions?.length?{historicalNames:[...new Set(p.versions.map(v=>v.name))]}:{})})),memoryEntries:vault.memoryEntries.filter(r=>!withheld.has(r.id)),relationships:vault.relationships.filter(r=>r.storyId!==storyId||!personal(r)),knowledgeEntries:vault.knowledgeEntries.filter(r=>r.storyId!==storyId||(!personal(r)&&!sourced(r)&&![r.sourceMemoryId,...(r.sourceMemoryIds||[])].some(x=>withheld.has(x))))};
}
export function protagonistDirective(persona){return {rule:'The assigned player persona is authoritative for identity, species, body, abilities, preferences and limits. Never copy NPC traits, anatomy, memories or choices onto this protagonist. Preserve complete player agency; do not invent consent or personal history. Explicit hard limits override permissions and older conflicting prose. Earlier messages attributed to historical owners remain history; never transfer their anatomy, personal experiences or relationship state to the currently assigned player.',name:persona?.name,profile:persona?.profile||{},hardLimits:persona?.profile?.hardLimits||[],permanentCanon:persona?.profile?.permanentCanon||[]};}
// Explicit, story-scoped correction. Never migrate or mutate device storage implicitly.
export function prepareDevonHumanPersona(vault,storyId){
 const story=vault.stories.find(s=>s.id===storyId);if(!story||!vault.characters.some(c=>[story.primaryCharacterId,...(story.characterIds||[])].includes(c.id)&&c.name==='Devon Mercer'))throw new Error('This correction is only for Devon Mercer’s story.');
 const existing=vault.personas.find(p=>p.id===activePersonaId(story));if(!existing)throw new Error('Current protagonist unavailable.');
 const data={name:'Amanda',profile:{...structuredClone(existing.profile||{}),species:'Human',anatomy:'Human anatomy. No tail, feline ears, fur or claws.',abilities:'Human. No shifting abilities.',permanentCanon:[...(Array.isArray(existing.profile?.permanentCanon)?existing.profile.permanentCanon:[]),'Amanda is human. Devon’s feline anatomy and shifting belong exclusively to Devon.']}};
 const candidate=savePersona(vault,data);return assignPersona(candidate,storyId,candidate.personas.at(-1).id);
}
export function historicalPersonaVault(vault,asOf){
 if(!vault.personas.some(p=>p.versions?.length))return vault;
 const instant=Date.parse(asOf);
 return {...vault,personas:vault.personas.map(p=>{const versions=[...(p.versions||[]),{name:p.name,profile:p.profile,at:p.updatedAt||p.createdAt}].filter(v=>Number.isFinite(Date.parse(v.at))&&Date.parse(v.at)<=instant).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));const version=versions.at(-1)||p.versions?.[0];return version?{...p,name:version.name,profile:version.profile}:p;})};
}

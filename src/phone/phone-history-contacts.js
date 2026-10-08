// Reviewed archival identities are scoped to one story. They never become AI characters.
export const historyContactId=(storyId,name)=>'phone-contact:'+JSON.stringify([storyId,name.toLocaleLowerCase()]);
export function historyIdentities(vault,storyId) {
 const story=vault.stories.find(s=>s.id===storyId);if(!story)return [];
 const cast=new Set([story.primaryCharacterId,...story.characterIds||[]]);
 return [vault.personas.find(p=>p.id===story.personaId),...vault.characters.filter(c=>cast.has(c.id)),...(story.phone?.historicalContacts||[]).map(c=>({id:c.id,name:c.canonicalName}))].filter(Boolean);
}
export function historyIdentity(vault,storyId,label) {
 const story=vault.stories.find(s=>s.id===storyId),names=historyIdentities(vault,storyId),norm=s=>s.toLocaleLowerCase();
 const exact=names.filter(n=>norm(n.name)===norm(label));if(exact.length===1)return exact[0].id;
 const alias=(story?.phone?.historicalAliases||[]).filter(a=>norm(a.label)===norm(label)&&names.some(n=>n.id===a.id));return alias.length===1?alias[0].id:null;
}
export function proposedIdentity(vault,storyId,label) {
 const names=historyIdentities(vault,storyId),norm=s=>s.toLocaleLowerCase();
 const matches=names.filter(n=>norm(n.name.split(/\s|—/)[0])===norm(label));return matches.length===1?matches[0].id:null;
}
export function reviewNewContacts(vault,candidate,resolution) {
 const known=historyIdentities(vault,candidate.storyId),created=[];
 for(const proposed of resolution.newContacts||[]){
  if(!proposed||typeof proposed.label!=='string'||typeof proposed.canonicalName!=='string'||!proposed.canonicalName.trim()||proposed.canonicalName.length>120||!Object.keys(candidate.identities).some(label=>label.toLocaleLowerCase()===proposed.label.toLocaleLowerCase()))throw new Error('Phone sync: Choose a documented contact label and name. Nothing was changed.');
  const name=proposed.canonicalName,source=vault.messages.find(m=>m.id===candidate.sourceMessageId);
  if(name.toLocaleLowerCase()!==proposed.label.toLocaleLowerCase()&&!source?.text.toLocaleLowerCase().includes(name.toLocaleLowerCase()))throw new Error('Phone sync: A contact name must appear in the source. Nothing was changed.');
  if(known.some(n=>n.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw new Error('Phone sync: Map this label to its existing identity instead. Nothing was changed.');
  const contact={id:historyContactId(candidate.storyId,name),canonicalName:name,sourceMessageIds:[candidate.sourceMessageId],archiveOnly:true};
  if(!created.some(c=>c.id===contact.id))created.push(contact);
 }
 return created;
}

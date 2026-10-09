import {messagePersonaId,storyPersonaIds} from '../personas/persona-store.js';
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export const mentionsIdentity=(text,name)=>new RegExp('(?:^|[^\\p{L}\\p{N}])'+escape(name)+'(?![\\p{L}\\p{N}])','iu').test(text);
export function milestoneNames(vault,storyId,record){
 const story=vault.stories.find(s=>s.id===storyId),ids=new Set([...storyPersonaIds(story),story?.primaryCharacterId,...(story?.characterIds||[])]);
 const actors=[...vault.personas,...vault.characters].filter(r=>ids.has(r.id));
 const names=r=>[r.name,...(r.historicalNames||[]),...(r.versions||[]).map(v=>v.name),...(Array.isArray(r.aliases)?r.aliases:[])].filter(n=>typeof n==='string'&&n.trim());
 return [...new Set(names(record).flatMap(name=>{const first=name.trim().split(/\s+/)[0];return actors.filter(r=>names(r).some(n=>n.trim().split(/\s+/)[0]===first)).length===1?[name,first]:[name];}))];
}
export function evidenceIdentifies(vault,source,id,evidence){
 const record=[...vault.personas,...vault.characters].find(r=>r.id===id);if(!record)return false;
 if(milestoneNames(vault,source.storyId,record).some(n=>mentionsIdentity(evidence,n)))return true;
 return source.role==='user'&&messagePersonaId(vault,source)===id&&/^[\s*_>“"]*I\b/i.test(evidence);
}

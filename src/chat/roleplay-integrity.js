// Model-only quarantine: stored history and player-authored corrections are never rewritten.
export function roleplayMetaIssues(text){
 const prose=String(text||'').replace(/["“]([^"”]+)["”]/g,(quote,body,offset,all)=>{
  const before=all.slice(Math.max(0,offset-80),offset),after=all.slice(offset+quote.length,offset+quote.length+80);
  return /\b(?:said|say|asked|whispered|replied|murmured)\s*[, :]\s*$/i.test(before)||/^\s*[,—-]?\s*\w+(?:\s+\w+)?\s+(?:said|asked|whispered|replied|murmured)\b/i.test(after)?'':quote;
 });
 const ending=/\b(?:story|narrative|roleplay|scene)\s+(?:(?:(?:has|had)\s+)?(?:already\s+)?reached\s+(?:(?:a|its|the)\s+)?(?:(?:complete|natural|satisfying)\s+)?(?:conclusion|ending)|(?:is|was)\s+(?:now\s+)?(?:complete|finished|over)|(?:has|had)\s+(?:ended|concluded)|needs?\s+no\s+continuation)\b|\bno\s+(?:further\s+)?(?:continuation|narration|roleplay)\s+(?:is\s+)?(?:necessary|needed|required)\b|\bno need to continue[.!\s]*$|\bthe end of the (?:story|narrative|roleplay)\b/i;
 const writing=/\b(?:future|subsequent)\s+(?:responses|replies)\s+(?:will|shall|end|preserve)\b|\b(?:complete narrative beat|resolved narrative moments)\b|\b(?:from a narrative (?:perspective|standpoint)|narratively speaking|the narrative (?:arc|structure))\b|\bas an ai\b[^\n.!?]*\b(?:cannot|can't|won't|will not) continue\b/i;
 return ending.test(prose)||writing.test(prose)?[{type:'roleplay-meta',severity:'block',message:'Writing-process or story-ending commentary was withheld. No reply was saved; retry only by explicit user action.'}]:[];
}
export const roleplayContinuationRule=`ROLEPLAY INTEGRITY: Only the user may intentionally end or mark this roleplay complete. Sleeping (including characters already asleep), bonding, marriage, emotional resolution and peaceful scenes never authorize ending it. Old assistant declarations are not user-set completion. Produce immersive in-world narrative, not acknowledgments, writing-process commentary or claims that continuation is unnecessary. A complete response beat is not the end of the story. Finish the current response cleanly without declaring the story finished. Preserve established relationship status, continuity, canon, current consent, hard limits and character identity. Control NPCs and environment, not protagonist waking behavior, actions, thoughts or dialogue; only explicit MY TURN DRAFT MODE authorizes an editable protagonist draft, never submission.`;
export function assertRoleplayOpen(story){if(['finished','completed'].includes(story?.status)||story?.finished===true||story?.completed===true)throw new Error('This story is explicitly marked finished. Reopen it explicitly before continuing.');}
const collections=['memoryEntries','loreEntries','knowledgeEntries','sceneStates','relationships','milestones','statEvents'];
const references={sourceMessageId:'messages',sourceMessageIds:'messages',sourceMemoryId:'memoryEntries',sourceMemoryIds:'memoryEntries',sourceMilestoneId:'milestones',sourceMilestoneIds:'milestones',milestoneId:'milestones',relationshipId:'relationships',sourceRelationshipId:'relationships',sourceRelationshipIds:'relationships',sourceSceneId:'sceneStates',sourceSceneIds:'sceneStates',sourceKnowledgeId:'knowledgeEntries',sourceKnowledgeIds:'knowledgeEntries'};
const tombstone=row=>row&&(['forgotten','retired','deleted','excluded'].includes(row.status)||row.forgotten||row.deleted||row.excluded||row.forgottenAt||row.deletedAt||row.excludedAt);
export function projectRoleplayContext(vault){
 const unavailable=Object.fromEntries(['messages',...collections].map(k=>[k,new Set()]));
 for(const m of vault.messages||[])if(m.role==='assistant'&&roleplayMetaIssues(m.text).length)unavailable.messages.add(m.id);
 const tainted=value=>{if(!value||typeof value!=='object')return false;return Object.entries(value).some(([key,v])=>references[key]?(Array.isArray(v)?v:[v]).some(id=>unavailable[references[key]].has(id)):['text','evidence','summary','description'].includes(key)&&typeof v==='string'?roleplayMetaIssues(v).length>0:tainted(v));};
 let changed;do{changed=false;for(const key of collections)for(const row of vault[key]||[])if(!unavailable[key].has(row.id)&&tainted(row)){unavailable[key].add(row.id);changed=true;}}while(changed);
 const next={...vault,messages:(vault.messages||[]).filter(m=>!unavailable.messages.has(m.id))};
 for(const key of collections)next[key]=(vault[key]||[]).filter(row=>!unavailable[key].has(row.id)||key==='memoryEntries'&&tombstone(row));
 return next;
}

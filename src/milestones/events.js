import {milestoneNames,mentionsIdentity} from './participants.js';
import {makeId} from '../schema.js';
import {activePersonaId,messagePersonaId} from '../personas/persona-store.js';
import {validateCanonicalMilestone,canonicalMilestones} from './verifier.js';
export const milestonePresentation={first_kiss:{name:'First Kiss',icon:'💋',description:'A first kiss was shared.'},first_date:{name:'First Date',icon:'🌹',description:'A first date took place.'},love_confession:{name:'Confession',icon:'♥',description:'Love was confessed.'},bonded:{name:'Bonded',icon:'🔗',description:'A bond was established.'},mated:{name:'Mated',icon:'♾',description:'The mate bond was completed.'},fated:{name:'Fated',icon:'✨',description:'A fated bond was recognized.'},relationship_official:{name:'Together',icon:'♥',description:'A relationship was established.'},exclusive:{name:'Exclusive',icon:'🤝',description:'Exclusivity was established.'},engaged:{name:'Engaged',icon:'💍',description:'An engagement was established.'},married:{name:'Married',icon:'💍',description:'A marriage took place.'},plot_development:{name:'Story Turning Point',icon:'✦',description:'A completed story development was recorded.'}};
const patterns={relationship_official:/\b(?:became|are|we are|we're)\b[\s\S]*\b(?:partners|together|official|boyfriend|girlfriend)\b/i,exclusive:/\b(?:became|are|agreed to be)\b[\s\S]*\bexclusive\b/i,engaged:/\b(?:became|are|were|got)\s+engaged\b/i,married:/\b(?:became|are|were|got)\s+married\b/i,plot_development:/\b(?:completed (?:the |their )?(?:quest|mission)|solved (?:the |their )?mystery)\b/i,first_kiss:/\bfirst kiss\b|\bkissed\b[\s\S]*\bfirst time\b/i,first_date:/\bfirst date\b/i,love_confession:/\bconfessed\b[\s\S]*\blove\b|\bi love you\b/i,bonded:/\b(?:completed|established)\b[\s\S]*\bbond\b/i,mated:/\b(?:became|are|were) mated\b|\bcompleted\b[\s\S]*\bmate bond\b/i,fated:/\b(?:recognized|confirmed|discovered)\b[\s\S]*\bfated\b[\s\S]*\bbond\b/i};
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const mentions=(text,name)=>new RegExp('(?<![\\p{L}\\p{N}])'+escape(name)+'(?![\\p{L}\\p{N}])','iu').test(text);
const nonEvent=/\b(?:not|never|almost|nearly|didn['’]?t|did not|imagined|dreamed|would|could|might|may|will|wanted to|thought about|hypothetical)\b/i;
const excluded=m=>m.provisional||['draft','forgotten','retired','deleted','excluded'].includes(m.status)||['forgotten','retired','deleted','excluded'].some(k=>m[k]||m[k+'At']);
export const relationshipMilestoneKey=m=>JSON.stringify([m.storyId,m.type,[...(m.participants||m.participantIds||[])].sort(),...(m.type==='plot_development'?[m.sourceMessageId,m.evidence]:[])]);
export function scanMilestoneEvents(vault,messageIds){
 const next=structuredClone(vault);
 for(const id of messageIds){const m=next.messages.find(r=>r.id===id);if(!m||excluded(m)||!['user','assistant'].includes(m.role))continue;
  const s=next.stories.find(s=>s.id===m.storyId),c=next.chats.find(c=>c.id===m.chatId&&c.storyId===m.storyId);if(!s||!c)continue;
  const owner=m.role==='user'||m.personaId?messagePersonaId(next,m):s.personaBinding?.history?.find(h=>h.messageIds.includes(m.id))?.personaId||activePersonaId(s);
  const p=next.personas.find(p=>p.id===owner);if(!p?.name||m.role==='user'&&m.personaId&&m.personaId!==p.id)continue;
  for(const evidence of String(m.text||'').split(/\n+|(?<=[.!?])\s+/)){
   const names=milestoneNames(next,s.id,p),firstPerson=m.role==='user'&&/^[\s*_>“"]*I\b/i.test(evidence);
   if(nonEvent.test(evidence)||evidence.includes('?')||!firstPerson&&!names.some(n=>mentionsIdentity(evidence,n)))continue;
   const chars=next.characters.filter(x=>[s.primaryCharacterId,...(s.characterIds||[])].includes(x.id)&&x.name&&milestoneNames(next,s.id,x).some(n=>mentionsIdentity(evidence,n)));
   for(const [type,pattern] of Object.entries(patterns)){if(type==='engaged'&&/\bengaged\s+(?:in|with)\s+(?:a |the )?(?:conversation|work|battle|combat|task)\b/i.test(evidence))continue;if(!chars.length&&type!=='plot_development')continue;if(!pattern.test(evidence)||type==='bonded'&&/\bmate|fated\b/i.test(evidence))continue;
    const participants=[p.id,...chars.map(x=>x.id)],candidate={id:makeId('milestone'),storyId:s.id,chatId:c.id,type,title:milestonePresentation[type].name,participants,evidence,sourceMessageId:m.id,status:'candidate',createdAt:new Date().toISOString(),verification:{verified:false,completed:false,requiresContextVerification:true}};
    const key=relationshipMilestoneKey(candidate);
    if(next.milestones.some(x=>relationshipMilestoneKey(x)===key&&validateCanonicalMilestone(x,next).ok)||next.milestones.some(x=>x.sourceMessageId===m.id&&x.evidence===evidence&&relationshipMilestoneKey(x)===key))continue;
    // Source-authored completion, not scanner confidence or model inference.
    // Quotes, reported/remembered events and ambiguous subject attribution require review.
    const subject=evidence.trim().toLowerCase().startsWith(p.name.toLowerCase())||chars.some(x=>evidence.trim().toLowerCase().startsWith(x.name.toLowerCase()));
    const joint=chars.length===1&&new RegExp(`^(?:${escape(p.name)} and ${escape(chars[0].name)}|${escape(chars[0].name)} and ${escape(p.name)})\\s+(?:shared|had|went|completed|became|are|were|recognized|confirmed|discovered|confessed|exchanged|bonded)\\b`,'i').test(evidence.trim());
    const firstPersonEvent=firstPerson&&chars.length===1&&milestoneNames(next,s.id,chars[0]).some(n=>new RegExp(`^I\\s+kissed\\s+${escape(n)}\\s+for the first time[.!*\\s]*$`,'i').test(evidence.trim().replace(/[*_]/g,'')));
    const relationshipExplicit=type!=='relationship_official'||/\b(?:romantic partners|boyfriend|girlfriend|official|a couple)\b/i.test(evidence);
    const clear=relationshipExplicit&&m.role==='user'&&((joint&&subject)||firstPersonEvent)&&!/["“”]/.test(evidence)&&! /\b(?:research(?:ed|ing)?|stud(?:ied|ying)|learn(?:ed|ing)?|investigat(?:ed|ing)|attempt(?:ed|ing)?|prepar(?:ed|ing)|anticipated|said|told|discussed|described|describing|reported|pretended|planned|read|wrote|recalled|remembered|story|book|message|text|phone|about)\b/i.test(evidence);
    if(clear){const verified={...candidate,status:'confirmed',source:'user-authored-event',verification:{verified:true,completed:true,verifiedBy:'source-evidence',method:'explicit-user-event'}};if(validateCanonicalMilestone(verified,next).ok)Object.assign(candidate,verified);}
    next.milestones.push(candidate);
   }
  }
 }return next;
}
export function confirmMilestoneEvent(vault,id){
 const next=structuredClone(vault),m=next.milestones.find(x=>x.id===id&&x.status==='candidate');if(!m)throw new Error('Milestone candidate unavailable.');
 const source=next.messages.find(x=>x.id===m.sourceMessageId);if(!source||excluded(source)||!source.text.includes(m.evidence))throw new Error('Milestone evidence changed. Review the current story before confirming.');
 const s=next.stories.find(s=>s.id===m.storyId);if(!s||!m.participants.includes(activePersonaId(s)))throw new Error('Milestone evidence belongs to another protagonist.');
 m.status='confirmed';m.verification={verified:true,completed:true,verifiedBy:'user',verifiedAt:new Date().toISOString()};
 if(!validateCanonicalMilestone(m,next).ok)throw new Error('Milestone evidence is invalid or does not describe a completed event.');
 if(vault.milestones.some(x=>relationshipMilestoneKey(x)===relationshipMilestoneKey(m)&&validateCanonicalMilestone(x,vault).ok))throw new Error('This relationship milestone is already earned.');return next;
}

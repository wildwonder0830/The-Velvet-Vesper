import {parseExtendedHistory} from './phone-history-parser.js';
import {historyIdentity,proposedIdentity,historyIdentities,reviewNewContacts} from './phone-history-contacts.js';
import {makeId} from '../schema.js';
import {getPhoneContacts,ensureStoryPhone,openPrivateThread,validateStoryPhone,phoneTimestampInstant,recoveredSourceCurrent} from './phone-state.js';

const fail=message=>{throw new Error(`Phone sync: ${message} Nothing was changed.`);};
const keyFor=(storyId,chatId,id,start,end)=>JSON.stringify([storyId,chatId,id,start,end]);
const snapshot=vault=>JSON.stringify(vault);
const clean=s=>s.trim().replace(/^\*\*(.*?)\*\*$/,'$1');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const instant=phoneTimestampInstant;
const withheld=m=>['forgotten','retired','deleted','excluded'].includes(m.status)||m.forgotten||m.retired||m.deleted||m.excluded||m.forgottenAt||m.retiredAt||m.deletedAt||m.excludedAt;

// Only explicit sent-text grammar is eligible. No inference from Story roles,
// current cast membership, a summary, or the renderer's visual bubble styling.
export function scanPhoneHistory(vault,storyId) {
 const story=vault.stories.find(s=>s.id===storyId);
 if(!story)fail('Story is unavailable.');
 const identities=[vault.personas.find(p=>p.id===story.personaId),...getPhoneContacts(vault,storyId).map(c=>({id:c.id,name:c.canonicalName}))].filter(Boolean);
 const identify=label=>{const matches=identities.filter(p=>p.name?.toLocaleLowerCase()===label.toLocaleLowerCase());return matches.length===1?matches[0].id:null;};
 const candidates=[],existing=(story.phone?.threads||[]).flatMap(t=>t.messages),imported=new Set(existing.map(m=>m.recovery?.key).filter(Boolean)),seen=new Set();let duplicateCount=0;
 // Event imports can link multiple displays of one send. Withhold any legacy
 // candidate overlapping those proven source positions, never matching by text.
 const recoveredSpans=new Map();
 for(const message of existing){if(message.recovery?.version!==3||!recoveredSourceCurrent(message,vault,{includeExcluded:true}))continue;
  for(const span of message.recovery.claim.event.representations){const key=JSON.stringify([span.chatId,span.sourceMessageId]);if(!recoveredSpans.has(key))recoveredSpans.set(key,[]);recoveredSpans.get(key).push({start:span.start,end:span.end});}
 }
 const overlapsRecovered=(chatId,sourceId,start,end)=>(recoveredSpans.get(JSON.stringify([chatId,sourceId]))||[]).some(r=>start<r.end&&end>r.start);
 const sources=vault.messages.map((m,index)=>({...m,position:index})).filter(m=>m.storyId===storyId&&!withheld(m)&&typeof m.text==='string'&&!/^\s*\/(?:ooc|summary|memory|canon)\b/i.test(m.text)&&vault.chats.some(c=>c.id===m.chatId&&c.storyId===storyId));
 const missingOrder=new Set(sources.filter(m=>!Number.isFinite(m.ordinal)).map(m=>m.chatId)),ranks=new Map();
 sources.sort((a,b)=>a.chatId.localeCompare(b.chatId)||(missingOrder.has(a.chatId)?a.position-b.position:a.ordinal-b.ordinal)||a.position-b.position);
 for(const source of sources){source.transcriptOrder=ranks.get(source.chatId)||0;ranks.set(source.chatId,source.transcriptOrder+1);}
 for(const source of sources){
  let block=null,previous=null,offset=0,preamble='';
  const add=(body,start,senderLabel,participantLabels,kind,title,timestampText,headerStart,headerEnd)=>{
   if(!body.trim()||body.length>80000)return;
   const end=start+body.length,key=keyFor(storyId,source.chatId,source.id,start,end);
   if(imported.has(key)||overlapsRecovered(source.chatId,source.id,start,end)){duplicateCount++;previous=null;return;}
   const mapping=Object.fromEntries([...new Set([senderLabel,...participantLabels])].map(label=>[label,identify(label)]));
   const audienceIds=[...new Set(participantLabels.map(label=>mapping[label]).filter(Boolean))];
   const issues=[];
   if(Object.values(mapping).some(id=>!id))issues.push('identity');
   if(!participantLabels.length||new Set(participantLabels.map(s=>s.toLocaleLowerCase())).size!==participantLabels.length||!participantLabels.some(s=>s.toLocaleLowerCase()===senderLabel.toLocaleLowerCase())||(kind==='private'&&participantLabels.length!==2)||(kind==='group'&&participantLabels.length<2)||(!issues.includes('identity')&&!audienceIds.includes(story.personaId)))issues.push('recipients');
   if(block?.deliveryUncertain)issues.push('delivery');
   const opening=body.trimStart()[0],closing=opening==='“'?'”':'"';
   if(block&&['“','"'].includes(opening)&&(body.trimEnd().at(-1)!==closing||body.trim().length===1))issues.push('continuation');
   const threads=(story.phone?.threads||[]).filter(t=>t.chatId===source.chatId&&t.kind===kind);
   const matches=kind==='group'?threads.filter(t=>t.title.toLocaleLowerCase()===title.toLocaleLowerCase()):threads.filter(t=>t.participantIds[0]===audienceIds.find(id=>id!==story.personaId));
   const match=matches.length===1?matches[0]:null;
   if(kind==='group'&&!match&&threads.length)issues.push('thread');
   const signature=JSON.stringify([source.chatId,kind,mapping[senderLabel],audienceIds.slice().sort(),body]);
   if(seen.has(signature)||existing.some(m=>m.chatId===source.chatId&&m.senderId===mapping[senderLabel]&&same([...m.audienceIds].sort(),audienceIds.slice().sort())&&m.text===body))issues.push('repeat');
   seen.add(signature);
   if(timestampText&&!instant(timestampText)&&!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(timestampText))issues.push('time');
   const candidate={key,storyId,chatId:source.chatId,sourceMessageId:source.id,start,end,headerStart,headerEnd,sourceOrdinal:Number.isFinite(source.ordinal)?source.ordinal:null,sourcePosition:source.position,transcriptOrder:source.transcriptOrder,text:body,senderLabel,participantLabels,identities:mapping,senderId:mapping[senderLabel],audienceIds,kind,title,targetThreadId:match?.id||null,timestampText,createdAt:instant(timestampText)?timestampText:null,issues,status:issues.length?'uncertain':'ready',excerpt:source.text.slice(headerStart,Math.max(headerEnd,end))};
   candidates.push(candidate);previous=candidate;
  };
  for(const raw of source.text.split('\n')){
   const line=clean(raw),start=offset;offset+=raw.length+1;
   let match=line.match(/^Group chat:\s*(.+?)\s*\(Members:\s*(.+?)\)$/i);
   if(match){block={kind:'group',title:match[1],participants:match[2].split(',').map(clean),start,end:start+raw.length,deliveryUncertain:/\b(?:draft\w*|unsent|hypothetical|example|imagined|quotation|quoted)\b/i.test(preamble)};previous=null;preamble='';continue;}
   match=line.match(/^(?:Text conversation|Texts between):\s*(.+)$/i);
   if(match){block={kind:'private',title:null,participants:match[1].split(',').map(clean),start,end:start+raw.length,deliveryUncertain:/\b(?:draft\w*|unsent|hypothetical|example|imagined|quotation|quoted)\b/i.test(preamble)};previous=null;preamble='';continue;}
   if(/^Text messages:\s*$/i.test(line)){block={kind:'private',title:null,participants:[],start,end:start+raw.length};previous=null;continue;}
   match=raw.match(/^([^:\n]+?) (?:texted|sent a text to|replied by text to) ([^:\n]+?):[ \t]*(["“])([\s\S]*)(["”])[ \t]*$/i);
   if(match&&((match[3]==='"'&&match[5]==='"')||(match[3]==='“'&&match[5]==='”'))){
    const prefix=raw.indexOf(match[3])+1;add(match[4],start+prefix,clean(match[1]),[clean(match[1]),clean(match[2])],'private',null,null,start,start+raw.length);block=null;previous=null;continue;
   }
   if(!line){block=null;previous=null;continue;}
   if(!block){preamble=line;continue;}
   match=raw.match(/^(?:\[([^\]\n]+)\][ \t]*)?(?:\*\*)?([^:*\n]{1,120}?)(?:\*\*)?:(?:\*\*)?[ \t]?(.+)$/);
   if(match){add(match[3],start+raw.length-match[3].length,clean(match[2]),block.participants,block.kind,block.title,match[1]||null,block.start,block.end);continue;}
   if(previous){previous.issues.push('continuation');previous.status='uncertain';}
   block=null;previous=null;preamble=line;
  }
 }
 const contactProposals=[],extended=parseExtendedHistory(vault,storyId),echoKeys=new Set();let echoCount=0;
 const legacyKeys=new Set(candidates.map(c=>c.key));
 for(const raw of extended){
  if(legacyKeys.has(raw.key))continue;
  if(imported.has(raw.key)||overlapsRecovered(raw.chatId,raw.sourceMessageId,raw.start,raw.end)){duplicateCount++;continue;}
  const mapping=Object.fromEntries([...new Set([raw.senderLabel,...raw.participantLabels])].map(label=>[label,historyIdentity(vault,storyId,label)]));
  const suggestedIdentities=Object.fromEntries(Object.keys(mapping).map(label=>[label,proposedIdentity(vault,storyId,label)]));
  const audienceIds=[...new Set(raw.participantLabels.map(label=>mapping[label]).filter(Boolean))],issues=[...raw.issues];
  if(Object.values(mapping).some(id=>!id))issues.push('identity');
  const linked=(story.phone?.threads||[]).filter(t=>t.chatId===raw.chatId&&t.historyConversationKeys?.includes(raw.conversationKey));
  const matches=linked.length?linked:(raw.kind==='private'&&audienceIds.includes(story.personaId)?(story.phone?.threads||[]).filter(t=>t.chatId===raw.chatId&&t.kind==='private'&&t.participantIds.length===1&&t.participantIds[0]===audienceIds.find(id=>id!==story.personaId)):[]);
  const targetThreadId=matches.length===1?matches[0].id:null;
  if(raw.kind==='group'&&!targetThreadId)issues.push('thread');
  const signature=JSON.stringify([raw.chatId,raw.kind,raw.conversationKey,raw.senderLabel.toLocaleLowerCase(),raw.participantLabels.map(x=>x.toLocaleLowerCase()).sort(),raw.text]);
  const echo=candidates.find(c=>c.version===2&&c.signature===signature&&c.sourceMessageId!==raw.sourceMessageId&&candidates.some(()=>true));
  if(echo){issues.push('repeat');if(echo.sourceOrdinal!==null&&raw.sourceOrdinal!==null&&raw.sourceOrdinal-echo.sourceOrdinal<=2){issues.push('echo');echoCount++;echoKeys.add(raw.key);}}
  if(existing.some(m=>m.chatId===raw.chatId&&m.senderId===mapping[raw.senderLabel]&&same([...m.audienceIds].sort(),audienceIds.slice().sort())&&m.text===raw.text))issues.push('repeat');
  const candidate={...raw,identities:mapping,suggestedIdentities,audienceIds,senderId:mapping[raw.senderLabel],targetThreadId,issues:[...new Set(issues)],signature};candidate.status=candidate.issues.length?'uncertain':'ready';candidates.push(candidate);
  for(const [label,id] of Object.entries(mapping))if(!id&&!suggestedIdentities[label]&&!contactProposals.some(p=>p.label===label)&&label!=='Unknown sender')contactProposals.push({label,sourceMessageId:raw.sourceMessageId,chatId:raw.chatId});
 }
 candidates.sort((a,b)=>a.chatId.localeCompare(b.chatId)||a.transcriptOrder-b.transcriptOrder||a.start-b.start);
 return {storyId,baseRevision:vault.storageRevision,sourceSnapshot:snapshot(vault),candidates,duplicateCount,contactProposals,echoCount};
}

export function resolvePhoneHistoryCandidate(vault,candidate,resolution={}) {
 if(candidate.version===2)return resolveExtendedCandidate(vault,candidate,resolution);
 if(candidate.issues.some(i=>['recipients','continuation','time','delivery'].includes(i)))fail('Resolve incomplete recipients, text boundaries, timestamps or actual delivery in the source before importing, or exclude this match.');
 if(candidate.status==='uncertain'&&resolution.confirmed!==true)fail('Explicitly resolve every selected uncertain match, or exclude it.');
 const story=vault.stories.find(s=>s.id===candidate.storyId),allowed=new Set([story.personaId,...getPhoneContacts(vault,story.id).map(c=>c.id)]);
 const identities={...candidate.identities};
 for(const label of Object.keys(identities))if(!identities[label])identities[label]=resolution.identities?.[label];
 if(Object.values(identities).some(id=>!allowed.has(id)))fail('Resolve each sender and recipient to an established story identity.');
 const audienceIds=[...new Set(candidate.participantLabels.map(label=>identities[label]))],senderId=identities[candidate.senderLabel];
 if(!audienceIds.includes(story.personaId)||!audienceIds.includes(senderId)||(candidate.kind==='private'&&audienceIds.length!==2))fail('Resolve the historical recipients; do not invent a conversation.');
 if(candidate.issues.includes('repeat')&&resolution.distinct!==true)fail('Resolve whether this is a separate sent message or exclude the repeated quotation.');
 const targetThreadId=resolution.targetThreadId||candidate.targetThreadId;
 if(targetThreadId){const t=story.phone?.threads.find(t=>t.id===targetThreadId);if(!t||t.chatId!==candidate.chatId||t.kind!==candidate.kind||(t.kind==='private'&&!audienceIds.includes(t.participantIds[0])))fail('Thread must belong to the originating story chat and conversation.');}
 if(candidate.issues.includes('thread')&&!targetThreadId)fail('Resolve the group thread explicitly.');
 return {...candidate,identities,audienceIds,senderId,targetThreadId};
}

export function applyPhoneHistory(vault,preview,{confirmed=false,selectedKeys=[],resolutions={}}={},now=new Date().toISOString()) {
 if(!confirmed)fail('Confirm the preview before saving.');
 if(!preview||preview.sourceSnapshot!==snapshot(vault)||preview.baseRevision!==vault.storageRevision)fail('Saved data or source text changed. Refresh the preview before retrying.');
 const current=scanPhoneHistory(vault,preview.storyId),keys=new Set(selectedKeys);
 if(keys.size!==selectedKeys.length)fail('Duplicate preview selection.');
 const selected=[];
 for(const key of keys){const shown=preview.candidates.find(c=>c.key===key),fresh=current.candidates.find(c=>c.key===key);if(!shown||!fresh||!same(shown,fresh))fail('Preview or source changed. Refresh the preview.');selected.push(resolvePhoneHistoryCandidate(vault,fresh,resolutions[key]));}
 if(!selected.length)return vault;
 let next=structuredClone(vault);
 const conversationTargets=new Map();
 for(const c of selected){if(c.version===2){const prior=conversationTargets.get(c.conversationKey);if(prior&&c.targetThreadId&&prior!==c.targetThreadId)fail('One historical conversation cannot be split across unrelated threads.');if(c.targetThreadId)conversationTargets.set(c.conversationKey,c.targetThreadId);}}
 for(const c of selected){
  if(c.version===2){next=appendExtendedCandidate(next,c,conversationTargets,now);continue;}
  if(!next.stories.find(s=>s.id===c.storyId).phone)next=ensureStoryPhone(next,c.storyId,c.chatId,now);
  let story=next.stories.find(s=>s.id===c.storyId),thread;
  if(c.kind==='private'){const other=c.audienceIds.find(id=>id!==story.personaId);thread=story.phone.threads.find(t=>t.kind==='private'&&t.chatId===c.chatId&&t.participantIds[0]===other);if(!thread){const r=openPrivateThread(next,c.storyId,c.chatId,other,now);next=r.vault;story=next.stories.find(s=>s.id===c.storyId);thread=story.phone.threads.find(t=>t.id===r.threadId);}}
  else{
   thread=story.phone.threads.find(t=>t.id===c.targetThreadId)||story.phone.threads.find(t=>t.chatId===c.chatId&&t.kind==='group'&&t.title.toLocaleLowerCase()===c.title.toLocaleLowerCase());
   if(!thread){thread={id:makeId('phone-thread'),storyId:c.storyId,chatId:c.chatId,kind:'group',title:c.title,participantIds:c.audienceIds.filter(id=>id!==story.personaId),createdAt:now,updatedAt:now,readThroughOrdinal:0,messages:[]};story.phone.threads.push(thread);}
  }
  const source=vault.messages.find(m=>m.id===c.sourceMessageId),lineStart=source.text.lastIndexOf('\n',c.start-1)+1;
  thread.messages.push({id:makeId('phone-message'),storyId:c.storyId,chatId:c.chatId,senderType:c.senderId===story.personaId?'persona':'character',senderId:c.senderId,text:c.text,audienceIds:c.audienceIds,createdAt:c.createdAt,ordinal:Math.max(thread.readThroughOrdinal,0,...thread.messages.map(m=>m.ordinal))+1,sourceMessageIds:[c.sourceMessageId],recovery:{version:1,key:c.key,sourceMessageId:c.sourceMessageId,start:c.start,end:c.end,headerStart:c.headerStart,headerEnd:c.headerEnd,contextText:source.text.slice(c.headerStart,c.headerEnd),linePrefix:source.text.slice(lineStart,c.start),sourceOrdinal:c.sourceOrdinal,sourcePosition:c.sourcePosition,transcriptOrder:c.transcriptOrder,senderLabel:c.senderLabel,participantLabels:c.participantLabels,identities:Object.entries(c.identities).map(([label,id])=>({label,id})),timestampText:c.timestampText,importedAt:now}});
 }
 for(const s of next.stories)validateStoryPhone(s,next);
 return next;
}

function resolveExtendedCandidate(vault,c,resolution) {
 if(c.issues.some(i=>['recipients','continuation','time','delivery','sender'].includes(i)))fail('The source must establish complete text, actual delivery, sender and historical recipients. Exclude this match.');
 if(c.status==='uncertain'&&resolution.confirmed!==true)fail('Explicitly resolve each selected match first.');
 if(c.issues.includes('repeat')&&resolution.distinct!==true)fail('Exclude this echo, or explicitly confirm it is a distinct sent message.');
 if(c.issues.includes('membership')&&resolution.membershipConfirmed!==true)fail('Confirm the source-backed historical membership before importing.');
 const contacts=reviewNewContacts(vault,c,resolution),allowed=new Set([...historyIdentities(vault,c.storyId).map(n=>n.id),...contacts.map(n=>n.id)]),identities={...c.identities};
 for(const label of Object.keys(identities))if(!identities[label])identities[label]=resolution.identities?.[label]||contacts.find(n=>n.canonicalName.toLocaleLowerCase()===label.toLocaleLowerCase()||(resolution.newContacts||[]).some(p=>p.label.toLocaleLowerCase()===label.toLocaleLowerCase()&&p.canonicalName===n.canonicalName))?.id;
 if(Object.values(identities).some(id=>!allowed.has(id)))fail('Confirm each sender and recipient, including supporting contacts.');
 for(const label of Object.keys(identities)){const exact=historyIdentities(vault,c.storyId).filter(n=>n.name.toLocaleLowerCase()===label.toLocaleLowerCase());if(exact.length===1&&exact[0].id!==identities[label])fail('The reviewed identity contradicts the canonical source name.');}
 const audienceIds=[...new Set(c.participantLabels.map(n=>identities[n]))];if(audienceIds.length<2||!audienceIds.includes(identities[c.senderLabel]))fail('The reviewed recipients are incomplete.');
 const story=vault.stories.find(s=>s.id===c.storyId),targetThreadId=resolution.targetThreadId||c.targetThreadId;
 if((story.phone?.threads||[]).some(t=>t.chatId===c.chatId&&t.messages.some(m=>m.senderId===identities[c.senderLabel]&&m.text===c.text&&same([...m.audienceIds].sort(),audienceIds.slice().sort())))&&resolution.distinct!==true)fail('An existing phone message matches this text and identity. Exclude it or confirm a distinct sent message.');
 if(targetThreadId){const t=story.phone?.threads.find(t=>t.id===targetThreadId);if(!t||t.chatId!==c.chatId||t.kind!==c.kind)fail('Choose the originating chat’s matching thread.');if(c.kind==='private'&&!same([...new Set([story.personaId,...t.participantIds])].sort(),audienceIds.slice().sort()))fail('Private thread recipients do not match.');}
 if(c.kind==='group'&&!targetThreadId&&!resolution.createGroup)fail('Choose the original group or explicitly create its recovered archive.');
 return {...c,identities,audienceIds,senderId:identities[c.senderLabel],targetThreadId,newContacts:contacts};
}
function appendExtendedCandidate(vault,c,targets,now) {
 let next=vault;if(!next.stories.find(s=>s.id===c.storyId).phone)next=ensureStoryPhone(next,c.storyId,c.chatId,now);
 const story=next.stories.find(s=>s.id===c.storyId),p=story.phone;
 if(c.newContacts.length&&!p.historicalContacts)p.historicalContacts=[];
 for(const contact of c.newContacts){const existing=p.historicalContacts.find(n=>n.id===contact.id);if(existing){if(existing.canonicalName!==contact.canonicalName)fail('Conflicting reviewed contact identities.');existing.sourceMessageIds=[...new Set([...existing.sourceMessageIds,...contact.sourceMessageIds])];}else p.historicalContacts.push(contact);}
 p.historicalAliases||=[];
 for(const [label,id] of Object.entries(c.identities)){const existing=p.historicalAliases.find(a=>a.label.toLocaleLowerCase()===label.toLocaleLowerCase());if(existing&&existing.id!==id)fail('One alias cannot identify different contacts in this story.');const evidence=c.sourceMessageIds.filter(sourceId=>vault.messages.find(m=>m.id===sourceId)?.text.toLocaleLowerCase().includes(label.toLocaleLowerCase()));if(!evidence.length)fail('Alias has no documented source.');if(!existing)p.historicalAliases.push({label,id,sourceMessageIds:evidence});else existing.sourceMessageIds=[...new Set([...existing.sourceMessageIds,...evidence])];}
 const personaPresent=c.audienceIds.includes(story.personaId),participants=c.audienceIds.filter(id=>id!==story.personaId),npc=participants.some(id=>!next.characters.some(n=>n.id===id));
 let thread=p.threads.find(t=>t.id===(targets.get(c.conversationKey)||c.targetThreadId));
 if(!thread&&c.kind==='private')thread=p.threads.find(t=>t.chatId===c.chatId&&t.kind==='private'&&same([...t.participantIds].sort(),participants.slice().sort())&&Boolean(t.historicalOnly)===Boolean(!personaPresent||npc));
 if(!thread){thread={id:makeId('phone-thread'),storyId:c.storyId,chatId:c.chatId,kind:c.kind,title:c.kind==='group'?c.title:participants.map(id=>historyIdentities(next,c.storyId).find(n=>n.id===id)?.name).join(' ↔ '),participantIds:participants,createdAt:now,updatedAt:now,readThroughOrdinal:0,messages:[],...(!personaPresent||npc||c.kind==='group'&&!c.targetThreadId?{historicalOnly:true}:{} )};p.threads.push(thread);}
 targets.set(c.conversationKey,thread.id);thread.historyConversationKeys=[...new Set([...(thread.historyConversationKeys||[]),c.conversationKey])];
 const source=next.messages.find(m=>m.id===c.sourceMessageId),lineStart=source.text.lastIndexOf('\n',c.start-1)+1;
 thread.messages.push({id:makeId('phone-message'),storyId:c.storyId,chatId:c.chatId,senderType:c.senderId===story.personaId?'persona':next.characters.some(n=>n.id===c.senderId)?'character':'contact',senderId:c.senderId,text:c.text,audienceIds:c.audienceIds,createdAt:null,ordinal:Math.max(thread.readThroughOrdinal,0,...thread.messages.map(m=>m.ordinal))+1,sourceMessageIds:c.sourceMessageIds,recovery:{version:2,key:c.key,sourceMessageId:c.sourceMessageId,start:c.start,end:c.end,headerStart:c.headerStart,headerEnd:c.headerEnd,contextText:null,linePrefix:source.text.slice(lineStart,c.start),sourceOrdinal:c.sourceOrdinal,sourcePosition:c.sourcePosition,transcriptOrder:c.transcriptOrder,senderLabel:c.senderLabel,participantLabels:c.participantLabels,identities:Object.entries(c.identities).map(([label,id])=>({label,id})),timestampText:c.timestampText,importedAt:now,conversationKey:c.conversationKey,format:c.format}});
 return next;
}

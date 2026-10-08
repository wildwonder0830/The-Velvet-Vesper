// Read-only text extraction. This module never creates contacts, saves, or calls a provider.
const excluded=m=>['forgotten','retired','deleted','excluded'].includes(m.status)||m.forgotten||m.retired||m.deleted||m.excluded||m.forgottenAt||m.retiredAt||m.deletedAt||m.excludedAt;
const norm=s=>s.trim().toLocaleLowerCase();
const unique=a=>[...new Map(a.filter(Boolean).map(s=>[norm(s),s])).values()];
const clean=s=>s.trim().replace(/^\*\*(.*?)\*\*$/,'$1');
const eqName=(a,b)=>norm(a)===norm(b)||norm(a).startsWith(norm(b)+' ')||norm(b).startsWith(norm(a)+' ');
const keyFor=(storyId,chatId,id,start,end)=>JSON.stringify([storyId,chatId,id,start,end]);
const clock=s=>/^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(s)||/^(?:0?[1-9]|1[0-2]):[0-5]\d\s*(?:AM|PM)$/i.test(s);
const cue=s=>/^(?:(?:Then|And then|Instead),?\s+)?(?:(?:A|The|Another|One|The next|The final|One final|A final|A second|A third|A fourth|A fifth)\s+(?:\w+\s+){0,2}(?:message|text)(?:\s+(?:arrived|appeared|followed|came|came through|from [\p{L}. ]+)){0,2}|Another arrived|Another appeared|A minute later|Two minutes later|Followed seventeen minutes later|And, most recently|Then|And|A few seconds passed|Then immediately|Then, finally|And finally|Beneath it|Followed by|A pause before the next)[.:]$/iu.test(s);
const narrative=s=>/^(?:She|He|His|Her|Amanda|Dane|Lucien|Rhydian|Mrs\. Pell|Maribel|Tessa|Cal|Julian)\b.{0,70}\b(?:said|spoke|didn|doesn|isn|wasn|looked|stared|smiled|laughed|grabbed|picked|put|pocketed|set|stood|went|turned|knew|read|held|reached|thought|tapped|locked|opened|closed|retrieved|noticed|appeared|waited|checked|was|had|took|could|did|would|felt|glanced)\b|^(?:The (?:phone|screen|typing|group|chat|photograph)|Three dots|The typing|Almost simultaneously|Silence|A pause|A beat|Then—|Returned\.|Stopped\.|Vanished\.|Appeared again\.|No (?:demand|attempt|interrogation)|Nothing suggesting|No fishing|Just [\p{L}]+ being|From beside|From across|Upstairs|Downstairs|Back in|Meanwhile|Instead:|The reply came|Then the tone|He hit send|She hit send)/iu.test(s);
const contactLabel=s=>/^[\p{Lu}][\p{L} .'-]{0,80}$/u.test(s)&&s.trim().split(/\s+/).length<=4&&!/[.!?]$/.test(s)&&!/^(?:The|Then|And|Another|A |From|Beneath|Followed|Respectfully|Also|Instead|His|Her|Two|Three|One|Motion|There|Nothing|On|He|She|Finally|Just|Inside|Solemnly|Screen|YOU|WE|I|IT|THIS|NO|YES|OKAY|GOOD|LONG|AMANDA'S PHONE)\b/i.test(s)&&!/(?:whispered|continued|immediately|read|followed|typed|arrived|later|privately|right away|back|bakery|timber|calling|sent|instantly|speed)$/i.test(s);
function marker(raw,known=[]) {
 const s=raw.trim().replace(/^>\s?/,'');
 let m=s.match(/^(?:\*\*)?([\p{Lu}][\p{L} .'-]{0,80}?)(?:\*\*)?\s*(?:→|->)\s*([\p{Lu}][\p{L} .'-]{0,80})(?:\*\*)?$/u);
 if(m)return {label:clean(m[1]),recipient:clean(m[2]),body:null,format:'arrow'};
 m=s.match(/^(?:\*\*)?([\p{Lu}][\p{L} .'-]{0,80}?)(?:\*\*)?\s*[—–]\s*(\d{1,2}:\d\d(?:\s*(?:AM|PM))?)(?:\s+(.*?))?(?:\*\*)?$/iu);
 if(m)return {label:clean(m[1]),timestamp:m[2],body:m[3]||null,format:'clock'};
 m=s.match(/^(?:\*\*)?([\p{Lu}][\p{L} .'-]{0,80}?)(?:\*\*)?:\s*(?:\*\*)?([\s\S]*?)(?:\*\*)?$/u);
 if(m&&contactLabel(clean(m[1])))return {label:clean(m[1]),body:m[2]||null,format:'label'};
 if(known.some(n=>norm(n)===norm(s))&&contactLabel(s)&&/^[\p{Lu}][\p{Lu} .'-]{1,80}$/u.test(s)&&s.split(/\s+/).length<=4&&!/[.!?]$/.test(s))return {label:clean(s),body:null,format:'heading'};
 if(known.some(n=>norm(n)===norm(s))&&contactLabel(s)&&/^[\p{Lu}][\p{L}]+(?: [\p{Lu}][\p{L}.]+){0,2}$/u.test(s))return {label:s,body:null,format:'named-heading'};
 return null;
}
function knownLabels(vault,story) {
 const names=[vault.personas.find(p=>p.id===story.personaId)?.name,...vault.characters.filter(c=>[story.primaryCharacterId,...story.characterIds||[]].includes(c.id)).map(c=>c.name),...(story.phone?.historicalContacts||[]).map(c=>c.canonicalName)].filter(Boolean);
 const documented=vault.messages.filter(m=>m.storyId===story.id).flatMap(m=>[...m.text.matchAll(/(?:text from|private (?:message|thread) (?:from|with)) ([\p{Lu}][\p{L}.]+(?: [\p{Lu}][\p{L}.]+){0,2})|^([\p{Lu}][\p{L}. ]{0,80}?) [—–] \d{1,2}:\d\d/gmu)].map(m=>m[1]||m[2])).filter(contactLabel);const canonNames=vault.messages.filter(m=>m.storyId===story.id).flatMap(m=>[...m.text.matchAll(/\b([\p{Lu}][\p{Ll}]+(?: [\p{Lu}][\p{Ll}]+){1,2})\b/gu)].map(m=>m[1])).filter(contactLabel);return unique([...names,...documented,...canonNames].flatMap(n=>[n,n.split(/\s|—/)[0]]));
}
export function parseExtendedHistory(vault,storyId,{includeExcluded=false}={}) {
 const story=vault.stories.find(s=>s.id===storyId);if(!story)return [];
 const sources=vault.messages.map((m,position)=>({...m,position})).filter(m=>m.storyId===storyId&&typeof m.text==='string'&&(includeExcluded||!excluded(m))&&['assistant','user'].includes(m.role)&&vault.chats.some(c=>c.id===m.chatId&&c.storyId===storyId));
 const missing=new Set(sources.filter(m=>!Number.isFinite(m.ordinal)).map(m=>m.chatId));sources.sort((a,b)=>a.chatId.localeCompare(b.chatId)||(missing.has(a.chatId)?a.position-b.position:a.ordinal-b.ordinal)||a.position-b.position);
 const states=new Map(),results=[],labels=knownLabels(vault,story),persona=vault.personas.find(p=>p.id===story.personaId),personaLabel=persona?.name?.split(/\s|—/)[0]||null;
 const groupMarker=/\b(?:group chat|group message|group text|the group|typing indicators|three typing|the chat|message landed in|message appeared in)\b/i;
 for(const source of sources){
  const state=states.get(source.chatId)||{group:null,pair:null,owner:null,order:0};states.set(source.chatId,state);source.transcriptOrder=state.order++;
  // Keep the original strict grammar on its existing path. Never reinterpret its withheld examples.
  if(/^\s*\/(?:ooc|summary|memory|canon)\b|^\s*(?:OOC\b|\[?CANON SUMMARY|\[?STORY SUMMARY|\[?SUMMARY\b)/i.test(source.text)||source.role==='user'&&source.text.length>15000||/^(?:Text conversation|Texts between|Group chat:.*\(Members:|Text messages:)\s*/im.test(source.text))continue;
  const hasPhone=/\b(?:phone|texted|texting|text messages?|texts|message (?:landed|delivered|showed|appeared)|message reached|private message|group chat|group message|group text|typing indicator|notification|texted|messaged)\b/i.test(source.text)||groupMarker.test(source.text);
  if(!hasPhone||!/\b(?:text(?:ed|ing|s)?|messages?|messaged|group chat|buzzed|vibrated|screen|lit|woke|notification|typing|delivered|sent)\b|\[\[PHONE:/i.test(source.text))continue;
  if(/\b(?:voicemail|transcription identified|answered (?:her|his|the) phone|call connected|voice came through the phone)\b/i.test(source.text)&&!/(?:text from|texted|messaged|group chat|group message|private message|sent .{0,80}message)/i.test(source.text))continue;
  if(/\b(?:draft(?:ed)?|unsent|hypothetical|imagined|notes app)\b/i.test(source.text)&&!/(?:sent before|sent\.\s*delivered|hit send|message delivery confirmation|scheduled the message)/i.test(source.text))continue;
  const isGroup=groupMarker.test(source.text);
  let mode=isGroup&&state.group&&!/private (?:message|text|thread)/i.test(source.text)?'group':'private',pair=null,owner=null,lastSender=null,active=isGroup&&Boolean(state.group)||/phone.{0,120}(?:screen|buzzed|vibrated|lit)|screen.{0,50}(?:lit|glow)|app interface/iu.test(source.text),group=state.group;
  const lines=[];let offset=0;for(const raw of source.text.split('\n')){lines.push({raw,start:offset,end:offset+raw.length});offset+=raw.length+1;}
  const add=(start,end,label,participants,format,extra={})=>{
   if(end<=start||!source.text.slice(start,end).trim()||source.text.slice(start,end).trim()==='[No message.]')return;
   const members=unique((participants||[]).filter(contactLabel)),body=source.text.slice(start,end),issues=[];
   if(!members.length||!members.some(s=>eqName(s,label))||members.length<2)issues.push('recipients');
   if(extra.timestamp&&!clock(extra.timestamp))issues.push('time');
   if(label==='Unknown sender')issues.push('sender');
   if(/\b(?:She|He|Amanda) (?:sent that|then|looked|went|grabbed|set|had|started|picked)\b/.test(body))issues.push('continuation');
   if(extra.deliveryUncertain)issues.push('delivery');
   if(mode==='group')issues.push('membership');
   const dependencies=unique([source.id,...(mode==='group'?group?.sources||[]:[]),...(extra.dependencies||[]),...(mode==='private'&&state.ownerSource===source.id?[state.ownerSource]:[])]);
   results.push({version:2,key:keyFor(storyId,source.chatId,source.id,start,end),storyId,chatId:source.chatId,sourceMessageId:source.id,start,end,headerStart:0,headerEnd:source.text.length,sourceOrdinal:Number.isFinite(source.ordinal)?source.ordinal:null,sourcePosition:source.position,transcriptOrder:source.transcriptOrder,text:body,senderLabel:label,participantLabels:members,kind:mode==='group'?'group':'private',title:mode==='group'?group?.title||'Historical group':null,conversationKey:mode==='group'?group?.key||JSON.stringify([storyId,source.chatId,'unresolved-group',source.id]):JSON.stringify([storyId,source.chatId,'private',members.map(norm).sort()]),groupAliases:mode==='group'?group?.aliases||[]:[],timestampText:extra.timestamp||null,createdAt:null,sourceMessageIds:dependencies,issues,excerpt:source.text.slice(Math.max(0,start-350),Math.min(source.text.length,end+150)),format});lastSender=label;
  };
  // A declared new group with "all four" plus the four displayed speakers provides
  // proposed membership, not permission to substitute the current Story cast.
  if(/\b(?:started|created|new) (?:a |the )?group chat\b/i.test(source.text)&&!group){
   const following=sources[sources.indexOf(source)+1];const proof=[source,following?.chatId===source.chatId?following:null].filter(Boolean);
   const members=unique(proof.flatMap(m=>m.text.split('\n').map(raw=>marker(raw,labels)).filter(x=>x&&(x.label===x.label.toUpperCase()||labels.some(n=>norm(n)===norm(x.label)))).map(x=>x.label)).concat(/\bAMANDA:/i.test(source.text)?[personaLabel]:[]));
   group={key:JSON.stringify([storyId,source.chatId,'group',source.id]),title:'Historical group',aliases:[],members,sources:proof.map(m=>m.id),review:!proof.some(m=>/\ball four of us\b/i.test(m.text))||members.length!==4};state.group=group;mode='group';active=true;
  }
  for(const tag of source.text.matchAll(/\[\[PHONE:([^\]]+)\]\]([\s\S]*?)\[\[\/PHONE\]\]/g)){if(tag[2].includes('\n')){mode='private';const start=tag.index+tag[0].indexOf(tag[2]);add(start,start+tag[2].length,tag[1],null,'phone-tag');}}
  for(let i=0;i<lines.length;i++){
   const line=lines[i],s=clean(line.raw);if(!s)continue;
   if(/\b(?:answered|placed|made|took|connected|calling|voicemail)\b.*\b(?:call|phone)\b|\b(?:call connected|voicemail transcription|CALLING)\b/i.test(s)){active=false;pair=null;lastSender=null;}
   // Delivery context and actual device owner are separate from Story record role.
   let m=s.match(/\b([\p{Lu}][\p{L}.]+(?: [\p{Lu}][\p{L}.]+){0,2})(?:'s|’s) (?:own |personal |cell )?phone\b/u);
   if(m&&contactLabel(m[1])){owner=m[1];state.owner=owner;state.ownerSource=source.id;active=true;}
   m=s.match(/\b([\p{Lu}][\p{L}.]+) (?:reached into (?:her|his) purse and brought out|brought out|picked up|pulled out|checked) (?:her|his) phone\b/u);
   if(m&&contactLabel(m[1])){owner=m[1];state.ownerSource=source.id;active=true;}
   m=s.match(/\b([\p{Lu}][\p{L}.]+)(?:'s|’s) private message reached ([\p{Lu}][\p{L}.]+(?: [\p{Lu}][\p{L}.]+)?)/u)||s.match(/\b([\p{Lu}][\p{L}.]+) (?:had )?sent ([\p{Lu}][\p{L}.]+) a private message/u);
   if(m){pair=[m[1],m[2]];state.pair=pair;mode='private';active=true;}
   m=s.match(/\b([\p{Lu}][\p{L}.]+) typed, (?:her|his) (?:first |next )?message to ([\p{Lu}][\p{L}.]+(?: [\p{Lu}][\p{L}.]+)?) went through\b/u);
   if(m){pair=[m[1],m[2]];state.pair=pair;mode='private';active=true;}
   m=s.match(/\b(?:private (?:message|text)(?: appeared)? from|private thread (?:from|with)|notification from) ([\p{Lu}][\p{L}.]+(?: [\p{Lu}][\p{L}.]+)?)/u);
   if(m){const sender=m[1];pair=owner?[owner,sender]:pair?.some(n=>eqName(n,sender))?pair:null;state.pair=pair;mode='private';active=true;lastSender=sender;
    // A delivered private-message introduction can label the following plain
    // paragraphs without assigning the previous group's sender or audience.
    let j=i+1;while(j<lines.length&&!clean(lines[j].raw))j++;
    if(s.endsWith(':')&&j<lines.length&&!marker(lines[j].raw,labels)&&!narrative(clean(lines[j].raw))&&!cue(clean(lines[j].raw))){let end=lines[j].end,k=j+1;while(k<lines.length){const next=clean(lines[k].raw);if(!next){k++;continue;}if(marker(lines[k].raw,labels)||cue(next)||narrative(next))break;end=lines[k].end;k++;}add(lines[j].start,end,sender,pair,'private-from');i=k-1;continue;}
   }
   m=s.match(/^([\p{Lu}][\p{L}.]+) .{0,90}\bsent ([\p{Lu}][\p{L}.]+) a message/u);
   if(m&&contactLabel(m[1])&&contactLabel(m[2])){owner=m[1];state.owner=owner;state.ownerSource=source.id;pair=[m[1],m[2]];state.pair=pair;mode='private';active=true;}
   if(/\b(?:group chat|group message|back in the group|message (?:landed|appeared) in)\b/i.test(s)&&group){mode='group';active=true;}
   m=s.match(/^(?:Group Chat\s*[—–]\s*|(?:The message (?:landed|appeared) in ))(.+?)(?:\s+\d+ unread messages|\.)?$/i);
   if(m&&group){const title=m[1].trim();if(!group.aliases.some(t=>norm(t)===norm(title))){group.aliases.push(title);if(group.title!=='Historical group'&&norm(group.title)!==norm(title))group.review=true;}group.title=title;mode='group';active=true;}
   m=s.match(/([\p{Lu}][\p{L}. ]{0,80}?) changed (?:the )?group (?:chat )?name to [“"](.+?)[”"]/u);
   if(m&&group){group.title=m[2];group.aliases=unique([...group.aliases,m[2]]);group.sources=unique([...group.sources,source.id]);}
   m=s.match(/^([\p{Lu}][\p{L}. ]{0,80}?) left (?:the conversation|the chat|the group chat)\.?$/u);
   if(m&&group){const matches=group.members.filter(n=>eqName(n,m[1]));if(matches.length===1)group.members=group.members.filter(n=>n!==matches[0]);else group.review=true;group.sources=unique([...group.sources,source.id]);continue;}
   m=s.match(/^Amanda added ([\p{Lu}][\p{L}. ]{0,80}?)\.?$/u);
   if(m&&group){const known=labels.filter(n=>eqName(n,m[1]));const name=known.sort((a,b)=>a.length-b.length)[0]||m[1];if(!group.members.some(n=>eqName(n,name)))group.members.push(name);group.sources=unique([...group.sources,source.id]);continue;}
   // Explicit inline sender marks; take the complete source slice, never a rewritten body.
   const inline=[...line.raw.matchAll(/\b(AMANDA):[ \t]*/gi)];
   if(inline.length){
    const mark=inline[0],prefix=line.raw.slice(0,mark.index);const sent=prefix.match(/\b(?:texted|messaged|message(?:d)? (?:to|in)|sent (?:a |a group )?message (?:to|in)|responded to|replied to)\s+(.+?)(?:\s+(?:first|again|directly))?[ .]*$/i);
    if(sent||/\b(?:group chat|group message|started a group)\b/i.test(prefix)){
     const groupTarget=/\b(?:group|all of them)\b/i.test(prefix);if(groupTarget){mode='group';active=true;}else if(sent){const recipient=sent[1].replace(/\b(?:first|again|directly)\b/gi,'').trim();pair=contactLabel(recipient)?[personaLabel,recipient]:null;state.pair=pair;owner=personaLabel;mode='private';active=true;}
     const start=line.start+mark.index+mark[0].length;let end=line.end;
     // Continue over plain paragraphs only; labels/actions delimit rather than get swallowed.
     let j=i+1;while(j<lines.length){const next=clean(lines[j].raw);if(!next){j++;continue;}if(marker(lines[j].raw,labels)||cue(next)||narrative(next))break;end=lines[j].end;j++;}
     add(start,end,mark[1],mode==='group'?group?.members:pair,'inline');i=Math.max(i,j-1);continue;
    }
   }
   m=s.match(/\bA text from ([\p{Lu}][\p{L}. ]{0,80}?):[ \t]*(.+)$/u);
   if(m){mode='private';active=true;const start=line.start+line.raw.lastIndexOf(m[2]);add(start,line.end,m[1],owner?[owner,m[1]]:null,'text-from');pair=owner?[owner,m[1]]:null;continue;}
   m=s.match(/\[\[PHONE:([^\]]+)\]\]([\s\S]*?)\[\[\/PHONE\]\]/);
   if(m){mode='private';const start=line.start+line.raw.indexOf(m[2]);add(start,start+m[2].length,m[1],null,'phone-tag');continue;}
   const decorated=line.raw.match(/^\s*(\*\*|\*)([^*].+?)\1\s*$/);
   if(decorated&&(decorated[1]==='**'||/^The message (?:had sat drafted|was (?:sent|delivered))\b/i.test(lines.slice(i+1).find(l=>l.raw.trim())?.raw.trim()||''))&&!decorated[2].includes('*')&&!/\b(?:thought|imagined|wondered|remembered)\b/i.test(line.raw)&&!marker(line.raw,labels)&&/\b(?:text|message|typed|sent before|hit send)\b/i.test(lines.slice(Math.max(0,i-3),Math.min(lines.length,i+4)).map(l=>l.raw).join(' '))&&!/\b(?:notes app|voicemail|call connected)\b/i.test(lines.slice(Math.max(0,i-3),i+1).map(l=>l.raw).join(' '))){const start=line.start+line.raw.indexOf(decorated[2]);const priorMode=mode;mode='private';add(start,start+decorated[2].length,'Unknown sender',null,'unlabelled-screen');mode=priorMode;continue;}
   let mark=marker(line.raw,labels);
   if(mark&&contactLabel(mark.label)&&active&&!/^(?:Group Chat|Caller ID|Then|And|Source|OOC|SERVICE|ARRIVAL)$/i.test(mark.label)){
    if(mode==='group'&&owner&&group&&!group.members.some(n=>eqName(n,mark.label))&&['clock','named-heading','heading'].includes(mark.format)){mode='private';pair=[owner,mark.label];}
    if(mark.recipient){pair=[mark.label,mark.recipient];state.pair=pair;mode='private';}
    if(mode==='private'&&owner&&!mark.recipient){if(!pair||!pair.some(n=>eqName(n,mark.label))){pair=[owner,mark.label];state.pair=pair;} }
    let start,end,j=i+1;
    if(mark.body){start=line.start+line.raw.indexOf(mark.body);end=start+mark.body.length;}
    else {while(j<lines.length&&!clean(lines[j].raw))j++;if(j===lines.length||marker(lines[j].raw,labels)||narrative(clean(lines[j].raw))||cue(clean(lines[j].raw)))continue;start=lines[j].start;end=lines[j].end;j++;}
    while(j<lines.length){const next=clean(lines[j].raw);if(!next){j++;continue;}if(marker(lines[j].raw,labels)||cue(next)||narrative(next)||/\b(?:left (?:the conversation|the chat|the group chat)|added Dane|changed the group|hit send|sent before)\b/i.test(next))break;end=lines[j].end;j++;}
    const participants=mode==='group'?group?.members:pair;
    add(start,end,mark.label,participants,mark.format,{timestamp:mark.timestamp});i=Math.max(i,j-1);continue;
   }
   // Explicit unlabeled follow-up messages can inherit only an established private
   // sender. In a group the sender is withheld unless actually labeled.
   if(cue(s)&&active&&lastSender){let j=i+1;while(j<lines.length&&!clean(lines[j].raw))j++;if(j<lines.length&&!marker(lines[j].raw,labels)&&!narrative(clean(lines[j].raw))&&!cue(clean(lines[j].raw))){let end=lines[j].end,k=j+1;while(k<lines.length){const next=clean(lines[k].raw);if(!next){k++;continue;}if(marker(lines[k].raw,labels)||cue(next)||narrative(next))break;end=lines[k].end;k++;}add(lines[j].start,end,mode==='private'?lastSender:'Unknown sender',mode==='private'?pair:group?.members,'follow-up');i=k-1;}}
  }
 }
 return results;
}
export function extendedCandidateIndex(vault,storyId,options) {return new Map(parseExtendedHistory(vault,storyId,options).map(c=>[c.key,c]));}

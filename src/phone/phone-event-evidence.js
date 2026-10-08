// Approved event roots contain no dialogue or identities. A root is added only
// after the source ledger and its privacy audit have been independently checked.
export const APPROVED_PHONE_EVENT_ROOTS = Object.freeze([
  "9fd94090fbf7f247f9e24258d10f66b016a650a26e38929b9e29ca6b99b9a151" // Verified 1,462-event, eight-thread ledger.
]);
const HEX = /^[a-f0-9]{64}$/;
const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const rotate = (x,n)=>(x>>>n)|(x<<(32-n));
// Synchronous SHA-256 is required by existing synchronous backup validation.
// TextEncoder keeps browser and Node hashes identical, including emoji.
export function sha256(value) {
 const input=new TextEncoder().encode(value), bytes=new Uint8Array(Math.ceil((input.length+9)/64)*64);
 bytes.set(input);bytes[input.length]=128;
 const view=new DataView(bytes.buffer),bits=input.length*8;
 view.setUint32(bytes.length-8,Math.floor(bits/4294967296));view.setUint32(bytes.length-4,bits>>>0);
 const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64);
 for(let offset=0;offset<bytes.length;offset+=64){
  for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
  for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+w[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))>>>0;}
  let [a,b,c,d,e,f,g,j]=h;
  for(let i=0;i<64;i++){const t1=(j+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+w[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  [a,b,c,d,e,f,g,j].forEach((x,i)=>h[i]=(h[i]+x)>>>0);
 }
 return h.map(x=>x.toString(16).padStart(8,'0')).join('');
}
export function canonicalJSON(value) {
 if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export const eventLeaf = claim=>sha256('phone-event-leaf:'+canonicalJSON(claim));
export const eventParent = (left,right)=>sha256('phone-event-node:'+left+right);
export function verifyEventProof(recovery) {
 try{
  if(!recovery||!APPROVED_PHONE_EVENT_ROOTS.includes(recovery.root)||!Array.isArray(recovery.proof)||recovery.proof.length>32)return false;
  let digest=eventLeaf(recovery.claim);
  for(const step of recovery.proof){if(!step||!HEX.test(step.hash)||!['left','right'].includes(step.side))return false;digest=step.side==='left'?eventParent(step.hash,digest):eventParent(digest,step.hash);}
  return digest===recovery.root;
 }catch{return false;}
}
const excluded=s=>['forgotten','retired','deleted','excluded'].some(k=>s.status===k||s[k]||s[k+'At']);
const equal=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
export function eventSourceCurrent(message,vault,{includeExcluded=false}={}) {
 try{
  const r=message.recovery,c=r?.claim,e=c?.event;
  if(r?.version!==3||!verifyEventProof(r)||c.version!==1||!e||e.status!=='supported'||r.key!==e.id||r.sourceMessageId!==e.sourceMessageId||r.start!==e.start||r.end!==e.end||r.transcriptOrder!==e.sourceOrdinal||r.sourceOrdinal!==e.sourceOrdinal||r.timestampText!==(e.timestampText||null)||!Number.isFinite(Date.parse(r.importedAt)))return false;
  if(message.id!=='phone-event:'+e.id||message.storyId!==e.storyId||message.chatId!==e.chatId||message.senderId!==c.senderId||message.senderType!==c.senderType||message.text!==e.text||message.createdAt!==null||!equal(message.audienceIds,c.audienceIds)||!equal(message.sourceMessageIds,c.sourceChecks.map(s=>s.id)))return false;
  const story=vault.stories.find(s=>s.id===message.storyId);
  if(!story||story.personaId!==c.personaId||!vault.chats.some(s=>s.id===message.chatId&&s.storyId===story.id)||!c.audienceIds.includes(c.senderId)||!c.audienceIds.includes(c.personaId))return false;
  const known=new Set([story.personaId,story.primaryCharacterId,...story.characterIds||[],...(story.phone?.historicalContacts||[]).map(s=>s.id)]);
  if(c.audienceIds.some(id=>!known.has(id)))return false;
  const sources=new Map(vault.messages.map(s=>[s.id,s]));
  for(const check of c.sourceChecks){const source=sources.get(check.id);if(!source||source.storyId!==message.storyId||source.chatId!==message.chatId||typeof source.text!=='string'||sha256(source.text)!==check.sha256||(!includeExcluded&&excluded(source)))return false;}
  for(const span of e.representations){const source=sources.get(span.sourceMessageId);if(!source||source.text.slice(span.start,span.end)!==e.text||span.storyId!==message.storyId||span.chatId!==message.chatId||!equal(span.audienceIds,e.audienceIds)||span.senderId!==e.senderId||span.conversationId!==e.conversationId)return false;}
  const thread=story.phone?.threads.find(t=>t.messages?.some(m=>m.id===message.id));
  if(thread&&(thread.kind!==c.kind||!thread.historyConversationKeys?.includes(e.conversationId)||thread.kind==='private'&&!equal([...thread.participantIds].sort(),c.audienceIds.filter(id=>id!==c.personaId).sort())))return false;
  return true;
 }catch{return false;}
}

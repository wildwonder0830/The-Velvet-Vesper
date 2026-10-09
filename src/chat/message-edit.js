import { sha256 } from "../phone/phone-event-evidence.js";
// Corrections and their recovery history live on the existing message. Stale
// derived records are retained in storage and projected out only for the model.
const contextCollections = ['personas','characters','stories','loreEntries','memoryEntries','milestones','relationships','statEvents','sceneStates','knowledgeEntries'];
const referenceCollections = {
  sourceMessageId:'messages',sourceMessageIds:'messages',
  sourceMemoryId:'memoryEntries',sourceMemoryIds:'memoryEntries',
  sourceMilestoneId:'milestones',sourceMilestoneIds:'milestones',milestoneId:'milestones',
  relationshipId:'relationships',sourceRelationshipId:'relationships',sourceRelationshipIds:'relationships',
  sourceSceneId:'sceneStates',sourceSceneIds:'sceneStates',
  sourceKnowledgeId:'knowledgeEntries',sourceKnowledgeIds:'knowledgeEntries'
};
const list = value => Array.isArray(value) ? value : [];
const authority = message => message?.role === 'assistant' && message.editAuthority?.version === 1;
const contextKeys = message => list(message?.editAuthority?.withheldContextKeys).filter(key => typeof key === 'string');
const keyFor = path => JSON.stringify(path);
function itemPath(path, value, index) {
  // IDs survive reordering. Anonymous structured facts use their exact content,
  // so removing a sibling cannot suppress a different record at its old index.
  return [...path,value && typeof value === 'object' ? (typeof value.id === 'string' ? ['id',value.id] : ['value',sha256(JSON.stringify(value))]) : ['index',index]];
}
function walk(value, path, visit, collection) {
  if (Array.isArray(value)) { value.forEach((child,index) => walk(child,itemPath(path,child,index),visit,collection));return; }
  if (!value || typeof value !== 'object') return;
  visit(value,path,collection);
  for (const [key,child] of Object.entries(value)) walk(child,[...path,key],visit,collection);
}
function dependencies(record) {
  const refs = [];
  function read(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key,child] of Object.entries(value)) {
      if (referenceCollections[key]) for (const id of Array.isArray(child) ? child : [child]) {
        if (typeof id === 'string') refs.push([referenceCollections[key],id]);
      }
    }
  }
  read(record);
  // data is part of its enclosing fact, not independent evidence for its prose.
  if (record.data && typeof record.data === 'object') walk(record.data,[],read);
  return refs;
}
function stillSupported(record, vault, message, replacement, collection) {
  if (!['memoryEntries','milestones'].includes(collection)) return false;
  const prose=[record.text,record.evidence].filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim());
  if (!prose.length) return false;
  const data=record.data&&typeof record.data==='object'&&!Array.isArray(record.data)?Object.fromEntries(Object.entries(record.data).filter(([key])=>!referenceCollections[key]&&key!=='key')):record.data;
  const details=[record.value != null ? JSON.stringify(record.value) : null,data && Object.keys(data).length ? JSON.stringify(data) : null].filter(Boolean);
  const matches=text=>typeof text==='string'&&[...prose,...details].every(fragment=>text.includes(fragment));
  // Merely retaining an old quote in a correction is not proof it still holds:
  // explicit retractions/negations must withhold its source-linked canon. This
  // conservative check never changes stored status or establishes new canon.
  const retracts=/\b(?:not|never|false|untrue|incorrect|mistake|retract(?:ed|ion)?|dream(?:ed)?|hypothetical|instead|no longer|didn[’']?t|did not)\b/i.test(replacement);
  if(!retracts&&matches(replacement))return true;
  const sources=dependencies(record).filter(([collection])=>collection==='messages').map(([,id])=>id);
  return (vault.messages||[]).some(source=>source.id!==message.id&&sources.includes(source.id)&&source.role==='user'&&source.storyId===record.storyId&&(!record.chatId||source.chatId===record.chatId)&&!source.provisional&&source.status!=='draft'&&matches(source.text));
}
function directStaleContext(vault, message, replacement) {
  const keys = [];
  for (const collection of contextCollections) walk(vault[collection],[collection],(record,path) => {
    const refs = dependencies(record);
    const linked = refs.some(([type,id]) => type === 'messages' && id === message.id);
    const undatedSummary = record.kind === 'summary' && record.storyId === message.storyId && record.chatId === message.chatId && !refs.length &&
      !(Date.parse(record.updatedAt || record.createdAt) < Date.parse(message.createdAt));
    // A separately verified milestone whose entire quoted evidence survives the
    // correction retains its existing canon rules. Nothing is auto-verified.
    const survivingEvidence = stillSupported(record,vault,message,replacement,collection);
    if ((linked && !survivingEvidence) || undatedSummary) keys.push(keyFor(path));
  });
  return keys;
}

export function originalAssistantText(message) {
  return list(message?.editHistory).find(version => typeof version?.text === 'string')?.text ?? null;
}

// Archive versions are for recovery/evidence validation only, never retrieval.
export function assistantTextVersions(message) {
  return [message?.text,...(authority(message) ? list(message.editHistory).map(version=>version?.text) : [])].filter(text=>typeof text==='string');
}
export function historicalReplyVault(vault, asOf) {
  if (!(vault.messages||[]).some(authority) && !(vault.personas||[]).some(p=>p.versions?.length)) return vault;
  return {...vault,personas:(vault.personas||[]).map(p=>{const versions=[...(p.versions||[]),{name:p.name,profile:p.profile,at:p.updatedAt||p.createdAt}].filter(v=>Number.isFinite(Date.parse(v.at))&&Date.parse(v.at)<=Date.parse(asOf)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));const version=versions.at(-1)||p.versions?.[0];return version?{...p,name:version.name,profile:version.profile}:p;}),messages:vault.messages.map(message=>{
    const {editHistory,editAuthority,...source}=message;
    let text=message.text;
    if(authority(message)){
      text=originalAssistantText(message) ?? message.text;
      const instant=Date.parse(asOf);
      if(Number.isFinite(instant))for(const version of [...list(editHistory),{text:message.text,editedAt:message.editedAt}]){
        const effective=Date.parse(version?.editedAt || message.createdAt);
        if(typeof version?.text==='string'&&Number.isFinite(effective)&&effective<=instant)text=version.text;
      }
    }
    return {...source,text};
  })};
}

export function prepareAssistantEdit(vault,{messageId,storyId,chatId,text,now=new Date().toISOString()}) {
  const original=vault.messages.find(m=>m.id===messageId&&m.storyId===storyId&&m.chatId===chatId&&m.role==='assistant');
  if(!original)throw new Error('That reply is no longer available in this conversation.');
  if(typeof text!=='string'||!text.trim())throw new Error('The reply cannot be empty.');
  const replacement=text.trim();
  if(replacement===String(original.text||'').trim())return null;
  const next=structuredClone(vault),message=next.messages.find(m=>m.id===messageId);
  message.editHistory=[...list(original.editHistory),{text:original.text,editedAt:original.editedAt || null}];
  message.editAuthority={version:1,withheldContextKeys:[...new Set([...contextKeys(original),...directStaleContext(vault,original,replacement)])]};
  message.text=replacement;message.editedAt=now;next.updatedAt=now;
  return next;
}

export function authoritativeReplyContext(vault, storyId, chatId) {
  const messages = (vault.messages || []).filter(m => authority(m) && m.storyId === storyId && m.chatId === chatId && !m.provisional && m.status !== 'draft' &&
      !['forgotten','retired','deleted','excluded'].some(status=>m.status===status||m[status]||m[status+'At']))
    .sort((a,b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
    .map(m => ({id:m.id,storyId:m.storyId,chatId:m.chatId,ordinal:m.ordinal,text:m.text,editedAt:m.editedAt,sourceMessageIds:[m.id]}));
  return messages.length ? {
    rule:'These are user-authored corrections to saved replies in this conversation. Their current text is authoritative over conflicting earlier narration, summaries, memories, scene details or opening setup. Use the corrected facts even outside recent history. Never restore a superseded version or invent new events from an edit. Preserve chronology, unrelated canon, character identity, knowledge boundaries, hard limits, adult requirements and permissions.',
    messages
  } : null;
}

export function projectEditedContext(vault) {
  const corrected = (vault.messages || []).filter(authority);
  if (!corrected.length) return vault;
  const withheld = new Set(corrected.flatMap(contextKeys));
  const unavailable = new Map(contextCollections.map(collection => [collection,new Set()]));
  function blocked(record,path) {
    return withheld.has(keyFor(path)) || dependencies(record).some(([collection,id]) => unavailable.get(collection)?.has(id));
  }
  // Derived records can cross collections and stories. Close provenance to a
  // fixed point; retrieval's existing ownership rules still scope the result.
  let changed;
  do {
    changed=false;
    function visit(value,path,collection,parentBlocked=false) {
      if (Array.isArray(value)) { value.forEach((child,index)=>visit(child,itemPath(path,child,index),collection,parentBlocked));return; }
      if (!value || typeof value !== 'object') return;
      const excluded=parentBlocked || blocked(value,path);
      if (excluded) {
        const key=keyFor(path);if(!withheld.has(key)){withheld.add(key);changed=true;}
        if (typeof value.id === 'string' && !unavailable.get(collection).has(value.id)) { unavailable.get(collection).add(value.id);changed=true; }
      }
      for(const [key,child] of Object.entries(value)) visit(child,[...path,key],collection,excluded);
    }
    for(const collection of contextCollections) visit(vault[collection],[collection],collection);
  } while(changed);
  function project(value,path) {
    if(Array.isArray(value))return value.map((child,index)=>project(child,itemPath(path,child,index))).filter(child=>child!==undefined);
    if(!value||typeof value!=='object')return value;
    if(withheld.has(keyFor(path)))return undefined;
    return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,project(child,[...path,key])]).filter(([,child])=>child!==undefined));
  }
  const next={...vault};
  for(const collection of contextCollections)next[collection]=project(vault[collection],[collection]);
  // Original prose is recovery-only. It must never be serialized in any model
  // context, including callers inspecting the assembled recent-message records.
  next.messages=(vault.messages || []).map(({editHistory,editAuthority,...message})=>message);
  return next;
}

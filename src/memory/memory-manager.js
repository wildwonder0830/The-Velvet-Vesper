import { makeId } from "../schema.js";

export const MEMORY_KINDS = Object.freeze(["canon","relationship","summary","scene","character","user-directive"]);

export function createMemory({ storyId, chatId = null, scope = "story", kind, text = "", data = null, sourceMessageIds = [], pinned = false }, now = new Date().toISOString()) {
  if (!storyId || !MEMORY_KINDS.includes(kind)) throw new Error("Invalid memory.");
  return {
    id: makeId("memory"), storyId, chatId, scope, kind, text, data,
    sourceMessageIds: [...new Set(sourceMessageIds)], pinned: Boolean(pinned),
    status: "active", createdAt: now, updatedAt: now
  };
}

export function activeMemory(entries, storyId) {
  const policy=memoryVisibilityPolicy(entries,storyId);
  return (entries || []).filter(m => m.storyId === storyId && isMemoryVisible(m) && !policy.excludedIds.has(m.id));
}

export function isMemoryVisible(entry) {
  return Boolean(entry && (entry.status == null || ["active","confirmed"].includes(entry.status)) &&
    !entry.forgotten && !entry.deleted && !entry.excluded && !entry.forgottenAt && !entry.deletedAt && !entry.excludedAt);
}

const forgottenStatuses=new Set(["forgotten","deleted","excluded"]);
const list=value=>Array.isArray(value)?value:[];
function isForgotten(entry) {
  return Boolean(entry && (forgottenStatuses.has(entry.status) || entry.forgotten || entry.deleted || entry.excluded || entry.forgottenAt || entry.deletedAt || entry.excludedAt));
}

function memoryVisibilityPolicy(entries,storyId) {
  const rows=(entries||[]).filter(m=>m.storyId===storyId);
  // Imported characters may be shared by multiple stories. Their retained
  // copies must not reveal a forgotten fact when the user switches stories.
  const roots=(entries||[]).filter(m=>isForgotten(m)&&!m.invalidatedByMemoryId);
  const sourceIds=new Set(roots.flatMap(m=>list(m.sourceMessageIds)));
  function strings(value){
    if(typeof value==="string")return value.trim()?[value,...value.split(/\r?\n+/).filter(line=>line.trim())]:[];
    if(!value||typeof value!=="object")return [];
    return Object.values(value).flatMap(strings);
  }
  const invalidated=(entries||[]).filter(m=>roots.some(root=>root.id===m.invalidatedByMemoryId));
  const texts=[...new Set([...roots,...invalidated].flatMap(m=>[...strings(m.text),...strings(m.data)]).flatMap(text=>[text,JSON.stringify(text).slice(1,-1)]))].sort((a,b)=>b.length-a.length);
  const excludedIds=new Set(rows.filter(m=>!isMemoryVisible(m)).map(m=>m.id));
  let changed=true;
  while(changed){
    changed=false;
    for(const row of rows){
      const dependent=list(row.sourceMemoryIds).some(id=>excludedIds.has(id)) ||
        list(row.sourceMessageIds).some(id=>sourceIds.has(id)) ||
        texts.some(text=>JSON.stringify({text:row.text,data:row.data}).includes(text)) ||
        (roots.some(m=>m.storyId===storyId)&&row.kind==="summary"&&!list(row.sourceMessageIds).length);
      if(dependent&&!excludedIds.has(row.id)){excludedIds.add(row.id);changed=true;}
    }
  }
  return {roots,sourceIds,excludedIds,texts};
}

// Build a model-only copy; retained historical records are never modified.
// There is no prompt cache/index: recompute policy at each model boundary.
export function filterMemoryForModel(value,entries,storyId) {
  const policy=memoryVisibilityPolicy(entries,storyId);
  function project(item,preserveRecords=false) {
    if(typeof item==="string"){
      let text=item;
      for(const forgotten of policy.texts)text=text.split(forgotten).join("[forgotten memory omitted]");
      return text;
    }
    if(Array.isArray(item))return item.map(child=>project(child,preserveRecords)).filter(child=>child!==undefined);
    if(!item||typeof item!=="object")return item;
    if(!preserveRecords&&(policy.excludedIds.has(item.id)||policy.sourceIds.has(item.id)||isForgotten(item)||
      list(item.sourceMemoryIds).some(id=>policy.excludedIds.has(id))||
      list(item.sourceMessageIds).some(id=>policy.sourceIds.has(id))||policy.sourceIds.has(item.sourceMessageId)))return undefined;
    return Object.fromEntries(Object.entries(item).map(([key,child])=>[key,project(child,preserveRecords||["milestones","confirmedMilestones","sceneState"].includes(key))]).filter(([,child])=>child!==undefined));
  }
  return project(value);
}

export function forgetMemory(entries, memoryId, reason = "", now = new Date().toISOString()) {
  const target=(entries||[]).find(m=>m.id===memoryId);
  if(!target)return entries||[];
  const forgotten=(entries || []).map(m => m.id === memoryId
    ? { ...m, status: "forgotten", forgottenAt: now, forgetReason: reason, updatedAt: now }
    : m);
  const policy=memoryVisibilityPolicy(forgotten,target.storyId);
  return forgotten.map(m=>m.id!==memoryId&&m.storyId===target.storyId&&isMemoryVisible(m)&&
    (policy.excludedIds.has(m.id)||m.kind==="summary")
    ? {...m,status:"excluded",invalidatedByMemoryId:memoryId,updatedAt:now}:m);
}

export function replaceSummary(entries, storyId, chatId, summary, sourceMessageIds = [], now = new Date().toISOString()) {
  const retired = (entries || []).map(m =>
    m.storyId === storyId && m.chatId === chatId && m.kind === "summary" && isMemoryVisible(m)
      ? { ...m, status: "superseded", supersededAt: now, updatedAt: now }
      : m
  );
  return [...retired, createMemory({ storyId, chatId, kind: "summary", text: summary, sourceMessageIds }, now)];
}

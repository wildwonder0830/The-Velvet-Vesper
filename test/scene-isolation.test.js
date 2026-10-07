import test from "node:test";
import assert from "node:assert/strict";
import { emptyVault } from "../src/schema.js";
import { createSceneState, updateScene, timeskipScene } from "../src/scene/scene-state.js";
import { createMemory } from "../src/memory/memory-manager.js";
import { buildStoryContext } from "../src/prompt/context-builder.js";
import { assemblePrompt } from "../src/prompt/prompt-assembler.js";
import { serializePortableBackup, parseVesperBackup } from "../src/backup/vesper-backup.js";
import { prepareImport } from "../src/migration/import-service.js";
import { runTurn } from "../src/chat/turn-engine.js";

function fixture() {
  const v=emptyVault();
  v.personas=[{id:"p",name:"Persona"}];v.characters=[{id:"x",name:"Character"}];
  v.stories=[{id:"s",title:"Story",personaId:"p",characterIds:["x"]},{id:"other",title:"Other",personaId:"p",characterIds:["x"]}];
  v.chats=[{id:"a",storyId:"s"},{id:"b",storyId:"s"},{id:"new",storyId:"s"},{id:"other-chat",storyId:"other"}];
  for(const [chatId,storyId,year] of [["a","s",2024],["b","s",2025],["other-chat","other",2026]]) {
    const marker=`PRIVATE-SCENE-${chatId}`;
    v.sceneStates.push({...createSceneState({storyId,chatId,location:marker,participantIds:[marker],tags:[marker]},`${year}-01-01T00:00:00Z`),temporaryNote:marker,currentTurnContext:{note:marker}});
    v.messages.push({id:`message-${chatId}`,storyId,chatId,role:"user",text:marker,ordinal:0});
    for(const kind of ["scene","summary"])v.memoryEntries.push(createMemory({storyId,chatId,kind,text:marker}));
    v.memoryEntries.push({id:`stats-${chatId}`,storyId,chatId,kind:"legacy-story-stats",status:"active",data:{currentLocation:marker}});
    v.knowledgeEntries.push({id:`knowledge-${chatId}`,storyId,chatId,kind:"legacy-ledger",ledger:{currentScene:marker}});
  }
  v.memoryEntries.push({...createMemory({storyId:"s",chatId:"a",kind:"canon",text:"Shared canon remains."}),id:"canon"});
  v.memoryEntries.push({...createMemory({storyId:"s",chatId:"a",kind:"relationship",text:"Shared relationship remains."}),id:"relationship-memory"});
  v.memoryEntries.push({...createMemory({storyId:"s",kind:"character",text:"Shared character memory remains."}),id:"character-memory"});
  v.relationships=[{id:"relationship",storyId:"s",chatId:"a",stage:"friends"}];
  v.milestones=[{id:"milestone",storyId:"s",chatId:"a",type:"first_kiss",status:"confirmed",participants:["p","x"],evidence:"The first kiss happened.",verification:{verified:true,completed:true,verifiedBy:"user"}}];
  v.knowledgeEntries.push({id:"shared-knowledge",storyId:"s",factKey:"birthplace",value:"Shared knowledge remains."});
  return v;
}
function prompt(v,chatId){return assemblePrompt({vault:v,storyId:chatId==="other-chat"?"other":"s",chatId});}
function assertIsolated(v,chatId) {
  const assembled=prompt(v,chatId);const text=JSON.stringify(assembled);
  for(const other of ["a","b","other-chat"].filter(id=>id!==chatId))assert.ok(!text.includes(`PRIVATE-SCENE-${other}`),`${chatId} leaked ${other}`);
  if(chatId==="new")assert.equal(assembled.sceneState,null);
  else assert.equal(assembled.sceneState.location,`PRIVATE-SCENE-${chatId}`);
  return assembled;
}

test("each chat selects its own scene, cast, temporary notes and context",()=>{
  const v=fixture();for(const chatId of ["a","b","a","other-chat","b"])assertIsolated(v,chatId);
});
test("direct context selection requires both a story and its owning chat",()=>{
  const v=fixture();assert.equal(buildStoryContext(v,"s","a").sceneState.location,"PRIVATE-SCENE-a");
  assert.equal(buildStoryContext(v,"s").sceneState,null);
  assert.throws(()=>buildStoryContext(v,"s","other-chat"),/Chat not found in active story/);
  assert.throws(()=>prompt(v,"missing"),/Chat not found in active story/);
});
test("a new chat cannot inherit another chat's scene or transient derived context",()=>assertIsolated(fixture(),"new"));
test("newest unsuperseded scene is selected only within the requested chat",()=>{
  const v=fixture();const own=v.sceneStates.find(s=>s.chatId==="a");
  const updated={...updateScene(own,{location:"A's new room"},"2027-01-01T00:00:00Z"),id:"new-scene"};
  v.sceneStates.push(updated,{...updated,id:"retired-scene",location:"Superseded room",status:"superseded",updatedAt:"2028-01-01T00:00:00Z"});
  assert.equal(prompt(v,"a").sceneState.location,"A's new room");assertIsolated(v,"b");
});
test("mismatched and unowned scene records never provide fallback context",()=>{
  const v=fixture();v.sceneStates.push({id:"unowned",storyId:"s",location:"UNOWNED",updatedAt:"2099"},{id:"mismatch",storyId:"other",chatId:"a",location:"MISMATCH",updatedAt:"2099"});
  assert.equal(prompt(v,"a").sceneState.location,"PRIVATE-SCENE-a");assert.equal(prompt(v,"new").sceneState,null);
});
test("isolation survives reload and portable backup restore without rewriting records",()=>{
  const v=fixture();const original=structuredClone(v);
  const restored=prepareImport(parseVesperBackup(serializePortableBackup(v))).vault;
  for(const chatId of ["a","b","new","other-chat","a"])assertIsolated(JSON.parse(JSON.stringify(restored)),chatId);
  assert.deepEqual(v,original);assert.deepEqual(restored.sceneStates,original.sceneStates);assert.deepEqual(restored.memoryEntries,original.memoryEntries);
});
test("shared canon, relationship memories, milestones and durable knowledge stay unchanged",()=>{
  const v=fixture();const before=structuredClone(v);
  for(const chatId of ["a","b","new"]) {
    const a=assertIsolated(v,chatId);
    for(const id of ["canon","relationship-memory","character-memory"])assert.ok(a.memory.some(m=>m.id===id));
    assert.deepEqual(a.milestones,v.milestones);assert.deepEqual(a.relationship,v.relationships[0]);
    assert.ok(a.canonAndContinuity.knowledge.some(k=>k.id==="shared-knowledge"));
  }
  assert.deepEqual(v,before);
});
test("scene notes without chat ownership are withheld, not assigned to the current chat",()=>{
  const v=fixture();v.memoryEntries.push(createMemory({storyId:"s",kind:"scene",text:"UNOWNED-SCENE-NOTE"}));
  for(const chatId of ["a","b","new"])assert.ok(!JSON.stringify(prompt(v,chatId)).includes("UNOWNED-SCENE-NOTE"));
});
test("unowned imported scene-derived ledgers never become shared knowledge",()=>{
  const v=fixture();v.knowledgeEntries.push({id:"unowned-ledger",storyId:"s",kind:"legacy-ledger",ledger:{currentScene:"UNOWNED-LEDGER-SCENE"}});
  for(const chatId of ["a","b","new"])assert.ok(!JSON.stringify(prompt(v,chatId)).includes("UNOWNED-LEDGER-SCENE"));
});
test("explicit chat-scoped temporary notes cannot bypass scene isolation",()=>{
  const v=fixture();v.memoryEntries.push(createMemory({storyId:"s",chatId:"a",scope:"chat",kind:"user-directive",text:"ONLY-A-TEMPORARY-NOTE"}));
  assert.ok(JSON.stringify(prompt(v,"a")).includes("ONLY-A-TEMPORARY-NOTE"));assert.ok(!JSON.stringify(prompt(v,"b")).includes("ONLY-A-TEMPORARY-NOTE"));
});
test("scene updates cannot move ownership or change another chat's scene",()=>{
  const v=fixture();const a=v.sceneStates[0],b=structuredClone(v.sceneStates[1]);
  const changed=timeskipScene(updateScene(a,{storyId:"other",chatId:"b",location:"Own room"}),{time:"Morning",note:"Only A"});
  assert.equal(changed.storyId,"s");assert.equal(changed.chatId,"a");assert.deepEqual(v.sceneStates[1],b);
});
test("a user-assigned scene copy belongs only to its explicitly chosen chat",()=>{
  const v=fixture();const source=v.sceneStates[0];v.sceneStates.push({...structuredClone(source),id:"explicit-transfer",chatId:"new"});
  assert.equal(prompt(v,"new").sceneState.chatId,"new");assert.equal(prompt(v,"new").sceneState.location,source.location);
  assert.equal(prompt(v,"b").sceneState.chatId,"b");
});
test("provider requests and repair requests never use another chat's scene context",async()=>{
  const v=fixture(),bodies=[];const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>"synthetic-key"};globalThis.fetch=async(_url,options)=>{
    bodies.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:bodies.length===1?"Mandy.":"The candle flickered."}}]})};
  };
  try {await runTurn({vault:v,storyId:"s",chatId:"a",model:"synthetic-model"});assert.equal(bodies.length,2);
    for(const body of bodies){const text=JSON.stringify(body);assert.ok(text.includes("PRIVATE-SCENE-a"));assert.ok(!text.includes("PRIVATE-SCENE-b"));assert.ok(!text.includes("PRIVATE-SCENE-other-chat"));}
  }finally{globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}
});
test("current-turn instructions do not persist into another chat's provider request",async()=>{
  const v=fixture(),bodies=[];const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>"synthetic-key"};globalThis.fetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:"The candle flickered."}}]})};};
  try {
    await runTurn({vault:v,storyId:"s",chatId:"a",model:"synthetic-model",oocInstruction:"ONLY-A-CURRENT-TURN"});
    await runTurn({vault:v,storyId:"s",chatId:"b",model:"synthetic-model"});
    assert.ok(JSON.stringify(bodies[0]).includes("ONLY-A-CURRENT-TURN"));assert.ok(!JSON.stringify(bodies[1]).includes("ONLY-A-CURRENT-TURN"));
    assert.ok(!JSON.stringify(bodies[1]).includes("PRIVATE-SCENE-a"));
  }finally{globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}
});

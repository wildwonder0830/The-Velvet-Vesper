import test from "node:test";
import assert from "node:assert/strict";
import { emptyVault } from "../src/schema.js";
import { createMemory, activeMemory, forgetMemory, replaceSummary } from "../src/memory/memory-manager.js";
import { buildStoryContext } from "../src/prompt/context-builder.js";
import { assemblePrompt } from "../src/prompt/prompt-assembler.js";
import { continuityPrompt } from "../src/continuity/guards.js";
import { activeFacts } from "../src/continuity/ledger.js";
import { serializePortableBackup, parseVesperBackup } from "../src/backup/vesper-backup.js";
import { prepareImport } from "../src/migration/import-service.js";
import { runTurn } from "../src/chat/turn-engine.js";

const SECRET = "The hidden observatory code is SILVER-947.";
function fixture() {
  const vault=emptyVault();
  vault.personas=[{id:"p",name:"Amanda"}];
  vault.characters=[{id:"x",name:"Character"}];
  vault.stories=[{id:"s",title:"Story",personaId:"p",characterIds:["x"]},{id:"other",title:"Other"}];
  vault.chats=[{id:"c",storyId:"s"},{id:"other-chat",storyId:"other"}];
  vault.messages=[{id:"source",storyId:"s",chatId:"c",role:"user",text:SECRET,ordinal:0}];
  vault.memoryEntries=[{...createMemory({storyId:"s",kind:"canon",text:SECRET,sourceMessageIds:["source"]}),id:"secret"}, {...createMemory({storyId:"s",kind:"canon",text:"The weather is clear."}),id:"safe"}];
  return vault;
}
function assertNoLeak(vault) {
  const context=buildStoryContext(vault,"s");
  const prompt=assemblePrompt({vault,storyId:"s",chatId:"c"});
  assert.ok(!JSON.stringify(context).includes(SECRET));
  assert.ok(!JSON.stringify(prompt).includes(SECRET));
  assert.ok(prompt.memory.some(m=>m.id==="safe"));
  assert.ok(!activeMemory(vault.memoryEntries,"s").some(m=>m.id==="secret"));
}

for(const status of ["forgotten","deleted","excluded","superseded"]) {
  test(`${status} memories never enter story context or canon`,()=>{
    const vault=fixture();vault.messages=[];vault.memoryEntries[0].sourceMessageIds=[];vault.memoryEntries[0].status=status;
    assertNoLeak(vault);
  });
}
for(const kind of ["canon","character","relationship","summary","scene","user-directive"]) {
  test(`forgetting ${kind} memory excludes its content and source messages`,()=>{
    const vault=fixture();vault.memoryEntries[0].kind=kind;
    vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");
    assertNoLeak(vault);
    assert.equal(vault.memoryEntries.find(m=>m.id==="secret").text,SECRET);
  });
}
test("deleted/excluded flags override active status",()=>{
  for(const flag of ["deleted","excluded","forgotten"]) {
    const vault=fixture();vault.messages=[];vault.memoryEntries[0][flag]=true;
    assertNoLeak(vault);
  }
});
test("legacy imported memories without status remain visible until forgotten",()=>{
  const vault=fixture();delete vault.memoryEntries[0].status;
  assert.ok(activeMemory(vault.memoryEntries,"s").some(m=>m.id==="secret"));
  vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");assertNoLeak(vault);
});
test("forget invalidates existing summaries and linked derived memories",()=>{
  const vault=fixture();
  vault.memoryEntries.push(createMemory({storyId:"s",kind:"summary",text:"A sensitive code was established."}));
  vault.memoryEntries.push({...createMemory({storyId:"s",kind:"relationship",text:"He remembers the private code."}),sourceMemoryIds:["secret"]});
  vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");
  assertNoLeak(vault);
  assert.deepEqual(activeMemory(vault.memoryEntries,"s").map(m=>m.id),["safe"]);
});
test("retained copies in imported premise/profile and nested continuity are not model-visible",()=>{
  const vault=fixture();vault.stories[0].premise=SECRET;vault.characters[0].profile={permanentMemory:SECRET};
  vault.relationships=[{id:"r",storyId:"s",stage:"friends",establishedFacts:[{id:"f",text:SECRET,status:"forgotten"}]}];
  vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");assertNoLeak(vault);
  assert.equal(vault.stories[0].premise,SECRET);
  const continuity=continuityPrompt({facts:[{status:"active",text:SECRET,excluded:true}]});
  assert.deepEqual(continuity.confirmedFacts,[]);
});
test("forgetting survives reload, story switching, backup/restore and unrelated updates",()=>{
  const vault=fixture();vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");
  const restored=prepareImport(parseVesperBackup(serializePortableBackup(vault))).vault;
  assemblePrompt({vault:restored,storyId:"other",chatId:"other-chat"});
  assertNoLeak(restored);
  restored.memoryEntries.push(createMemory({storyId:"s",kind:"character",text:"A new harmless fact."}));
  restored.memoryEntries=replaceSummary(restored.memoryEntries,"s","c",SECRET,["source"]);
  assertNoLeak(JSON.parse(JSON.stringify(restored)));
});
test("a summary with no provenance is withheld while forgotten facts exist",()=>{
  const vault=fixture();vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");
  vault.memoryEntries=replaceSummary(vault.memoryEntries,"s","c","The code is remembered in paraphrased form.");
  assert.ok(!assemblePrompt({vault,storyId:"s",chatId:"c"}).memory.some(m=>m.kind==="summary"));
});
test("superseded summary does not suppress its replacement's valid facts",()=>{
  const vault=fixture();vault.memoryEntries=replaceSummary(vault.memoryEntries,"s","c","A valid summary.");
  vault.memoryEntries=replaceSummary(vault.memoryEntries,"s","c","A valid summary. More context.");
  const summaries=assemblePrompt({vault,storyId:"s",chatId:"c"}).memory.filter(m=>m.kind==="summary");
  assert.equal(summaries.length,1);assert.equal(summaries[0].text,"A valid summary. More context.");
});
test("provider repair requests cannot reuse context forgotten during a turn",async()=>{
  const vault=fixture();const bodies=[];const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>"test-key"};
  globalThis.fetch=async(_url,options)=>{
    bodies.push(JSON.parse(options.body));
    if(bodies.length===1){vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");return {ok:true,json:async()=>({choices:[{message:{content:`Mandy. ${SECRET}`}}]})};}
    return {ok:true,json:async()=>({choices:[{message:{content:"The candle flickered."}}]})};
  };
  try {
    await runTurn({vault,storyId:"s",chatId:"c",model:"test-model"});
    assert.equal(bodies.length,2);
    assert.ok(!JSON.stringify(bodies[1]).includes("SILVER-947"));
  } finally {globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}
});

test("retrieval excludes unlinked duplicate memories and data-only retained copies",()=>{
  const vault=fixture();vault.memoryEntries.push(createMemory({storyId:"s",kind:"character",text:SECRET}));
  vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");
  assert.ok(!JSON.stringify(activeMemory(vault.memoryEntries,"s")).includes(SECRET));
  vault.memoryEntries.push({...createMemory({storyId:"s",kind:"canon",data:{secret:SECRET}}),id:"data-secret",status:"forgotten"});
  vault.stories[0].premise=SECRET;
  assertNoLeak(vault);
});
test("forgetting does not change milestone membership or scene selection",()=>{
  const vault=fixture();vault.milestones=[{id:"ms",storyId:"s",chatId:"c",type:"first_kiss",status:"confirmed",participants:["p","x"],evidence:"The first kiss happened.",verification:{verified:true,completed:true,verifiedBy:"user"},sourceMessageId:"source"}];
  vault.sceneStates=[{id:"sc",storyId:"s",chatId:"c",location:"Hall",sourceMessageId:"source"}];
  vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");
  const prompt=assemblePrompt({vault,storyId:"s",chatId:"c"});
  assert.deepEqual(prompt.milestones,vault.milestones);
  assert.deepEqual(prompt.sceneState,vault.sceneStates[0]);
});
test("safe source-backed summary remains usable after forgetting",()=>{
  const vault=fixture();vault.messages.push({id:"safe-source",storyId:"s",chatId:"c",role:"user",text:"The weather is clear.",ordinal:1});
  vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");
  vault.memoryEntries=replaceSummary(vault.memoryEntries,"s","c","The weather is clear.",["safe-source"]);
  const prompt=assemblePrompt({vault,storyId:"s",chatId:"c"});
  assert.equal(prompt.memory.filter(m=>m.kind==="summary").length,1);
  assertNoLeak(vault);
});
test("content becomes visible only after explicit restoration clears forgetting markers",()=>{
  const vault=fixture();vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");assertNoLeak(vault);
  const restored=vault.memoryEntries.find(m=>m.id==="secret");
  restored.status="active";delete restored.forgottenAt;delete restored.forgetReason;
  assert.ok(JSON.stringify(assemblePrompt({vault,storyId:"s",chatId:"c"})).includes(SECRET));
});

test("continuity retrieval never returns excluded confirmed records",()=>{
  assert.deepEqual(activeFacts([{id:"f",storyId:"s",status:"confirmed",text:SECRET,deleted:true}],"s"),[]);
});
test("escaped multiline copies are removed from a reused provider prompt",async()=>{
  const vault=fixture();const content='Private code "SILVER-947".\nKeep it hidden.';vault.memoryEntries[0].text=content;
  vault.messages[0].text=content;const bodies=[];const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>"test-key"};
  globalThis.fetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));
    if(bodies.length===1){vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");return {ok:true,json:async()=>({choices:[{message:{content:'Mandy. '+content}}]})};}
    return {ok:true,json:async()=>({choices:[{message:{content:"The candle flickered."}}]})};};
  try {await runTurn({vault,storyId:"s",chatId:"c",model:"test-model"});assert.ok(!JSON.stringify(bodies[1]).includes("SILVER-947"));}
  finally {globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}
});
test("transitive memory dependencies stay excluded after reload",()=>{
  const vault=fixture();vault.memoryEntries.push({...createMemory({storyId:"s",kind:"relationship",text:"Derived private fact."}),id:"derived",sourceMemoryIds:["secret"]});
  vault.memoryEntries.push({...createMemory({storyId:"s",kind:"character",text:"Another derived private fact."}),id:"second-derived",sourceMemoryIds:["derived"]});
  vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");
  assert.deepEqual(activeMemory(JSON.parse(JSON.stringify(vault.memoryEntries)),"s").map(m=>m.id),["safe"]);
});

test("switching stories cannot expose a forgotten copy in a shared character profile",()=>{
  const vault=fixture();vault.characters[0].profile={permanentMemory:SECRET};vault.stories[1].characterIds=["x"];
  vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");
  const prompt=assemblePrompt({vault,storyId:"other",chatId:"other-chat"});
  assert.ok(!JSON.stringify(prompt).includes(SECRET));
});

test("repair requests discard invalidated summary snapshots and paraphrased copies",async()=>{
  const vault=fixture();const summary="He remembers a sensitive private access code.";
  vault.memoryEntries.push(createMemory({storyId:"s",kind:"summary",text:summary}));
  const bodies=[];const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>"test-key"};
  globalThis.fetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));
    if(bodies.length===1){vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");return {ok:true,json:async()=>({choices:[{message:{content:"Mandy. "+summary}}]})};}
    return {ok:true,json:async()=>({choices:[{message:{content:"The candle flickered."}}]})};};
  try {await runTurn({vault,storyId:"s",chatId:"c",model:"test-model"});assert.ok(!JSON.stringify(bodies[1]).includes(summary));}
  finally {globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}
});

test("forgotten imported directives cannot leak through retained profile arrays",()=>{
  const vault=fixture();const directives=["Remember the private observatory access code.","Keep the hidden map in the west tower."];
  vault.memoryEntries[0].text=directives.join("\n");vault.characters[0].profile={directives};
  vault.memoryEntries=forgetMemory(vault.memoryEntries,"secret");
  const text=JSON.stringify(assemblePrompt({vault,storyId:"s",chatId:"c"}));
  for(const directive of directives)assert.ok(!text.includes(directive));
});

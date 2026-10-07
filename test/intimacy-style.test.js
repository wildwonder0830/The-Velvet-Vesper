import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyVault } from '../src/schema.js';
import { assemblePrompt } from '../src/prompt/prompt-assembler.js';
import { runTurn } from '../src/chat/turn-engine.js';
import { seedDefaultGreenLines } from '../src/rules/preference-lines.js';
import { serializePortableBackup, parseVesperBackup } from '../src/backup/vesper-backup.js';
import { prepareImport, commitPreparedImport } from '../src/migration/import-service.js';
import { loadVault, saveVaultAtomic } from '../src/storage/vault-store.js';
import { vaultDb } from '../test-support/vault-db.js';

function fixture() {
  const v=emptyVault('2026-01-01T00:00:00Z');
  v.personas=[{id:'p',name:'Amanda',profile:{age:30,voice:'Dry humor.'}}];
  v.characters=[{id:'x',name:'Character',profile:{age:35,voice:'Reserved.',limits:['Established boundary.']}}];
  v.stories=['a','b'].map(id=>({id,title:'Synthetic '+id,personaId:'p',characterIds:['x'],settings:{model:'synthetic',temperature:0,maxTokens:512,intimacyPacing:'slow',enabledPreferenceLineIds:[],custom:'preserve'}}));
  v.chats=['a','b'].map(id=>({id:'chat-'+id,storyId:id}));
  v.preferenceLines=seedDefaultGreenLines();
  v.memoryEntries=[{id:'safe',storyId:'a',kind:'canon',status:'active',text:'An established historical fact.'}];
  v.sceneStates=[{id:'scene',storyId:'a',chatId:'chat-a',location:'Garden'}];
  return v;
}
const prompt=(v,id='a',extra={})=>assemblePrompt({vault:v,storyId:id,chatId:'chat-'+id,preferenceLines:v.preferenceLines,...extra});

test('legacy story defaults to balanced without mutating storage or adding a directive',()=>{
  const v=fixture(),before=structuredClone(v),p=prompt(v);
  assert.equal(p.intimacyStyle,'balanced');assert.equal(p.intimacyStyleDirective,'');assert.deepEqual(v,before);
});
for(const value of [undefined,null,'unknown',{},'DIRECT'])test(`unsupported style ${JSON.stringify(value)} falls back safely`,()=>{
  const v=fixture();v.stories[0].settings.intimacyStyle=value;assert.equal(prompt(v).intimacyStyle,'balanced');assert.equal(prompt(v).intimacyStyleDirective,'');
});
for(const style of ['romantic','balanced','direct','unfiltered'])test(`${style} changes only the style projection and never CNC eligibility`,()=>{
  const v=fixture(),baseline=prompt(v);v.stories[0].settings.intimacyStyle=style;const before=structuredClone(v),p=prompt(v);
  assert.equal(p.intimacyStyle,style);assert.deepEqual(p.greenLines,baseline.greenLines);
  for(const key of ['persona','characters','relationship','milestones','memory','sceneState','canonAndContinuity','hardRules','sexualRedLines'])assert.deepEqual(p[key],baseline[key]);
  assert.deepEqual(v,before);
  if(style!=='balanced'){assert.ok(p.intimacyStyleDirective.includes(style));for(const word of ['identity','voice','canon','limits','continuity','adult','CNC'])assert.ok(p.intimacyStyleDirective.includes(word));assert.ok(p.intimacyStyleDirective.length<650);}
});
test('story switching selects independently stored styles',()=>{const v=fixture();v.stories[0].settings.intimacyStyle='romantic';v.stories[1].settings.intimacyStyle='direct';for(const id of ['a','b','a','b'])assert.equal(prompt(v,id).intimacyStyle,id==='a'?'romantic':'direct');});
test('CNC opt-in changes neither selected style nor its directive',()=>{const v=fixture();v.stories[0].settings.intimacyStyle='unfiltered';const before=prompt(v),line=v.preferenceLines.find(l=>l.tags.includes('cnc'));v.stories[0].settings.enabledPreferenceLineIds.push(line.id);const after=prompt(v,'a',{storySettings:v.stories[0].settings});assert.equal(after.intimacyStyle,before.intimacyStyle);assert.equal(after.intimacyStyleDirective,before.intimacyStyleDirective);assert.ok(after.greenLines.some(l=>l.id===line.id));assert.ok(after.intimacyStyleDirective.includes('permission alone establishes no dynamic'));});
test('explicit style override is respected without altering stored settings',()=>{const v=fixture();v.stories[0].settings.intimacyStyle='romantic';assert.equal(prompt(v,'a',{storySettings:{intimacyStyle:'direct'}}).intimacyStyle,'direct');assert.equal(v.stories[0].settings.intimacyStyle,'romantic');});
test('reload, portable export, and replacement restore retain independent styles',async()=>{const db=vaultDb(),v=await loadVault(db);Object.assign(v,fixture());v.stories[0].settings.intimacyStyle='direct';v.stories[1].settings.intimacyStyle='romantic';await saveVaultAtomic(db,v);const loaded=await loadVault(db),portable=parseVesperBackup(serializePortableBackup(loaded));assert.equal(portable.stories[0].settings.intimacyStyle,'direct');await commitPreparedImport(db,prepareImport(portable),{expectedRevision:loaded.storageRevision});const restored=await loadVault(db);assert.equal(prompt(restored).intimacyStyle,'direct');assert.equal(prompt(restored,'b').intimacyStyle,'romantic');assert.equal(restored.stories[0].settings.temperature,0);});
for(const style of ['romantic','balanced','direct','unfiltered'])test(`${style} reaches provider and repair without changing CNC`,async()=>{
  const v=fixture();v.stories[0].settings.intimacyStyle=style;const before=structuredClone(v),oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage,bodies=[];
  globalThis.localStorage={getItem:()=> 'synthetic-key'};globalThis.fetch=async(_url,o)=>{bodies.push(JSON.parse(o.body));return {ok:true,json:async()=>({choices:[{message:{content:bodies.length===1?'Amanda decided to leave.':'The evening settled quietly.'}}]})};};
  try{await runTurn({vault:v,storyId:'a',chatId:'chat-a',model:'synthetic',preferenceLines:v.preferenceLines,storySettings:v.stories[0].settings});assert.equal(bodies.length,2);for(const body of bodies){const system=JSON.parse(body.messages[0].content);if(style==='balanced')assert.equal(system.intimacyStyle,undefined);else assert.equal(system.intimacyStyle,prompt(v).intimacyStyleDirective);assert.ok(!system.greenLines.some(l=>l.tags.includes('cnc')));}assert.deepEqual(v,before);}
  finally{globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}
});

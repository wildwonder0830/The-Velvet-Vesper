import test from 'node:test';import assert from 'node:assert/strict';
import {emptyVault} from '../src/schema.js';
import {runTurn} from '../src/chat/turn-engine.js';
import {serializePortableBackup,parseVesperBackup} from '../src/backup/vesper-backup.js';
import {prepareImport,commitPreparedImport} from '../src/migration/import-service.js';
import {loadVault,saveVaultAtomic} from '../src/storage/vault-store.js';
import {vaultDb} from '../test-support/vault-db.js';
const models=await import('../src/settings/model-registry.js').catch(()=>({}));
function fixture(){const v=emptyVault('2026-01-01T00:00:00Z');v.personas=[{id:'p',name:'Amanda'}];v.characters=[{id:'x',name:'Character'}];v.stories=['a','b'].map(id=>({id,title:'Synthetic '+id,personaId:'p',characterIds:['x'],settings:{model:'synthetic/'+id,temperature:0,maxTokens:512,intimacyStyle:'direct',intimacyPacing:'slow',enabledPreferenceLineIds:[],custom:'preserve'}}));v.chats=['a','b'].map(id=>({id:'chat-'+id,storyId:id}));return v;}
test('production registry contains only the seven exact user-provided name and ID pairs',()=>assert.deepEqual(models.MODEL_REGISTRY,[
  {name:'Nemotron 3 Ultra Free',id:'nvidia/nemotron-3-ultra-550b-a55b:free'},
  {name:'Nemotron 3 Ultra Paid',id:'nvidia/nemotron-3-ultra-550b-a55b'},
  {name:'GLM 5.3 FlashX',id:'z-ai/glm-5.3-flashx'},
  {name:'Kimi K2 0905',id:'moonshotai/kimi-k2-0905'},
  {name:'Cydonia 24B V4.1',id:'thedrummer/cydonia-24b-v4.1'},
  {name:'Aion 3.0',id:'aion-labs/aion-3.0'},
  {name:'MiniMax M2.5',id:'minimax/minimax-m2.5'}
]));
test('curated display names map to exact case-sensitive IDs without mutation',()=>{assert.equal(typeof models.modelOptions,'function');const registry=[{name:'Synthetic First',id:'synthetic/Model.v1:free'},{name:'Synthetic Second',id:'synthetic/second'}],before=structuredClone(registry);assert.deepEqual(models.modelOptions(registry),registry);assert.deepEqual(registry,before);});
for(const value of ['', '   ', 'missing-provider', '/model', 'provider/', 'provider/model name', 'https://example/model', 'provider/model\nextra', 'provider/model?key=x',null,{}])test(`malformed new ID ${JSON.stringify(value)} rejected`,()=>{assert.equal(typeof models.validateModelId,'function');const result=models.validateModelId(value);assert.equal(result.ok,false);assert.ok(result.error.includes('model'));});
for(const id of ['synthetic/Exact-ID.v2','synthetic/model:free','synthetic/model/variant'])test(`custom ID ${id} retains exact spelling`,()=>{assert.equal(typeof models.validateModelId,'function');assert.deepEqual(models.validateModelId(id),{ok:true,id});});
test('surrounding entry whitespace is trimmed, never internal whitespace',()=>{assert.equal(typeof models.validateModelId,'function');assert.deepEqual(models.validateModelId('  synthetic/model  '),{ok:true,id:'synthetic/model'});});
test('invalid registry entries fail clearly rather than inventing replacements',()=>{assert.equal(typeof models.modelOptions,'function');assert.throws(()=>models.modelOptions([{name:'Bad',id:'bad id'}]),/model/i);});
test('reload and replacement restore preserve independent exact model IDs',async()=>{const db=vaultDb(),v=await loadVault(db);Object.assign(v,fixture());await saveVaultAtomic(db,v);const loaded=await loadVault(db),backup=parseVesperBackup(serializePortableBackup(loaded));await commitPreparedImport(db,prepareImport(backup),{expectedRevision:loaded.storageRevision});assert.deepEqual((await loadVault(db)).stories.map(s=>s.settings.model),['synthetic/a','synthetic/b']);});
test('model-only vault patch changes no other setting or record and retains conflict protection',async()=>{const db=vaultDb(),v=await loadVault(db);Object.assign(v,fixture());await saveVaultAtomic(db,v);const stale=await loadVault(db),current=await loadVault(db),before=structuredClone(current);current.stories[0].settings.model='synthetic/New-ID';await saveVaultAtomic(db,current);const latest=await loadVault(db);latest.stories[0].settings.model=before.stories[0].settings.model;delete latest.updatedAt;delete before.updatedAt;delete before.storageRevision;assert.deepEqual(latest,before);await assert.rejects(saveVaultAtomic(db,stale),e=>e.code==='VESPER_VAULT_CONFLICT');});
for(const id of ['synthetic/Exact-ID.v2','synthetic/model:free',...(models.MODEL_REGISTRY||[]).map(entry=>entry.id)])test(`provider and repair receive exact accepted model ${id}`,async()=>{const v=fixture(),oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage,bodies=[];globalThis.localStorage={getItem:()=> 'synthetic-key'};globalThis.fetch=async(_u,o)=>{bodies.push(JSON.parse(o.body));return {ok:true,json:async()=>({choices:[{message:{content:bodies.length===1?'Amanda decided to leave.':'The evening settled quietly.'}}]})};};try{await runTurn({vault:v,storyId:'a',chatId:'chat-a',model:id});assert.equal(bodies.length,2);assert.ok(bodies.every(b=>b.model===id));}finally{globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}});

import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyVault} from '../src/schema.js';
import {activeMemory,forgetMemory,filterMemoryForModel} from '../src/memory/memory-manager.js';
import {buildStoryContext} from '../src/prompt/context-builder.js';
import {assemblePrompt} from '../src/prompt/prompt-assembler.js';
import {runTurn} from '../src/chat/turn-engine.js';
import {serializePortableBackup,parseVesperBackup} from '../src/backup/vesper-backup.js';
import {prepareImport,commitPreparedImport} from '../src/migration/import-service.js';
import {loadVault,saveVaultAtomic} from '../src/storage/vault-store.js';
import {prepareVaultRegeneration,completeVaultRegeneration} from '../src/chat/regeneration.js';
import {vaultDb} from '../test-support/vault-db.js';

function fixture(){
 const v=emptyVault('2026-01-01T00:00:00Z');
 v.personas=[{id:'p',name:'Amanda'}];v.characters=[{id:'x',name:'Character'}];
 v.stories=['a','b','c'].map(id=>({id,title:`Story ${id}`,personaId:'p',characterIds:['x']}));
 v.chats=['a','b','c'].map(id=>({id:`chat-${id}`,storyId:id}));
 v.messages=[{id:'origin',storyId:'a',chatId:'chat-a',role:'user',ordinal:0,text:'Original private destination.'},{id:'safe-message',storyId:'b',chatId:'chat-b',role:'user',ordinal:0,text:'The garden is open.'},{id:'old',storyId:'b',chatId:'chat-b',role:'assistant',ordinal:1,text:'An old response.'}];
 v.memoryEntries=[{id:'root',storyId:'a',kind:'canon',status:'active',text:'Original private destination.',sourceMessageIds:['origin']},{id:'derived',storyId:'b',kind:'canon',status:'active',text:'DERIVED_B: A concealed refuge was established.',sourceMemoryIds:['root']},{id:'transitive',storyId:'c',kind:'character',status:'active',text:'DERIVED_C: He knows the refuge.',sourceMemoryIds:['derived']},{id:'summary',storyId:'b',chatId:'chat-b',kind:'summary',status:'active',text:'DERIVED_SUMMARY: Their concealed refuge matters.',sourceMemoryIds:['transitive']},{id:'safe',storyId:'b',kind:'canon',status:'active',text:'The garden is open.'},{id:'safe-summary',storyId:'b',chatId:'chat-b',kind:'summary',status:'active',text:'The garden is open.',sourceMessageIds:['safe-message']}];
 return v;
}
function forgotten(v=fixture()){v.memoryEntries=forgetMemory(v.memoryEntries,'root');return v;}
function prompt(v,id='b'){return assemblePrompt({vault:v,storyId:id,chatId:`chat-${id}`});}
function assertExcluded(v){
 for(const id of ['b','c'])for(const result of [activeMemory(v.memoryEntries,id),buildStoryContext(v,id,`chat-${id}`),prompt(v,id)])assert.ok(!JSON.stringify(result).includes('DERIVED_'));
 assert.deepEqual(prompt(v).memory.map(m=>m.id),['safe','safe-summary']);
}

test('forgotten story-A source excludes its direct story-B derivative',()=>{assert.ok(activeMemory(fixture().memoryEntries,'b').some(m=>m.id==='derived'));assertExcluded(forgotten());});
test('transitive exclusion spans stories and does not depend on record order',()=>{const v=forgotten();v.memoryEntries.reverse();assert.ok(!activeMemory(v.memoryEntries,'c').some(m=>m.id==='transitive'));assert.ok(!prompt(v).memory.some(m=>m.id==='summary'));});
for(const status of ['forgotten','deleted','excluded','retired'])test(`${status} source in another story blocks dependent retrieval`,()=>{const v=fixture();v.memoryEntries[0].status=status;assertExcluded(v);});
for(const marker of ['forgotten','deleted','excluded','forgottenAt','deletedAt','excludedAt'])test(`cross-story dependency honors ${marker} marker`,()=>{const v=fixture();v.memoryEntries[0][marker]=true;assertExcluded(v);});
test('singular sourceMemoryId references cannot bypass cross-story exclusion',()=>{const v=forgotten();delete v.memoryEntries[1].sourceMemoryIds;v.memoryEntries[1].sourceMemoryId='root';assertExcluded(v);});
test('nested data provenance excludes the whole derived memory',()=>{const v=forgotten();delete v.memoryEntries[1].sourceMemoryIds;v.memoryEntries[1].data={provenance:{sourceMemoryIds:['root']}};assertExcluded(v);});
test('invalidatedByMemoryId provenance excludes an active imported derivative',()=>{const v=forgotten();delete v.memoryEntries[1].sourceMemoryIds;v.memoryEntries[1].invalidatedByMemoryId='root';assertExcluded(v);});
test('dependency cycles connected to a forgotten root terminate and remain excluded',()=>{const v=forgotten();v.memoryEntries[1].sourceMemoryIds.push('transitive');assertExcluded(v);});
for(const id of ['x','b'])test(`global memory IDs do not exclude unrelated character/story record ${id}`,()=>{const v=fixture();v.memoryEntries[0].id=id;v.memoryEntries[1].sourceMemoryIds=[id];v.memoryEntries=forgetMemory(v.memoryEntries,id);const p=prompt(v);assert.deepEqual(p.characters,v.characters);assert.deepEqual(p.story,v.stories[1]);});
test('unrelated identical paraphrase remains usable without forgotten provenance',()=>{const v=forgotten();const text=v.memoryEntries[1].text;v.memoryEntries.push({id:'independent',storyId:'b',kind:'character',status:'active',text});assert.equal(prompt(v).memory.find(m=>m.id==='independent').text,text);});
test('safe source-backed summaries and unrelated story canon remain intact',()=>{const v=forgotten();const before=structuredClone(v.memoryEntries.filter(m=>m.id.startsWith('safe')));assert.deepEqual(prompt(v).memory,before);assert.ok(!prompt(v,'a').memory.some(m=>m.id==='safe'));});
test('cached structured model context cannot retain cross-story dependency records',()=>{const v=fixture(),cached=prompt(v);v.memoryEntries=forgetMemory(v.memoryEntries,'root');assert.ok(!JSON.stringify(filterMemoryForModel(cached,v.memoryEntries,'b')).includes('DERIVED_'));});
test('nested relationship and knowledge context honors forgotten provenance',()=>{const v=forgotten();v.relationships=[{id:'r',storyId:'b',participantIds:['p','x'],stage:'friends',establishedFacts:[{id:'bad-fact',text:'DERIVED_FACT',sourceMemoryIds:['transitive']},{id:'safe-fact',text:'An independent fact.'}]}];v.knowledgeEntries=[{id:'k',storyId:'b',knowerId:'x',factKey:'refuge',value:'DERIVED_KNOWLEDGE',sourceMemoryId:'derived'}];const p=prompt(v);assert.ok(!JSON.stringify(p).includes('DERIVED_'));assert.equal(p.relationship.establishedFacts[0].id,'safe-fact');});
test('protected context records with explicit memory provenance cannot leak',()=>{const v=forgotten();const filtered=filterMemoryForModel({milestones:[{id:'m',text:'DERIVED_EVENT',sourceMemoryIds:['derived']}],sceneState:{id:'scene',text:'DERIVED_SCENE',sourceMemoryId:'derived'}},v.memoryEntries,'b');assert.ok(!JSON.stringify(filtered).includes('DERIVED_'));});
test('forgetting keeps cross-story historical records unchanged in storage',()=>{const v=fixture(),original=structuredClone(v.memoryEntries.filter(m=>m.storyId!=='a'));v.memoryEntries=forgetMemory(v.memoryEntries,'root');assert.deepEqual(v.memoryEntries.filter(m=>m.storyId!=='a'),original);const before=JSON.stringify(v);assertExcluded(v);assert.equal(JSON.stringify(v),before);});
test('explicit source restoration restores active cross-story derivatives',()=>{const v=forgotten();assertExcluded(v);const root=v.memoryEntries[0];root.status='active';delete root.forgottenAt;delete root.forgetReason;assert.ok(prompt(v).memory.some(m=>m.id==='derived'));assert.ok(prompt(v,'c').memory.some(m=>m.id==='transitive'));assert.ok(prompt(v).memory.some(m=>m.id==='summary'));});
test('restoring only status does not bypass a retained forgetting marker',()=>{const v=forgotten();v.memoryEntries[0].status='active';assertExcluded(v);});
test('restoring source does not restore independently excluded descendants',()=>{const v=forgotten();v.memoryEntries[1].status='excluded';const root=v.memoryEntries[0];root.status='active';delete root.forgottenAt;delete root.forgetReason;assertExcluded(v);});

async function requests(v,duringTurn=false){
 const bodies=[],oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;globalThis.localStorage={getItem:()=> 'synthetic-key'};
 globalThis.fetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));if(bodies.length===1&&duringTurn)v.memoryEntries=forgetMemory(v.memoryEntries,'root');return {ok:true,json:async()=>({choices:[{message:{content:bodies.length===1?'Amanda decided to leave.':'The evening settled quietly.'}}]})};};
 try{await runTurn({vault:v,storyId:'b',chatId:'chat-b',model:'synthetic'});assert.equal(bodies.length,2);return bodies;}finally{globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}
}
test('provider and repair payloads exclude cross-story forgotten derivatives',async()=>{for(const body of await requests(forgotten())){const text=JSON.stringify(body);assert.ok(!text.includes('DERIVED_'));assert.ok(text.includes('The garden is open.'));}});
test('repair refresh observes a source forgotten in another story during generation',async()=>{const bodies=await requests(fixture(),true);assert.ok(JSON.stringify(bodies[0]).includes('DERIVED_'));assert.ok(!JSON.stringify(bodies[1]).includes('DERIVED_'));});
test('JSON reload and portable backup preserve historical forgotten state and exclusion',()=>{const v=forgotten();for(const restored of [JSON.parse(JSON.stringify(v)),prepareImport(parseVesperBackup(serializePortableBackup(v))).vault]){assertExcluded(restored);assert.deepEqual(restored.memoryEntries,v.memoryEntries);}});
test('persisted reload and backup replacement preserve cross-story exclusion',async()=>{const db=vaultDb(),v=await loadVault(db);Object.assign(v,forgotten());await saveVaultAtomic(db,v);assertExcluded(await loadVault(db));const before=await loadVault(db),prepared=prepareImport(parseVesperBackup(serializePortableBackup(before)));await commitPreparedImport(db,prepared,{expectedRevision:before.storageRevision});const reloaded=await loadVault(db);assertExcluded(reloaded);assert.deepEqual(reloaded.memoryEntries,before.memoryEntries);});
test('subsequent updates cannot revive a cross-story derived summary',()=>{const v=forgotten();v.memoryEntries.push({id:'new-derived',storyId:'b',kind:'summary',chatId:'chat-b',status:'active',text:'DERIVED_UPDATE',sourceMemoryIds:['summary']});assertExcluded(v);});
test('regeneration retains tombstones and cross-story derivative exclusion',()=>{const v=forgotten(),plan=prepareVaultRegeneration(v,'old'),result=completeVaultRegeneration(plan,{id:'new',storyId:'b',chatId:'chat-b',role:'assistant',ordinal:1,text:'A replacement.'});assertExcluded(result);assert.equal(result.memoryEntries.find(m=>m.id==='root').status,'forgotten');parseVesperBackup(serializePortableBackup(result));});
test('stale-save conflict cannot revive cross-story forgotten derivatives',async()=>{const db=vaultDb(),v=await loadVault(db);Object.assign(v,fixture());await saveVaultAtomic(db,v);const stale=await loadVault(db),current=await loadVault(db);current.memoryEntries=forgetMemory(current.memoryEntries,'root');await saveVaultAtomic(db,current);const before=JSON.stringify(await loadVault(db));await assert.rejects(saveVaultAtomic(db,stale),e=>e.code==='VESPER_VAULT_CONFLICT'&&e.refreshRequired);assert.equal(JSON.stringify(await loadVault(db)),before);assertExcluded(await loadVault(db));});

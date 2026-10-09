import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyVault} from '../src/schema.js';
import {prepareAssistantEdit} from '../src/chat/message-edit.js';
import {assemblePrompt} from '../src/prompt/prompt-assembler.js';
import {buildStoryContext} from '../src/prompt/context-builder.js';
import {runTurn} from '../src/chat/turn-engine.js';
import {serializePortableBackup,parseVesperBackup} from '../src/backup/vesper-backup.js';
import {prepareImport,commitPreparedImport} from '../src/migration/import-service.js';
import {loadVault,saveVaultAtomic} from '../src/storage/vault-store.js';
import {vaultDb} from '../test-support/vault-db.js';

function fixture(){
 const v=emptyVault('2026-01-01T00:00:00Z');
 v.personas=[{id:'p',name:'Synthetic Persona'}];v.characters=[{id:'x',name:'Synthetic Character'}];
 v.stories=[{id:'s',title:'Synthetic',personaId:'p',characterIds:['x']},{id:'other',title:'Other',personaId:'p',characterIds:['x']}];
 v.chats=[{id:'a',storyId:'s'},{id:'b',storyId:'s'},{id:'other-chat',storyId:'other'}];
 v.messages=[{id:'reply',storyId:'s',chatId:'a',role:'assistant',text:'ORIGINAL_ERROR: The box was blue.',ordinal:0,createdAt:'2026-01-01T00:00:00Z'}];
 v.memoryEntries=[{id:'old-summary',storyId:'s',chatId:'a',kind:'summary',text:'STALE_SUMMARY: A blue box.',status:'active',sourceMessageIds:['reply']},{id:'safe',storyId:'s',kind:'canon',text:'UNRELATED_CANON',status:'active'}];
 return v;
}
const edit=(v,text='CORRECTED_AUTHORITY: The box was red.')=>prepareAssistantEdit(v,{messageId:'reply',storyId:'s',chatId:'a',text,now:'2026-01-02T00:00:00Z'});
const prompt=v=>assemblePrompt({vault:v,storyId:'s',chatId:'a'});

test('edited reply retains original recovery history without exposing it in context',()=>{
 const v=edit(fixture());assert.equal(v.messages[0].editHistory[0].text,'ORIGINAL_ERROR: The box was blue.');
 const p=prompt(v);assert.ok(!JSON.stringify(p).includes('ORIGINAL_ERROR'));assert.ok(!JSON.stringify(p).includes('editHistory'));
});
test('authoritative correction remains in context beyond the recent-message window',()=>{
 const v=edit(fixture());for(let i=1;i<=45;i++)v.messages.push({id:`later-${i}`,storyId:'s',chatId:'a',role:'user',text:'Later unrelated turn.',ordinal:i});
 const p=prompt(v);assert.ok(!p.recentMessages.some(m=>m.id==='reply'));assert.equal(p.authoritativeEdits.messages[0].text,v.messages[0].text);assert.ok(p.authoritativeEdits.rule.includes('correction'));
});
test('source-linked stale summary is withheld without rewriting stored history',()=>{
 const base=fixture(),v=edit(base),before=structuredClone(v),context=buildStoryContext(v,'s','a');
 assert.ok(!context.memory.some(m=>m.id==='old-summary'));assert.ok(context.memory.some(m=>m.id==='safe'));assert.ok(!JSON.stringify(prompt(v)).includes('STALE_SUMMARY'));assert.deepEqual(v,before);assert.deepEqual(v.memoryEntries,base.memoryEntries);
});
test('source-linked derivatives are withheld transitively while unrelated records survive',()=>{
 const v=fixture();v.memoryEntries.push({id:'derived',storyId:'s',chatId:'a',kind:'canon',status:'active',text:'DERIVED_OLD_BOX',sourceMemoryIds:['old-summary']});
 v.knowledgeEntries=[{id:'knowledge',storyId:'s',chatId:'a',factKey:'box',value:'STALE_KNOWLEDGE',data:{sourceMemoryId:'derived'}}];
 v.sceneStates=[{id:'scene',storyId:'s',chatId:'a',location:'STALE_LOCATION',sourceMessageIds:['reply']}];
 v.relationships=[{id:'relationship',storyId:'s',stage:'friends',establishedFacts:[{id:'old-fact',text:'STALE_NESTED_FACT',sourceMemoryIds:['derived']},{id:'safe-fact',text:'SAFE_NESTED_FACT'}]}];
 const p=prompt(edit(v));for(const old of ['DERIVED_OLD_BOX','STALE_KNOWLEDGE','STALE_LOCATION','STALE_NESTED_FACT'])assert.ok(!JSON.stringify(p).includes(old),old);assert.ok(JSON.stringify(p).includes('SAFE_NESTED_FACT'));
});
test('correction authority is confined to its owning story and chat',()=>{
 const v=edit(fixture());for(const [storyId,chatId] of [['s','b'],['other','other-chat']]){const p=assemblePrompt({vault:v,storyId,chatId});assert.ok(!JSON.stringify(p).includes('CORRECTED_AUTHORITY'));assert.equal(p.authoritativeEdits,undefined);}
});
test('new source-backed summary may use the current corrected version; old record updates stay withheld',()=>{
 const v=edit(fixture());v.memoryEntries.find(m=>m.id==='old-summary').updatedAt='2026-01-03T00:00:00Z';
 v.memoryEntries.push({id:'new-summary',storyId:'s',chatId:'a',kind:'summary',text:'CURRENT_SUMMARY: A red box.',status:'active',sourceMessageIds:['reply']});
 const p=prompt(v);assert.ok(p.memory.some(m=>m.id==='new-summary'));assert.ok(!p.memory.some(m=>m.id==='old-summary'));
});
test('reload and backup/restore retain corrections, history, and exclusion',async()=>{
 const db=vaultDb(),initial=await loadVault(db);Object.assign(initial,fixture());await saveVaultAtomic(db,initial);
 const current=await loadVault(db),next=edit(current);await saveVaultAtomic(db,next,{expectedRevision:current.storageRevision});
 const reloaded=await loadVault(db),prepared=prepareImport(parseVesperBackup(serializePortableBackup(reloaded)));await commitPreparedImport(db,prepared,{expectedRevision:reloaded.storageRevision});
 for(const v of [reloaded,await loadVault(db)]){assert.ok(prompt(v).authoritativeEdits);assert.ok(!JSON.stringify(prompt(v)).includes('STALE_SUMMARY'));assert.equal(v.messages[0].editHistory[0].text,'ORIGINAL_ERROR: The box was blue.');}
});
test('provider and repair both receive authoritative corrections and omit stale memory',async()=>{
 const v=edit(fixture()),bodies=[],oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
 globalThis.localStorage={getItem:()=> 'synthetic-key'};globalThis.fetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:bodies.length===1?'Synthetic Persona decided to leave.':'The room settled quietly.'}}]})};};
 try{await runTurn({vault:v,storyId:'s',chatId:'a',model:'synthetic'});assert.equal(bodies.length,2);for(const body of bodies){const system=JSON.parse(body.messages[0].content);assert.equal(system.authoritativeEdits.messages[0].text,v.messages[0].text);assert.ok(!JSON.stringify(body).includes('ORIGINAL_ERROR'));assert.ok(!JSON.stringify(body).includes('STALE_SUMMARY'));}}
 finally{globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}
});

test('unchanged verified milestone evidence and independently supported canon remain usable',()=>{
 const v=fixture();v.messages[0].text+=' Synthetic Persona and Synthetic Character completed their mate bond.';
 v.messages.push({id:'independent-proof',storyId:'s',chatId:'a',role:'user',ordinal:1,text:'INDEPENDENT_FACT: The house has a garden.'});
 v.memoryEntries.push({id:'independent',storyId:'s',kind:'canon',text:v.messages[1].text,sourceMessageIds:['reply','independent-proof'],status:'active'});
 v.milestones=[{id:'bond',storyId:'s',chatId:'a',type:'mated',status:'confirmed',participants:['p','x'],evidence:'Synthetic Persona and Synthetic Character completed their mate bond.',sourceMessageId:'reply',verification:{verified:true,completed:true,verifiedBy:'user'}}];
 v.relationships=[{id:'bond-state',storyId:'s',participantIds:['p','x'],stage:'mated',sourceMilestoneId:'bond'}];
 const p=prompt(edit(v,'CORRECTED_AUTHORITY: The box was red. Synthetic Persona and Synthetic Character completed their mate bond.'));
 assert.equal(p.milestones[0]?.id,'bond');assert.ok(p.mateBondCanon);assert.ok(p.memory.some(m=>m.id==='independent'));
});

test('unsourced summaries that may contain the old reply are withheld, earlier summaries remain',()=>{
 const v=fixture();v.memoryEntries.push({id:'unknown-summary',storyId:'s',chatId:'a',kind:'summary',text:'UNKNOWN_SUMMARY_ERROR',status:'active'},{id:'earlier-summary',storyId:'s',chatId:'a',kind:'summary',text:'SAFE_PRE_REPLY_SUMMARY',status:'active',updatedAt:'2025-12-31T00:00:00Z'});
 const p=prompt(edit(v));assert.ok(!JSON.stringify(p).includes('UNKNOWN_SUMMARY_ERROR'));assert.ok(JSON.stringify(p).includes('SAFE_PRE_REPLY_SUMMARY'));
});

test('a second edit withholds summaries of both superseded versions',()=>{
 const first=edit(fixture());first.memoryEntries.push({id:'summary-version-2',storyId:'s',chatId:'a',kind:'summary',text:'VERSION_TWO_SUMMARY',sourceMessageIds:['reply'],status:'active'});
 const v=edit(first,'THIRD_VERSION: The box was green.'),p=prompt(v);
 assert.equal(v.messages[0].editHistory.length,2);assert.equal(p.authoritativeEdits.messages[0].text,'THIRD_VERSION: The box was green.');
 for(const old of ['ORIGINAL_ERROR','CORRECTED_AUTHORITY','VERSION_TWO_SUMMARY','STALE_SUMMARY'])assert.ok(!JSON.stringify(p).includes(old),old);
});

test('withheld context IDs survive sorting and adding unrelated records',()=>{
 const v=edit(fixture());v.memoryEntries.reverse();v.memoryEntries.unshift({id:'new-independent',storyId:'s',kind:'canon',text:'NEW_UNRELATED',status:'active'});
 const p=prompt(v);assert.ok(!p.memory.some(m=>m.id==='old-summary'));assert.ok(p.memory.some(m=>m.id==='new-independent'));assert.ok(p.memory.some(m=>m.id==='safe'));
});

test('anon sourced nested facts do not suppress their siblings after reorder',()=>{
 const v=fixture();v.relationships=[{id:'r',storyId:'s',stage:'friends',establishedFacts:[{text:'OLD_ANONYMOUS',sourceMessageId:'reply'},{text:'SAFE_ANONYMOUS'}]}];
 const corrected=edit(v);corrected.relationships[0].establishedFacts.reverse();const p=prompt(corrected);
 assert.deepEqual(p.relationship.establishedFacts,[{text:'SAFE_ANONYMOUS'}]);
});

test('forgotten-memory exclusion takes priority over correction context and recovery history',async()=>{
 const {forgetMemory}=await import('../src/memory/memory-manager.js');const v=edit(fixture());v.memoryEntries.push({id:'forgotten',storyId:'s',kind:'canon',status:'active',text:v.messages[0].text,sourceMessageIds:['reply']});v.memoryEntries=forgetMemory(v.memoryEntries,'forgotten');
 assert.ok(!JSON.stringify(prompt(v)).includes('CORRECTED_AUTHORITY'));assert.ok(!JSON.stringify(prompt(v)).includes('ORIGINAL_ERROR'));
});

test('invalidated verified milestone and its derived relationship cannot override an edit',()=>{
 const v=fixture();v.messages[0].text='Synthetic Persona and Synthetic Character completed their mate bond.';
 v.milestones=[{id:'bond',storyId:'s',chatId:'a',type:'mated',status:'confirmed',participants:['p','x'],evidence:v.messages[0].text,sourceMessageId:'reply',verification:{verified:true,completed:true,verifiedBy:'user'}}];
 v.relationships=[{id:'bond-state',storyId:'s',participantIds:['p','x'],stage:'mated',sourceMilestoneId:'bond'}];
 const corrected=edit(v,'CORRECTED_AUTHORITY: They remained friends.'),p=prompt(corrected);
 assert.deepEqual(p.milestones,[]);assert.equal(p.relationship,null);assert.equal(p.mateBondCanon,null);assert.deepEqual(corrected.milestones,v.milestones);assert.deepEqual(corrected.relationships,v.relationships);
});

test('stale-save conflict and transaction abort cannot partially apply authority metadata',async()=>{
 const db=vaultDb(),v=await loadVault(db);Object.assign(v,fixture());await saveVaultAtomic(db,v);
 const a=await loadVault(db),b=await loadVault(db);a.messages.push({id:'newest',storyId:'s',chatId:'a',role:'user',ordinal:1,text:'Newer saved message.'});await saveVaultAtomic(db,a);
 const newest=await loadVault(db);await assert.rejects(saveVaultAtomic(db,edit(b),{expectedRevision:b.storageRevision}),e=>e.code==='VESPER_VAULT_CONFLICT');assert.deepEqual(await loadVault(db),newest);
 const abortDb=vaultDb({failWrites:true});await assert.rejects(saveVaultAtomic(abortDb,edit(fixture())));assert.equal((await loadVault(abortDb)).messages.length,0);
});

test('source-derived stale memories in another story are withheld without leaking corrected prose',()=>{
 const v=fixture();v.memoryEntries.push({id:'foreign-derivative',storyId:'other',kind:'canon',text:'FOREIGN_STALE_SOURCE',sourceMemoryIds:['old-summary'],status:'active'},{id:'foreign-safe',storyId:'other',kind:'canon',text:'FOREIGN_SAFE_CANON',status:'active'});
 const corrected=edit(v),p=assemblePrompt({vault:corrected,storyId:'other',chatId:'other-chat'});
 assert.ok(!JSON.stringify(p).includes('FOREIGN_STALE_SOURCE'));assert.ok(!JSON.stringify(p).includes('CORRECTED_AUTHORITY'));assert.ok(JSON.stringify(p).includes('FOREIGN_SAFE_CANON'));
});

test('recovery restores original prose only through an explicit new save, with old summaries still withheld',async()=>{
 const {originalAssistantText}=await import('../src/chat/message-edit.js');const v=edit(fixture()),before=structuredClone(v),text=originalAssistantText(v.messages[0]);assert.deepEqual(v,before);
 const restored=edit(v,text),p=prompt(restored);assert.equal(p.authoritativeEdits.messages[0].text,'ORIGINAL_ERROR: The box was blue.');assert.equal(restored.messages[0].id,v.messages[0].id);assert.equal(restored.messages[0].ordinal,v.messages[0].ordinal);assert.equal(restored.messages[0].editHistory.length,2);assert.ok(!JSON.stringify(p).includes('STALE_SUMMARY'));assert.ok(!JSON.stringify(p).includes('CORRECTED_AUTHORITY'));
});

test('repair refresh sees a newer correction and invalidates summaries written before it',async()=>{
 const v=edit(fixture()),bodies=[],oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
 globalThis.localStorage={getItem:()=> 'synthetic-key'};globalThis.fetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));if(bodies.length===1){v.memoryEntries.push({id:'mid-turn-summary',storyId:'s',chatId:'a',kind:'summary',text:'MID_TURN_STALE',sourceMessageIds:['reply'],status:'active'});Object.assign(v,edit(v,'LATEST_CORRECTION: The box was green.'));}return {ok:true,json:async()=>({choices:[{message:{content:bodies.length===1?'Synthetic Persona decided to leave.':'The room settled quietly.'}}]})};};
 try{await runTurn({vault:v,storyId:'s',chatId:'a',model:'synthetic'});assert.equal(bodies.length,2);assert.ok(JSON.stringify(bodies[0]).includes('CORRECTED_AUTHORITY'));assert.ok(JSON.stringify(bodies[1]).includes('LATEST_CORRECTION'));assert.ok(!JSON.stringify(bodies[1]).includes('CORRECTED_AUTHORITY'));assert.ok(!JSON.stringify(bodies[1]).includes('MID_TURN_STALE'));}
 finally{globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}
});

test('phone context withholds stale history and summaries without revealing private main-story corrections',async()=>{
 const {ensureStoryPhone,appendPhoneMessage}=await import('../src/phone/phone-state.js');const {buildPhoneContext}=await import('../src/phone/phone-context.js');const {runPhoneTurn}=await import('../src/phone/phone-engine.js');
 let v=ensureStoryPhone(fixture(),'s','a','2026-01-01T00:00:00Z');const threadId=v.stories[0].phone.threads[0].id;
 v=appendPhoneMessage(v,'s',threadId,{id:'old-phone',senderType:'character',senderId:'x',text:'OLD_PHONE_DERIVATIVE',sourceMessageIds:['reply']},'2026-01-01T00:00:00Z');
 v=appendPhoneMessage(v,'s',threadId,{id:'safe-phone',senderType:'character',senderId:'x',text:'SAFE_PHONE_TEXT'},'2026-01-01T00:00:01Z');
 v=edit(v);const before=structuredClone(v);assert.deepEqual(buildPhoneContext(v,{storyId:'s',chatId:'a',respondingCharacterIds:['x']}).map(m=>m.text),['SAFE_PHONE_TEXT']);
 const calls=[];await runPhoneTurn({vault:v,storyId:'s',threadId,action:'continue',send:async args=>{calls.push(args);return {choices:[{message:{content:'[{"speakerId":"x","text":"Synthetic reply."}]'}}]};}});
 const payload=JSON.stringify(calls[0]);for(const old of ['ORIGINAL_ERROR','CORRECTED_AUTHORITY','OLD_PHONE_DERIVATIVE','STALE_SUMMARY'])assert.ok(!payload.includes(old),old);assert.ok(payload.includes('SAFE_PHONE_TEXT'));assert.deepEqual(v,before);
});

test('editing a recovered phone source preserves a valid backup and keeps old phone prose model-invisible',async()=>{
 const {ensureStoryPhone}=await import('../src/phone/phone-state.js'),{scanPhoneHistory,applyPhoneHistory}=await import('../src/phone/phone-history.js');
 let v=fixture();v.messages[0].text='Text conversation: Synthetic Persona, Synthetic Character\nSynthetic Persona: Meet at the gate.\nSynthetic Character: On my way.';v=ensureStoryPhone(v,'s','a','2026-01-01T00:00:00Z');
 const preview=scanPhoneHistory(v,'s');assert.equal(preview.candidates.length,2);v=applyPhoneHistory(v,preview,{confirmed:true,selectedKeys:preview.candidates.map(c=>c.key)},'2026-01-01T01:00:00Z');const before=structuredClone(v.stories[0].phone);
 const corrected=edit(v,'CORRECTED_AUTHORITY: The conversation took place at the garden.'),restored=parseVesperBackup(serializePortableBackup(corrected));assert.deepEqual(restored.stories[0].phone,before);assert.equal(prompt(restored).phoneContinuity,undefined);assert.ok(!JSON.stringify(prompt(restored)).includes('Meet at the gate.'));
 const corrupted=structuredClone(corrected);corrupted.messages[0].editHistory[0].text='Tampered source';assert.throws(()=>parseVesperBackup(serializePortableBackup(corrupted)),/Invalid/);
});

// Approved proof fixtures remain external; no private content is embedded here.
test('verified historical event proof remains strict across source edits and backup restore',{skip:!process.env.VESPER_PHONE_EVENT_FIXTURE_DIR},async()=>{
 const {readFile}=await import('node:fs/promises'),dir=process.env.VESPER_PHONE_EVENT_FIXTURE_DIR;
 const paths=JSON.parse(await readFile(dir+'/source-hashes.json','utf8')),backupPath=Object.keys(paths).find(path=>path.endsWith('.json'));
 const base=JSON.parse(await readFile(backupPath,'utf8')),ledger=JSON.parse(await readFile(dir+'/verified-package.private.json','utf8'));
 const {previewPhoneEvents,applyPhoneEvents}=await import('../src/phone/phone-event-import.js'),{eventSourceCurrent}=await import('../src/phone/phone-event-evidence.js');
 const entry=ledger.entries.find(entry=>entry.claim.sourceChecks.some(check=>base.messages.some(m=>m.id===check.id&&m.role==='assistant')));assert.ok(entry);
 const v=applyPhoneEvents(base,previewPhoneEvents(base,{version:1,entries:[entry]}),{confirmed:true});
 const source=v.messages.find(m=>m.role==='assistant'&&entry.claim.sourceChecks.some(check=>check.id===m.id));
 const edited=prepareAssistantEdit(v,{messageId:source.id,storyId:source.storyId,chatId:source.chatId,text:source.text+'\nSynthetic local correction marker.'});
 const phone=edited.stories.flatMap(s=>s.phone?.threads||[]).flatMap(t=>t.messages).find(m=>m.recovery?.version===3);
 assert.equal(eventSourceCurrent(phone,edited),false);assert.equal(eventSourceCurrent(phone,edited,{includeExcluded:true}),true);
 const restored=parseVesperBackup(serializePortableBackup(edited));assert.deepEqual(restored.stories,edited.stories);
 const withoutArchive=structuredClone(edited);for(const story of withoutArchive.stories)for(const thread of story.phone?.threads||[])thread.messages=thread.messages.filter(m=>m.id!==phone.id);assert.equal(previewPhoneEvents(withoutArchive,{version:1,entries:[entry]}).accepted.length,0,'Archive-only evidence must not authorize a new import from a changed source');
 const corrupted=structuredClone(edited);corrupted.messages.find(m=>m.id===source.id).editHistory[0].text='Invalid synthetic archived source';assert.equal(eventSourceCurrent(phone,corrupted,{includeExcluded:true}),false);assert.throws(()=>serializePortableBackup(corrupted),/Invalid/);
});

test('a correction retracting quoted milestone evidence cannot keep old mate-bond canon active',()=>{
 const v=fixture();v.messages[0].text='Synthetic Persona and Synthetic Character completed their mate bond.';
 v.milestones=[{id:'bond',storyId:'s',chatId:'a',type:'mated',status:'confirmed',participants:['p','x'],evidence:v.messages[0].text,sourceMessageId:'reply',verification:{verified:true,completed:true,verifiedBy:'user'}}];v.relationships=[{id:'bond-state',storyId:'s',participantIds:['p','x'],stage:'mated',sourceMilestoneId:'bond'}];
 const p=prompt(edit(v,'CORRECTED_AUTHORITY: It is false that Synthetic Persona and Synthetic Character completed their mate bond. They remained friends.'));
 assert.equal(p.mateBondCanon,null);assert.equal(p.relationship,null);assert.deepEqual(p.milestones,[]);
});

test('excluded or forgotten replies never leak through the authoritative correction block',()=>{
 for(const exclusion of [{status:'forgotten'},{status:'retired'},{status:'deleted'},{status:'excluded'},{forgotten:true},{excluded:true},{deleted:true},{retired:true},{forgottenAt:'2026-01-03T00:00:00Z'},{deletedAt:'2026-01-03T00:00:00Z'},{excludedAt:'2026-01-03T00:00:00Z'},{retiredAt:'2026-01-03T00:00:00Z'}]){
  const v=edit(fixture());Object.assign(v.messages[0],exclusion);const p=prompt(v);assert.ok(!JSON.stringify(p.authoritativeEdits||{}).includes('CORRECTED_AUTHORITY'),JSON.stringify(exclusion));
 }
});

test('phone archives imported between two edits retain their exact intermediate source version',async()=>{
 const {ensureStoryPhone}=await import('../src/phone/phone-state.js'),{scanPhoneHistory,applyPhoneHistory}=await import('../src/phone/phone-history.js');
 let v=fixture();v.messages[0].text='Text conversation: Synthetic Persona, Synthetic Character\nSynthetic Persona: Original text.';
 v=edit(v,'Text conversation: Synthetic Persona, Synthetic Character\nSynthetic Persona: Updated sent text.');v=ensureStoryPhone(v,'s','a','2026-01-02T01:00:00Z');
 const preview=scanPhoneHistory(v,'s');assert.equal(preview.candidates.length,1);v=applyPhoneHistory(v,preview,{confirmed:true,selectedKeys:preview.candidates.map(c=>c.key)},'2026-01-02T02:00:00Z');
 const before=structuredClone(v.stories[0].phone);v=prepareAssistantEdit(v,{messageId:'reply',storyId:'s',chatId:'a',text:'A later corrected version.',now:'2026-01-03T00:00:00Z'});
 assert.deepEqual(parseVesperBackup(serializePortableBackup(v)).stories[0].phone,before);assert.equal(prompt(v).phoneContinuity,undefined);
});

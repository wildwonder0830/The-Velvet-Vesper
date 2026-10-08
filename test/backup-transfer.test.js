import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyVault } from '../src/schema.js';
import { createBackupFile, readBackupFile, shareBackup, downloadBackupFile } from '../src/backup/backup-transfer.js';
import { parseVesperBackup } from '../src/backup/vesper-backup.js';
import { vaultDb } from '../test-support/vault-db.js';
import { loadVault, saveVaultAtomic } from '../src/storage/vault-store.js';
import { commitPreparedImport } from '../src/migration/import-service.js';
function fixture(){const v=emptyVault();v.personas=[{id:'p',name:'Synthetic'}];v.characters=[{id:'x',name:'Synthetic'}];v.stories=[{id:'s',title:'Synthetic',personaId:'p',characterIds:['x'],settings:{model:'synthetic/model',intimacyStyle:'balanced'}}];v.chats=[{id:'c',storyId:'s'}];return v;}
test('export is validated, portable, preserves data, and excludes credentials',async()=>{const v=fixture(),before=JSON.stringify(v);v.apiKey='synthetic-only';const f=createBackupFile(v,'synthetic.json');const parsed=parseVesperBackup(await f.text());assert.equal(f.name,'synthetic.json');assert.equal(f.type,'application/json');assert.equal(parsed.apiKey,undefined);delete v.apiKey;assert.equal(JSON.stringify(v),before);});
test('file read exposes progress before preparation and defaults to explicit replacement',async()=>{const steps=[];const p=await readBackupFile(createBackupFile(fixture()),s=>steps.push(s));assert.deepEqual(steps,['Reading backup…','Validating backup…']);assert.equal(p.importMode,'replace');assert.equal(p.vault.stories.length,1);});
for(const text of ['{','{}','{"format":"the-velvet-vesper-vault","schemaVersion":999}'])test(`invalid input safely rejected: ${text}`,async()=>{await assert.rejects(readBackupFile(new File([text],'bad.json')));});
test('read failure is returned without a prepared import',async()=>{await assert.rejects(readBackupFile({text:async()=>{throw new Error('Read interrupted');}}),/Read interrupted/);});
test('share delivers the exact file without a storage write',async()=>{const file=createBackupFile(fixture());let received;assert.equal(await shareBackup(file,{canShare:()=>true,share:async data=>{received=data;}}),true);assert.equal(received.files[0],file);});
test('share cancellation is distinguished from failure and unsupported sharing',async()=>{const f=createBackupFile(fixture());assert.equal(await shareBackup(f,{canShare:()=>true,share:async()=>{throw Object.assign(new Error(),{name:'AbortError'});}}),false);await assert.rejects(shareBackup(f,{}),/Download JSON/);await assert.rejects(shareBackup(f,{canShare:()=>true,share:async()=>{throw new Error('Unavailable');}}),/Unavailable/);});
test('large 8-story 1757-message backup restores, repeats, and rolls back without duplicates',async()=>{const v=fixture();v.stories=[];v.chats=[];for(let i=0;i<8;i++){v.stories.push({id:`s${i}`,title:`Synthetic ${i}`,personaId:'p',characterIds:['x']});v.chats.push({id:`c${i}`,storyId:`s${i}`});}for(let i=0;i<1757;i++)v.messages.push({id:`m${i}`,storyId:`s${i%8}`,chatId:`c${i%8}`,role:i%2?'assistant':'user',ordinal:i,text:'Synthetic test content. '.repeat(130)});const file=createBackupFile(v);assert.ok(file.size>4200000);const db=vaultDb(),baseline=await loadVault(db),rollback=createBackupFile(baseline);const p=await readBackupFile(file);await commitPreparedImport(db,p,{expectedRevision:baseline.storageRevision});assert.equal((await loadVault(db)).messages.length,1757);await commitPreparedImport(db,p,{expectedRevision:(await loadVault(db)).storageRevision});assert.equal((await loadVault(db)).messages.length,1757);await commitPreparedImport(db,await readBackupFile(rollback),{expectedRevision:(await loadVault(db)).storageRevision});assert.equal((await loadVault(db)).stories.length,0);});
test('preview base revision cannot overwrite concurrent data',async()=>{const db=vaultDb(),base=await loadVault(db),p=await readBackupFile(createBackupFile(fixture()));await saveVaultAtomic(db,base);const before=JSON.stringify(await loadVault(db));await assert.rejects(commitPreparedImport(db,p,{expectedRevision:0}),e=>e.code==='VESPER_VAULT_CONFLICT');assert.equal(JSON.stringify(await loadVault(db)),before);});
test('transaction interruption preserves the original persisted vault',async()=>{const db=vaultDb({failWrites:true}),base=await loadVault(db);await assert.rejects(commitPreparedImport(db,await readBackupFile(createBackupFile(fixture())),{expectedRevision:base.storageRevision}),/aborted/);assert.equal((await loadVault(db)).stories.length,0);});

import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
test('post-commit refresh failure reports that data WAS restored, not unchanged',async()=>{
 const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('async function confirmImport(){'),source.indexOf('function applyStoryTemplate()'));
 const controls={restoreBackupSaved:{checked:true},backupTransferClose:{},importFile:{}};let committed=false,message='';
 const context=vm.createContext({preparedImport:{},importRevision:4,db:{},vault:null,importingBackup:false,$:id=>controls[id],transferMessage:text=>message=text,setTimeout,commitPreparedImport:async()=>{committed=true;},loadVault:async()=>{throw new Error('Read interrupted');},render:()=>{}});
 vm.runInContext(code,context);await context.confirmImport();assert.equal(committed,true);assert.match(message,/Backup was restored/);assert.doesNotMatch(message,/did not change/);assert.equal(controls.backupTransferClose.disabled,false);
});

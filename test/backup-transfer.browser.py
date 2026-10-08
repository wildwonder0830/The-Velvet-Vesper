"""Synthetic-only Chromium + real IndexedDB; mobile sizes are not native Safari."""
import asyncio,json,pathlib,threading,http.server,functools
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8794),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
STATE="async()=>{const s=await import('./src/storage/vault-store.js');return JSON.stringify(await s.loadVault(await s.openVesperDb()));}"
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:8794/');await page.locator('.milestone-toast').wait_for(state='attached')
   await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),v=await s.loadVault(await s.openVesperDb());await s.saveVaultAtomic(await s.openVesperDb(),v);}")
   await page.reload();await page.locator('.milestone-toast').wait_for(state='attached')
   original=await page.evaluate(STATE)
   await page.click('#settingsButton');await page.click('#backupButton');await page.locator('#downloadBackupFile').wait_for()
   async with page.expect_download() as d:await page.click('#downloadBackupFile')
   rollback=pathlib.Path(await (await d.value).path()).read_bytes();assert (await d.value).suggested_filename.endswith('.json');assert len(rollback)>0;assert json.loads(rollback)['format']=='the-velvet-vesper-vault';assert await page.evaluate(STATE)==original
   await page.click('#backupTransferClose');await page.click('#settingsClose')
   # Inject the Web Share interface solely to verify invocation/cancellation branches.
   await page.evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.sharedName=data.files[0].name;}})")
   await page.click('#settingsButton');await page.click('#backupButton');await page.locator('#downloadBackupFile').wait_for()
   if device=='Desktop':
    await page.click('#shareBackup');assert await page.evaluate('Boolean(window.sharedName)')
   else:
    assert await page.locator('#shareBackup').count()==0
    assert 'Share / Save to Files is disabled' in await page.locator('#backupTransferContent').inner_text()
    assert not await page.evaluate('Boolean(window.sharedName)')
   await page.click('#backupTransferClose');await page.click('#settingsClose')
   for bad in [b'{',b'{}']:
    await page.locator('#importFile').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':bad});await page.wait_for_function("document.querySelector('#backupTransferContent').textContent.startsWith('Import error:')");assert await page.evaluate(STATE)==original;await page.click('#backupTransferClose')
   large=await page.evaluate("""async()=>{const {emptyVault}=await import('./src/schema.js'),{serializePortableBackup}=await import('./src/backup/vesper-backup.js');const v=emptyVault();v.personas=[{id:'p',name:'Synthetic'}];v.characters=[{id:'x',name:'Synthetic'}];for(let i=0;i<8;i++){v.stories.push({id:'s'+i,title:'Synthetic '+i,personaId:'p',characterIds:['x']});v.chats.push({id:'c'+i,storyId:'s'+i});}for(let i=0;i<1757;i++)v.messages.push({id:'m'+i,storyId:'s'+i%8,chatId:'c'+i%8,role:i%2?'assistant':'user',ordinal:i,text:'Synthetic test content. '.repeat(130)});return serializePortableBackup(v);} """)
   assert len(large.encode())>4200000
   payload={'name':'synthetic-large.json','mimeType':'application/json','buffer':large.encode()}
   await page.locator('#importFile').set_input_files(payload);await page.locator('#confirmImport').wait_for();assert await page.locator('#confirmImport').is_disabled();assert 'REPLACE' in await page.locator('#backupTransferContent').inner_text()
   assert await page.evaluate(STATE)==original
   await page.click('#cancelImport');assert await page.evaluate(STATE)==original
   # Canceling while the async file read is in progress must never reopen/prepare it.
   await page.locator('#importFile').set_input_files(payload);await page.click('#backupTransferClose');await page.wait_for_timeout(250);assert await page.locator('#backupTransferPanel').is_hidden();assert await page.evaluate(STATE)==original
   for attempt in range(2):
    await page.locator('#importFile').set_input_files(payload);await page.locator('#confirmImport').wait_for();await page.check('#restoreBackupSaved');await page.click('#confirmImport');await page.wait_for_function("document.querySelector('#backupTransferContent').textContent.includes('restored successfully')");await page.click('#backupTransferClose')
    v=json.loads(await page.evaluate(STATE));assert len(v['stories'])==8 and len(v['messages'])==1757
   await page.reload();await page.locator('.milestone-toast').wait_for(state='attached');assert len(json.loads(await page.evaluate(STATE))['messages'])==1757
   # Real transaction abort must retain all original records.
   before=await page.evaluate(STATE)
   await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),m=await import('./src/migration/import-service.js'),b=await import('./src/backup/vesper-backup.js');const db=await s.openVesperDb(),v=await s.loadVault(db),prepared=m.prepareImport(JSON.parse(b.serializePortableBackup(v))),native=db.transaction.bind(db);db.transaction=(...args)=>{const tx=native(...args);if(args[1]==='readwrite'){const store=tx.objectStore('vault'),put=store.put.bind(store);store.put=(...values)=>{const request=put(...values);if(values[1]==='active')queueMicrotask(()=>tx.abort());return request;};tx.objectStore=()=>store;}return tx;};try{await m.commitPreparedImport(db,prepared,{expectedRevision:v.storageRevision});throw new Error('Abort accepted');}catch(e){if(e?.message==='Abort accepted')throw e;}db.close();}""")
   assert await page.evaluate(STATE)==before
   # The actual restore UI must report an interrupted transaction visibly.
   await page.locator('#importFile').set_input_files(payload);await page.locator('#confirmImport').wait_for()
   await page.evaluate("""()=>{window.originalBackupPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){const request=window.originalBackupPut.call(this,value,key);if(key==='active')queueMicrotask(()=>this.transaction.abort());return request;};}""")
   await page.check('#restoreBackupSaved');await page.click('#confirmImport');await page.wait_for_function("document.querySelector('#backupTransferContent').textContent.startsWith('Import failed:')");assert await page.evaluate(STATE)==before
   await page.evaluate("()=>{IDBObjectStore.prototype.put=window.originalBackupPut;}");await page.click('#backupTransferClose')
   # Restore the verified downloaded rollback snapshot in isolated storage only.
   await page.locator('#importFile').set_input_files({'name':'rollback.json','mimeType':'application/json','buffer':rollback});await page.locator('#confirmImport').wait_for();await page.check('#restoreBackupSaved');await page.click('#confirmImport');await page.wait_for_function("document.querySelector('#backupTransferContent').textContent.includes('restored successfully')");await page.click('#backupTransferClose');restored=json.loads(await page.evaluate(STATE));[restored.pop(k,None) for k in ['exportedAt','backupSchema','secretsExcluded']];assert restored==json.loads(original)
   assert not errors,errors
   print(json.dumps({'device':device,'exportDownload':True,'shareInterfaceMock':True,'largeRestore1757':True,'repeatNoDuplicates':True,'cancelUnchanged':True,'rollback':True,'transactionAbort':True,'reload':True,'errors':errors}),flush=True)
   await ctx.close()
  await browser.close()
asyncio.run(run());server.shutdown()

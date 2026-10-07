# Run: python test/stale-save.browser.py (Python Playwright and Chromium required).
import asyncio,json,pathlib,threading,http.server,functools
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8773),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:8773/');await page.locator('.milestone-toast').wait_for(state='attached')
   result=await page.evaluate('''async()=>{
    const store=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),backup=await import('./src/backup/vesper-backup.js');
    const db=await store.openVesperDb(),other=await store.openVesperDb(),assert=(x,m)=>{if(!x)throw new Error(m);};
    const {seedDefaultGreenLines}=await import('./src/rules/preference-lines.js');const v=await store.loadVault(db);v.preferenceLines=seedDefaultGreenLines();v.personas=[{id:'p',name:'Persona'}];v.characters=[{id:'x',name:'Character'}];v.stories=[{id:'s',title:'Synthetic',personaId:'p',characterIds:['x']}];v.chats=[{id:'c',storyId:'s'}];await store.saveVaultAtomic(db,v);
    const a=await store.loadVault(db),b=await store.loadVault(other);assert(a.storageRevision===b.storageRevision,'base revisions differ');
    a.messages.push({id:'new',storyId:'s',chatId:'c',role:'user',text:'New message',ordinal:0});a.memoryEntries.push({id:'memory',storyId:'s',kind:'canon',status:'active',text:'Retained fact'});a.milestones.push({id:'milestone',storyId:'s',chatId:'c',type:'custom',status:'candidate'});a.relationships.push({id:'rel',storyId:'s',participantIds:['p','x'],stage:'friends'});a.stories[0].settings={model:'current-model'};await store.saveVaultAtomic(db,a);
    const before=JSON.stringify(await store.loadVault(db));let rejected=false,events=0;const off=store.subscribeVaultSaves(()=>events++);
    try{await store.saveVaultAtomic(other,b);}catch(e){rejected=e.code==='VESPER_VAULT_CONFLICT'&&e.refreshRequired&&e.actualRevision===a.storageRevision;}off();assert(rejected,'stale save accepted');assert(events===0,'conflict notified popup');assert(before===JSON.stringify(await store.loadVault(db)),'conflict changed persisted data');
    const fresh=await store.loadVault(other);fresh.messages.push({id:'next',storyId:'s',chatId:'c',role:'assistant',text:'Current snapshot message.',ordinal:1});await store.saveVaultAtomic(other,fresh);assert(fresh.storageRevision===a.storageRevision+1,'caller revision did not advance');backup.parseVesperBackup(backup.serializePortableBackup(await store.loadVault(db)));
    const x=await store.loadVault(db),y=await store.loadVault(other);const results=await Promise.allSettled([store.saveVaultAtomic(db,x),store.saveVaultAtomic(other,y)]);assert(results.filter(r=>r.status==='fulfilled').length===1,'concurrent writes both succeeded');assert(results.some(r=>r.status==='rejected'&&r.reason.code==='VESPER_VAULT_CONFLICT'),'missing concurrent conflict');
    window.expectedVault=JSON.stringify(await store.loadVault(db));return {staleRejected:true,unchangedOnConflict:true,currentSave:true,recordsPreserved:true,concurrentConflict:true,portableBackup:true};
   }''')
   expected=await page.evaluate('window.expectedVault');await page.reload();await page.locator('.milestone-toast').wait_for(state='attached')
   actual=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return JSON.stringify(await s.loadVault(await s.openVesperDb()));}");assert actual==expected
   await page.click('#settingsButton');await page.select_option('#intimacyPacing','slow');await page.click('#settingsClose')
   await page.click('#newStoryButton');await page.locator('#storySetupPanel').wait_for(state='visible');await page.click('#storySetupClose')
   async with page.expect_file_chooser():await page.click('#importButton')
   for nav in ['storyNavButton','memoryNavButton','milestonesNavButton','libraryNavButton']:await page.click('#'+nav)
   await page.click('#libraryNavButton')
   portable=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),b=await import('./src/backup/vesper-backup.js');return b.serializePortableBackup(await s.loadVault(await s.openVesperDb()));}")
   await page.locator('#importFile').set_input_files({'name':'synthetic-stale-restore.json','mimeType':'application/json','buffer':portable.encode()});await page.locator('#confirmImport').wait_for()
   before=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.messages.push({id:'concurrent-new',storyId:'s',chatId:'c',role:'user',text:'Newer than import preview.',ordinal:2});await s.saveVaultAtomic(db,v);return JSON.stringify(await s.loadVault(db));}")
   await page.click('#confirmImport');await page.wait_for_function("document.querySelector('#status').textContent.includes('vault changed')")
   after=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return JSON.stringify(await s.loadVault(await s.openVesperDb()));}");assert before==after
   result['staleRestoreRejectedUnchanged']=True
   assert not errors,errors;print(json.dumps({'device':device,**result,'reloadNewest':True,'ui':'passed','pageErrors':errors}),flush=True);await ctx.close()
  await browser.close()
asyncio.run(run())

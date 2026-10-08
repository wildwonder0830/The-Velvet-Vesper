# Synthetic-only browser storage; no user package or backup is served.
import asyncio,json,pathlib,threading,http.server,functools
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8797),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
state="async()=>{const s=await import('./src/storage/vault-store.js');return s.loadVault(await s.openVesperDb());}"
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:8797/');await page.locator('.milestone-toast').wait_for(state='attached')
   payload=await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.personas=[{id:'old-p',name:'Existing'}];v.characters=[{id:'old-x',name:'Existing'}];v.stories=[{id:'old-s',title:'Existing story',personaId:'old-p',characterIds:['old-x']}];v.chats=[{id:'old-c',storyId:'old-s'}];v.messages=[{id:'old-m',storyId:'old-s',chatId:'old-c',role:'user',text:'Synthetic existing message',ordinal:0}];await s.saveVaultAtomic(db,v);const n=emptyVault(),pkg={packageType:'velvet-vesper-native-story-package',packageVersion:'1.0',vesperSchemaVersion:1,importMode:'additive-only'};n.personas=[{id:'p',name:'Synthetic'}];n.characters=[{id:'x',name:'Synthetic'}];n.stories=[{id:'s',title:'Synthetic package',personaId:'p',characterIds:['x']}];n.chats=[{id:'c',storyId:'s'}];for(const [k,a] of Object.entries(n))if(Array.isArray(a))pkg[k]=a;return JSON.stringify(pkg);} """)
   await page.reload();await page.locator('.milestone-toast').wait_for(state='attached');before=await page.evaluate(state)
   file={'name':'synthetic-story-package.json','mimeType':'application/json','buffer':payload.encode()}
   await page.locator('#importFile').set_input_files(file);await page.locator('#confirmImport').wait_for();assert 'MERGE' in await page.locator('#backupTransferContent').inner_text();assert await page.evaluate(state)==before
   await page.click('#cancelImport');assert await page.evaluate(state)==before
   await page.locator('#importFile').set_input_files(file);await page.locator('#confirmImport').wait_for()
   async with page.expect_download() as d:await page.click('#downloadBackupFile')
   checkpoint=json.loads(pathlib.Path(await (await d.value).path()).read_text());assert checkpoint['stories']==before['stories']
   await page.check('#restoreBackupSaved');await page.click('#confirmImport');await page.wait_for_function("document.querySelector('#backupTransferContent').textContent.includes('added successfully')");await page.click('#backupTransferClose')
   after=await page.evaluate(state);assert len(after['stories'])==2;assert after['stories'][0]==before['stories'][0];assert after['messages']==before['messages']
   await page.reload();await page.locator('.milestone-toast').wait_for(state='attached');await page.click('#libraryNavButton');assert 'Synthetic package' in await page.locator('#storyLibrary').inner_text()
   await page.locator('#importFile').set_input_files(file);await page.locator('#confirmImport').wait_for();await page.check('#restoreBackupSaved');await page.click('#confirmImport');await page.wait_for_function("document.querySelector('#backupTransferContent').textContent.startsWith('Import failed:')");assert await page.evaluate(state)==after
   assert not errors,errors;print(json.dumps({'device':device,'additivePreview':True,'cancelUnchanged':True,'rollbackDownload':True,'existingRecordsPreserved':True,'menuAndReload':True,'duplicatesRejected':True,'realIndexedDB':True,'errors':errors}),flush=True);await ctx.close()
  await browser.close()
asyncio.run(run());server.shutdown()

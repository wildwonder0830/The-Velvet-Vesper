# Synthetic archival recovery only; no uploaded/user data and no provider requests.
import asyncio,functools,http.server,json,pathlib,threading
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8784),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];calls=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   async def reject(route):calls.append(route.request.url);await route.abort()
   await ctx.route('https://openrouter.ai/**',reject)
   await page.goto('http://127.0.0.1:8784/');await page.locator('.milestone-toast').wait_for(state='attached')
   await page.evaluate("""async()=>{const {phoneFixture}=await import('./test/fixtures/story-phone-formats.js'),st=await import('./src/storage/vault-store.js');const v=phoneFixture(['Amanda’s phone buzzed.\\n\\nMARIBEL: The gate is open.\\n\\nMARIBEL: A second update.']);const db=await st.openVesperDb(),base=await st.loadVault(db);await st.saveVaultAtomic(db,v,{expectedRevision:base.storageRevision});localStorage.setItem('vesper.ui.lastTab','story');localStorage.setItem('vesper.ui.lastStoryId','s');}""")
   await page.reload();await page.locator('#storyPhoneButton').wait_for();await page.wait_for_timeout(550)
   snapshot="async()=>{const st=await import('./src/storage/vault-store.js');return st.loadVault(await st.openVesperDb());}"
   before=await page.evaluate(snapshot);await page.click('#storyPhoneButton');await page.click('#phoneSync');assert await page.evaluate(snapshot)==before
   await page.locator('[data-history-resolve]').first.click();await page.select_option('[data-history-identity="Amanda"]','p');await page.select_option('[data-history-identity="MARIBEL"]','__new__');await page.fill('[data-history-contact-name="MARIBEL"]','Maribel');await page.check('#phoneHistoryEvidenceConfirm');await page.check('#phoneHistoryApplyCompatible');await page.click('#phoneHistoryResolveSave')
   assert await page.evaluate(snapshot)==before
   await page.click('#phoneHistoryConfirm');await page.locator('#phoneHistoryPreview').wait_for(state='hidden');after=await page.evaluate(snapshot)
   assert len(after['stories'][0]['phone']['historicalContacts'])==1
   assert after['stories'][0]['phone']['threads'][0]['participantIds']==['d','l','r']
   archive=next(t for t in after['stories'][0]['phone']['threads'] if t.get('historicalOnly'));assert [m['text'] for m in archive['messages']]==['The gate is open.','A second update.']
   await page.locator('[data-phone-thread]').last.click();assert await page.locator('#phoneSend').count()==0;assert await page.locator('#phoneContinue').count()==0
   await page.click('#phoneSync');assert '2 already recovered' in await page.locator('#phoneHistoryPreview').inner_text();await page.click('#phoneHistoryCancel');await page.click('#phoneClose');await page.reload();await page.locator('#storyPhoneButton').wait_for()
   persisted=await page.evaluate(snapshot);assert persisted['stories'][0]['phone']==after['stories'][0]['phone']
   await page.evaluate("""async()=>{const st=await import('./src/storage/vault-store.js'),b=await import('./src/backup/vesper-backup.js'),v=await st.loadVault(await st.openVesperDb());b.parseVesperBackup(b.serializePortableBackup(v));}""")
   assert not calls,calls;assert not errors,errors
   print(json.dumps({'device':device,'readOnlyPreview':True,'explicitNPCResolutionAndConfirmation':True,'noCastExpansion':True,'archiveNoGeneration':True,'repeatSyncAndReload':True,'realIndexedDB':True,'backupValidation':True,'errors':errors}),flush=True)
   await ctx.close()
  await browser.close()
try:asyncio.run(run())
finally:server.shutdown()

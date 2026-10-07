# Run: python test/milestone-popup.browser.py (Python Playwright and Chromium required).
import asyncio,json,pathlib,threading,http.server,functools
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8771),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)));threading.Thread(target=server.serve_forever,daemon=True).start()
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:8771/');await page.locator('.milestone-toast').wait_for(state='attached')
   await page.evaluate('''async()=>{const s=await import('./src/storage/vault-store.js');const {emptyVault}=await import('./src/schema.js');window.testStore=s;window.testDb=await s.openVesperDb();const v=emptyVault();v.personas=[{id:'p',name:'Persona'}];v.characters=[{id:'x',name:'Character'}];v.stories=[{id:'s',title:'Synthetic',personaId:'p',characterIds:['x'],primaryCharacterId:'x'},{id:'other',title:'Other',personaId:'p',characterIds:['x'],primaryCharacterId:'x'}];v.chats=[{id:'c',storyId:'s'},{id:'d',storyId:'s'},{id:'o',storyId:'other'}];window.testVault=v;await s.replaceVaultAtomic(window.testDb,v);}''')
   await page.reload();await page.locator('.milestone-toast').wait_for(state='attached')
   await page.evaluate('''async()=>{window.testStore=await import('./src/storage/vault-store.js');window.testDb=await testStore.openVesperDb();window.testVault=await testStore.loadVault(testDb);const {confirmMilestone}=await import('./src/milestones/verifier.js');window.makeMilestone=(key,title)=>confirmMilestone({key,title},{storyId:'s',chatId:'c',participants:['p','x'],evidence:key==='first_kiss'?'They kissed.':'They had a date.',vault:testVault,verification:{verified:true,completed:true,verifiedBy:'user'}});testVault.milestones=[{...makeMilestone('first_kiss','First kiss'),status:'candidate'}];await testStore.saveVaultAtomic(testDb,testVault);}''')
   toast=page.locator('.milestone-toast');assert not await toast.is_visible()
   await page.evaluate("async()=>{testVault.milestones[0].status='confirmed';testVault.milestones.push(makeMilestone('first_date','First date'));await testStore.saveVaultAtomic(testDb,testVault);}")
   await toast.wait_for(state='visible');assert await toast.locator('p').inner_text()=='First kiss'
   for nav in ['memoryNavButton','milestonesNavButton','libraryNavButton']:
    await page.click('#'+nav);assert await toast.is_visible()
   await page.click('#storyNavButton');await page.select_option('#storyPicker','other');assert await toast.is_visible();await page.select_option('#storyPicker','s');assert await toast.is_visible()
   await page.click('#settingsButton');assert await page.locator('#settingsPanel').is_visible()
   box=await toast.bounding_box();vp=page.viewport_size;assert box['x']>=0 and box['x']+box['width']<=vp['width']+1
   await page.screenshot(path=str(pathlib.Path('/tmp') / ('vesper-popup-'+device.replace(' ','_')+'.png')))
   await toast.locator('button').click();assert await toast.locator('p').inner_text()=='First date';await toast.locator('button').click();assert not await toast.is_visible()
   await page.click('#settingsClose');await page.click('#libraryNavButton');await page.click('#newStoryButton');await page.locator('#storySetupPanel').wait_for(state='visible');await page.click('#storySetupClose')
   await page.evaluate('''async()=>{testVault.milestones.push({...testVault.milestones[0],id:'duplicate'});await testStore.saveVaultAtomic(testDb,testVault);}''');assert not await toast.is_visible()
   await page.reload();await page.locator('.milestone-toast').wait_for(state='attached');assert not await toast.is_visible()
   # Real synthetic backup restore through the existing UI; no historical replay.
   data=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return await s.loadVault(await s.openVesperDb());}")
   historical=dict(data['milestones'][0]);historical.update(id='restored-history',type='celebration',title='Historical celebration',evidence='They celebrated.');data['milestones'].append(historical)
   await page.click('#libraryNavButton');await page.locator('#importFile').set_input_files({'name':'synthetic-history.json','mimeType':'application/json','buffer':json.dumps(data).encode()});await page.locator('#confirmImport').wait_for();await page.click('#confirmImport');await page.locator('#importPreview').wait_for(state='hidden');assert not await toast.is_visible()
   assert not errors,errors
   print(json.dumps({'device':device,'canonicalSaveToPopup':True,'provisionalSuppressed':True,'queueAndDismissAboveModal':True,'navigationSurvival':True,'duplicateReloadRestoreSuppressed':True,'pageErrors':errors}),flush=True)
   await ctx.close()
  await browser.close()
asyncio.run(run())

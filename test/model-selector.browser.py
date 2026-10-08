# Synthetic-only Settings/provider and real IndexedDB coverage.
import asyncio,ast,functools,http.server,json,pathlib,threading
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
# Reuse the existing synthetic fixture without executing its runner.
source=ast.parse((root/'test/intimacy-style.browser.py').read_text())
seed=next(ast.literal_eval(n.value) for n in source.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='seed' for t in n.targets)).replace("model:'synthetic',temperature:0","model:'synthetic/'+id,temperature:0")
server=http.server.ThreadingHTTPServer(('127.0.0.1',8779),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)));threading.Thread(target=server.serve_forever,daemon=True).start()
async def state(page):return await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return await s.loadVault(await s.openVesperDb());}")
def data(v):
 v=json.loads(json.dumps(v));v.pop('updatedAt',None);v.pop('storageRevision',None)
 for s in v['stories']:s.get('settings',{}).pop('model',None)
 return v
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None);ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:8779/');await page.locator('.milestone-toast').wait_for(state='attached');await page.evaluate(seed);await page.reload();await page.locator('.milestone-toast').wait_for(state='attached')
   baseline=await state(page);await page.click('#settingsButton');await page.locator('#modelSelector').wait_for(timeout=3000);assert await page.input_value('#modelName')=='synthetic/a';assert await state(page)==baseline
   curated=[('Nemotron 3 Ultra Free','nvidia/nemotron-3-ultra-550b-a55b:free'),('Nemotron 3 Ultra Paid','nvidia/nemotron-3-ultra-550b-a55b'),('GLM 5.3 FlashX','z-ai/glm-5.3-flashx'),('Kimi K2 0905','moonshotai/kimi-k2-0905'),('Cydonia 24B V4.1','thedrummer/cydonia-24b-v4.1'),('Aion 3.0','aion-labs/aion-3.0'),('MiniMax M2.5','minimax/minimax-m2.5')]
   assert await page.locator('#modelSelector option').evaluate_all('(options)=>options.map(o=>[o.textContent,o.value])')==[list(entry) for entry in curated]+[['Custom model ID','']]
   storage=await page.evaluate('JSON.stringify({...localStorage})');invalid_requests=[]
   async def reject_invalid(r):invalid_requests.append(r.request.url);await r.abort()
   await ctx.route('https://openrouter.ai/**',reject_invalid)
   for invalid in ['', 'missing-provider','synthetic/bad id','https://example/model']:
    await page.fill('#modelName',invalid);await page.click('#saveSettings');assert await page.locator('#settingsPanel').is_visible();assert await page.locator('#modelSelectionError').is_visible();assert await state(page)==baseline;assert await page.evaluate('JSON.stringify({...localStorage})')==storage
    await page.click('#testConnectionButton');await page.wait_for_function("!document.getElementById('connectionTestStatus').textContent.includes('Testing')");assert 'model ID' in await page.locator('#connectionTestStatus').inner_text();assert not invalid_requests
   await ctx.unroute('https://openrouter.ai/**',reject_invalid)
   accepted='synthetic/Exact-ID.v2:free';await page.fill('#modelName',accepted);await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden');v=await state(page);assert v['stories'][0]['settings']['model']==accepted;assert data(v)==data(baseline);assert await page.evaluate('JSON.stringify({...localStorage})')==storage
   # Verify every real curated ID using synthetic stories and mocked provider responses.
   for name,model_id in curated:
    await page.click('#settingsButton');await page.select_option('#modelSelector',model_id);assert await page.input_value('#modelName')==model_id;await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden');v=await state(page);assert v['stories'][0]['settings']['model']==model_id;assert data(v)==data(baseline)
    assert await page.evaluate('''async expected=>{const s=await import('./src/storage/vault-store.js'),{runTurn}=await import('./src/chat/turn-engine.js'),v=await s.loadVault(await s.openVesperDb()),old=fetch,bodies=[];globalThis.fetch=async(_u,o)=>{bodies.push(JSON.parse(o.body));return {ok:true,json:async()=>({choices:[{message:{content:bodies.length===1?'Amanda decided to leave.':'The evening settled quietly.'}}]})};};try{await runTurn({vault:v,storyId:'a',chatId:'chat-a',model:v.stories[0].settings.model});return bodies.length===2&&bodies.every(b=>b.model===expected);}finally{globalThis.fetch=old;}}''',model_id)
   await page.click('#settingsButton');await page.select_option('#modelSelector','');await page.fill('#modelName',accepted);await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden')
   await page.click('#storyNavButton');await page.select_option('#storyPicker','b');await page.click('#settingsButton');assert await page.input_value('#modelName')=='synthetic/b'
   # Simulate future user-supplied curated entries through the same dropdown handler.
   await page.evaluate("document.getElementById('modelSelector').add(new Option('Synthetic curated fixture','synthetic/Curated-ID'))");await page.select_option('#modelSelector','synthetic/Curated-ID');assert await page.input_value('#modelName')=='synthetic/Curated-ID';assert not await page.locator('#customModelRow').is_visible();await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden');assert data(await state(page))==data(baseline)
   for story,expected in [('a',accepted),('b','synthetic/Curated-ID'),('a',accepted)]:
    await page.select_option('#storyPicker',story);await page.click('#settingsButton');assert await page.input_value('#modelName')==expected;await page.locator('#modelSelector').scroll_into_view_if_needed();box=await page.locator('#modelSelector').bounding_box();vp=page.viewport_size;assert box['height']>=44 and box['x']>=0 and box['x']+box['width']<=vp['width']+1;await page.screenshot(path='/tmp/model-selector-'+device.replace(' ','_')+'.png');await page.click('#settingsClose')
   await page.reload();await page.locator('.milestone-toast').wait_for(state='attached');await page.click('#settingsButton');assert await page.input_value('#modelName')==accepted;await page.click('#settingsClose')
   # Exercise actual UI generation; intercept every provider request with synthetic replies.
   bodies=[];repair_seen=asyncio.Event()
   async def provider(r):
    body=r.request.post_data_json;bodies.append(body);
    if len(bodies)>=2:repair_seen.set()
    await r.fulfill(json={'choices':[{'message':{'content':'Amanda decided to leave.' if len(bodies)==1 else 'The evening settled quietly.'}}]})
   await ctx.route('https://openrouter.ai/**',provider);await page.fill('#messageInput','Synthetic neutral input.');await page.locator('#sendButton').evaluate("el=>el.scrollIntoView({block:'center'})");await page.click('#sendButton');await asyncio.wait_for(repair_seen.wait(),timeout=15);await page.wait_for_function("document.getElementById('sendButton').disabled===false");assert len(bodies)>=2 and all(b['model']==accepted for b in bodies)
   backup=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),b=await import('./src/backup/vesper-backup.js');return b.serializePortableBackup(await s.loadVault(await s.openVesperDb()));}");await page.click('#libraryNavButton');await page.locator('#importFile').set_input_files({'name':'synthetic-models.json','mimeType':'application/json','buffer':backup.encode()});await page.locator('#confirmImport').wait_for();await page.click('#confirmImport');await page.locator('#importPreview').wait_for(state='hidden');await page.reload();await page.locator('.milestone-toast').wait_for(state='attached');v=await state(page);assert v['stories'][0]['settings']['model']==accepted and v['stories'][1]['settings']['model']=='synthetic/Curated-ID';assert 'settings' not in v['stories'][2]
   # Grandfather an existing out-of-registry ID without rewriting on open or unchanged save.
   await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.stories[0].settings.model='Legacy opaque identifier';await s.saveVaultAtomic(db,v);}");await page.reload();await page.locator('.milestone-toast').wait_for(state='attached');await page.click('#storyNavButton');await page.select_option('#storyPicker','a');await page.click('#settingsButton');assert await page.input_value('#modelName')=='Legacy opaque identifier';await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden');assert (await state(page))['stories'][0]['settings']['model']=='Legacy opaque identifier'
   assert not errors,errors;print(json.dumps({'device':device,'invalidUnchanged':True,'customAndCurated':True,'sevenExactCuratedIDs':True,'exactUIProviderAndRepair':True,'independentStories':True,'unchangedUnrelatedData':True,'reloadRestore':True,'existingLegacyPreserved':True,'realIndexedDB':True,'pageErrors':errors}),flush=True);await ctx.close()
  await browser.close()
asyncio.run(run())

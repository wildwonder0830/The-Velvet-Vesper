# Run: python test/regeneration-dependencies.browser.py (Python Playwright and Chromium required).
import asyncio,json,pathlib,threading,http.server,functools
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8774),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
seed='''async()=>{const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),{seedDefaultGreenLines}=await import('./src/rules/preference-lines.js');const v=emptyVault();v.preferenceLines=seedDefaultGreenLines();v.personas=[{id:'p',name:'Persona'}];v.characters=[{id:'x',name:'Character'}];v.stories=[{id:'s',title:'Synthetic regeneration',personaId:'p',characterIds:['x']},{id:'other-story',title:'Other',personaId:'p',characterIds:['x']}];v.chats=[{id:'a',storyId:'s'},{id:'b',storyId:'s'},{id:'other-chat',storyId:'other-story'}];v.messages=[{id:'keep',storyId:'s',chatId:'a',role:'user',ordinal:0,text:'They kissed. SURVIVING_CANON.'},{id:'old',storyId:'s',chatId:'a',role:'assistant',ordinal:1,text:'DISCARDED_BRANCH'},{id:'later',storyId:'s',chatId:'a',role:'user',ordinal:2,text:'LATER_BRANCH'},{id:'other',storyId:'s',chatId:'b',role:'user',ordinal:0,text:'Other chat.'},{id:'other-story-message',storyId:'other-story',chatId:'other-chat',role:'user',ordinal:0,text:'Other story.'}];v.memoryEntries=[{id:'bad',storyId:'s',kind:'canon',text:'OBSOLETE_MEMORY',sourceMessageIds:['old']},{id:'good',storyId:'s',kind:'canon',text:'SURVIVING_CANON',sourceMessageIds:['keep']},{id:'summary',storyId:'s',chatId:'a',kind:'summary',text:'OBSOLETE_SUMMARY',sourceMessageIds:['keep','old']},{id:'derived',storyId:'s',kind:'canon',text:'OBSOLETE_DERIVED',sourceMemoryIds:['bad']},{id:'other-memory',storyId:'other-story',kind:'canon',text:'Other story canon.',sourceMessageIds:['other-story-message']}];v.milestones=[{id:'bad-ms',storyId:'s',chatId:'a',type:'custom',participants:['p'],status:'confirmed',evidence:'DISCARDED_BRANCH',sourceMessageId:'old',verification:{verified:true,completed:true,verifiedBy:'user'}},{id:'shared-ms',storyId:'s',chatId:'a',type:'first_kiss',participants:['p','x'],status:'confirmed',evidence:'They kissed.',sourceMessageId:'keep',verification:{verified:true,completed:true,verifiedBy:'user'}}];v.relationships=[{id:'r',storyId:'s',participantIds:['p','x'],stage:'friends',establishedFacts:[{id:'bad-fact',text:'OBSOLETE_RELATIONSHIP',sourceMessageId:'old'},{id:'good-fact',text:'Independent relationship fact.'}]}];v.sceneStates=[{id:'bad-scene',storyId:'s',chatId:'a',location:'OBSOLETE_SCENE',sourceMessageId:'old'},{id:'other-scene',storyId:'s',chatId:'b',location:'Other location.'}];v.knowledgeEntries=[{id:'bad-knowledge',storyId:'s',knowerId:'x',factKey:'obsolete',value:'OBSOLETE_KNOWLEDGE',sourceMessageId:'old'}];v.statEvents=[{id:'bad-stat',storyId:'s',relationshipId:'r',statKey:'trust',delta:1,sourceMessageId:'old'}];await s.replaceVaultAtomic(await s.openVesperDb(),v);localStorage.setItem('vesper.secret.openrouter-api-key','synthetic-key');}'''
async def snapshot(page):return await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return JSON.stringify(await s.loadVault(await s.openVesperDb()));}")
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   for mode in ['success','failure','write-failure','conflict']:
    opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
    ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];payloads=[];newest=None
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda dialog:dialog.accept())
    async def provider(route):
     nonlocal newest
     payloads.append(route.request.post_data)
     if mode=='conflict' and len(payloads)==1:
      newest=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.messages.push({id:'newest',storyId:'other-story',chatId:'other-chat',role:'user',ordinal:1,text:'Newer concurrent save.'});await s.saveVaultAtomic(db,v);return JSON.stringify(await s.loadVault(db));}")
     if mode=='failure':await route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'message':'Synthetic provider failure'}}));return
     if mode=='write-failure' and len(payloads)==2:
      await page.evaluate("()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){const r=original.call(this,value,key);if(this.name==='vault'&&key==='active'){IDBObjectStore.prototype.put=original;const tx=this.transaction;r.addEventListener('success',()=>tx.abort());}return r;};}")
     text='Amanda decided to leave.'  if len(payloads)==1 else 'The evening settled quietly.'
     await route.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'message':{'content':text}}],'usage':{'prompt_tokens':10,'completion_tokens':5}}))
    await ctx.route('https://openrouter.ai/**',provider)
    await page.goto('http://127.0.0.1:8774/');await page.locator('.milestone-toast').wait_for(state='attached');await page.evaluate(seed);await page.reload();await page.locator('.milestone-toast').wait_for(state='attached');await page.click('#storyNavButton')
    before=await snapshot(page);revision=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return (await s.loadVault(await s.openVesperDb())).storageRevision;}")
    await page.get_by_role('button',name='Regenerate',exact=True).click()
    expected='Reply regenerated.' if mode=='success' else 'Original messages kept.' if mode=='write-failure' else 'Regeneration failed:' if mode=='failure' else 'Regeneration was not saved.'
    await page.wait_for_function('(value)=>document.querySelector("#status").textContent.includes(value)',arg=expected)
    assert payloads
    for body in payloads:
     assert not any(marker in body for marker in ['DISCARDED_BRANCH','LATER_BRANCH','OBSOLETE_']),body
     assert 'SURVIVING_CANON' in body
    if mode!='failure':assert len(payloads)==2
    after=await snapshot(page)
    if mode in ['failure','write-failure']:
     assert after==before;assert await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return (await s.loadVault(await s.openVesperDb())).storageRevision;}")==revision
    elif mode=='conflict':assert after==newest
    else:
     data=json.loads(after);assert not any(m['id'] in ['old','later'] for m in data['messages']);assert {m['id'] for m in data['memoryEntries']}=={'good','other-memory'};assert [m['id'] for m in data['milestones']]==['shared-ms'];assert data['relationships'][0]['establishedFacts'][0]['id']=='good-fact';assert data['knowledgeEntries']==[];assert data['statEvents']==[];assert [s['id'] for s in data['sceneStates']]==['other-scene']
     prior=json.loads(before)
     for key in ['stories','chats','personas','characters']:assert prior[key]==data[key]
     for chat in ['b','other-chat']:assert [m for m in prior['messages'] if m['chatId']==chat]==[m for m in data['messages'] if m['chatId']==chat]
     portable=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),b=await import('./src/backup/vesper-backup.js'),i=await import('./src/migration/import-service.js');const text=b.serializePortableBackup(await s.loadVault(await s.openVesperDb()));i.prepareImport(b.parseVesperBackup(text));return text;}")
     await page.reload();await page.locator('.milestone-toast').wait_for(state='attached');assert await snapshot(page)==after
     await page.click('#libraryNavButton');await page.locator('#importFile').set_input_files({'name':'synthetic-regenerated.json','mimeType':'application/json','buffer':portable.encode()});await page.locator('#confirmImport').wait_for();await page.click('#confirmImport');await page.locator('#importPreview').wait_for(state='hidden');assert not await page.locator('.milestone-toast').is_visible()
     restored=json.loads(await snapshot(page));assert restored['messages']==data['messages'];assert restored['memoryEntries']==data['memoryEntries']
    assert not errors,errors
    print(json.dumps({'device':device,'mode':mode,'providerRequests':len(payloads),'discardedContentExcluded':True,'repairPayloadClean':mode!='failure','originalOrNewestPreserved':mode!='success','exportReloadRestore':mode=='success','pageErrors':errors}),flush=True)
    await ctx.close()
  await browser.close()
asyncio.run(run())

# Synthetic-only phone UI, provider and real IndexedDB verification.
import asyncio,functools,http.server,json,pathlib,threading
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8782),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
seed="""async()=>{const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),{seedDefaultGreenLines}=await import('./src/rules/preference-lines.js'),v=emptyVault();v.preferenceLines=seedDefaultGreenLines();v.personas=[{id:'p',name:'Amanda'}];v.characters=['a','b','d'].map(id=>({id,name:'Character '+id,profile:{voice:id}}));v.stories=['s','other'].map(id=>({id,title:'Synthetic '+id,personaId:'p',characterIds:['a','b','d'],settings:{model:'synthetic/Exact:free',temperature:.7,maxTokens:900}}));v.chats=[{id:'c',storyId:'s'},{id:'c2',storyId:'s'},{id:'oc',storyId:'other'}];v.messages=Array.from({length:12},(_,i)=>({id:'m'+i,storyId:'s',chatId:'c',role:i%2?'assistant':'user',ordinal:i,text:Array.from({length:10},(_,n)=>'Neutral paragraph '+n+'. The garden gate stood quietly.').join('\\n\\n')}));await s.replaceVaultAtomic(await s.openVesperDb(),v);localStorage.setItem('vesper.secret.openrouter-api-key','synthetic-key');localStorage.setItem('vesper.ui.lastTab','story');localStorage.setItem('vesper.ui.lastStoryId','s');}"""
async def state(page):return await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return s.loadVault(await s.openVesperDb());}")
def unrelated(v):
 v=json.loads(json.dumps(v));v.pop('updatedAt',None);v.pop('usageEntries',None)
 for s in v['stories']:s.pop('phone',None)
 return v
async def lifecycle(page,ctx):
 async def fresh():
  await page.evaluate(seed);await page.reload();await page.locator('#storyPhoneButton').wait_for();await page.click('#storyPhoneButton');await page.locator('#storyPhoneOverlay').wait_for(state='visible');await page.click('[data-phone-thread]');await page.locator('#phoneMessageInput').wait_for()
 await ctx.unroute('https://openrouter.ai/**')
 mode={'value':'failure'};arrived=asyncio.Event();release=asyncio.Event();requests=[]
 async def provider(route):
  requests.append(route.request.post_data_json);arrived.set()
  if mode['value']=='failure':await route.fulfill(status=503,json={'error':{'message':'Synthetic provider failure'}});return
  await release.wait()
  text='Synthetic abort reply.' if mode['value']=='abort' else 'Synthetic lifecycle reply.'
  await route.fulfill(json={'choices':[{'message':{'content':json.dumps([{'speakerId':'a','text':text}])}}]})
 await ctx.route('https://openrouter.ai/**',provider)
 await fresh();before=await state(page);await page.fill('#phoneMessageInput','Failed send remains saved');await page.click('#phoneSend');await page.wait_for_function("document.getElementById('phoneNotice').textContent.includes('Synthetic provider failure')")
 failed=await state(page);assert failed['messages']==before['messages'];assert len(failed['usageEntries'])==1;assert len(failed['stories'][0]['phone']['threads'][0]['messages'])==1;assert len(requests)==1
 # Response after closing/switching keeps origin and becomes unread; omitted usage still counts once.
 await page.click('#phoneClose');mode['value']='hold';arrived.clear();release.clear();await fresh();await page.fill('#phoneMessageInput','Delayed origin');await page.click('#phoneSend');await asyncio.wait_for(arrived.wait(),10);await page.click('#phoneClose');await page.select_option('#storyPicker','other');release.set()
 await page.wait_for_function("document.getElementById('queryCount').textContent.startsWith('1 /')")
 for _ in range(100):
  saved=await state(page)
  if len(saved['stories'][0]['phone']['threads'][0]['messages'])==2:break
  await page.wait_for_timeout(20)
 assert saved['messages']==before['messages'];assert len(saved['usageEntries'])==1;assert 'phone' not in saved['stories'][1];assert saved['stories'][0]['phone']['threads'][0]['readThroughOrdinal']==0
 await page.select_option('#storyPicker','s');assert await page.locator('#storyPhoneButton .phone-badge').is_visible();await page.click('#storyPhoneButton');await page.locator('#storyPhoneOverlay').wait_for(state='visible');await page.click('#phoneChats');await page.click('[data-phone-thread]');await page.wait_for_function("document.querySelector('#storyPhoneButton .phone-badge').hidden")
 # Concurrent newer save must survive completion unchanged.
 await page.click('#phoneClose');arrived.clear();release.clear();await fresh();await page.fill('#phoneMessageInput','Conflict send');await page.click('#phoneSend');await asyncio.wait_for(arrived.wait(),10)
 await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.messages.push({id:'newer',storyId:'s',chatId:'c',role:'user',text:'Newest saved data',ordinal:99});await s.saveVaultAtomic(db,v);}")
 newest=await state(page);release.set();await page.wait_for_function("document.getElementById('phoneNotice').textContent.includes('Reload')");assert await state(page)==newest
 # Real IDB transaction abort during response commit leaves reserved user branch intact.
 await page.click('#phoneClose');mode['value']='abort';arrived.clear();release.clear();await fresh()
 await page.evaluate("()=>{const original=IDBObjectStore.prototype.put;window.phoneOriginalPut=original;IDBObjectStore.prototype.put=function(value,key){const r=original.call(this,value,key);if(key==='active'&&value.stories?.some(s=>s.phone?.threads.some(t=>t.messages.some(m=>m.text==='Synthetic abort reply.')))){window.phoneFaultSeen=true;queueMicrotask(()=>this.transaction.abort());}return r;};}")
 await page.fill('#phoneMessageInput','Abort send');await page.click('#phoneSend');await asyncio.wait_for(arrived.wait(),10);reserved=await state(page);release.set();await page.wait_for_function("!document.getElementById('phoneNotice').hidden && document.getElementById('phoneNotice').textContent!=='Vesper is replying…'");assert await state(page)==reserved
 await page.evaluate('()=>{IDBObjectStore.prototype.put=window.phoneOriginalPut;}');await page.click('#phoneClose')
 # Initialization failure cannot write partial phone state and is visible outside the closed overlay.
 await page.evaluate(seed);await page.reload();await page.locator('#storyPhoneButton').wait_for();initial=await state(page)
 await page.evaluate("()=>{const original=IDBObjectStore.prototype.put;window.phoneOriginalPut=original;IDBObjectStore.prototype.put=function(value,key){const r=original.call(this,value,key);if(key==='active'&&value.stories?.some(s=>s.phone))queueMicrotask(()=>this.transaction.abort());return r;};}")
 await page.click('#storyPhoneButton');await page.wait_for_function("document.getElementById('status').textContent.startsWith('Phone:')");assert await state(page)==initial;assert not await page.locator('#storyPhoneOverlay').is_visible()
 await page.evaluate('()=>{IDBObjectStore.prototype.put=window.phoneOriginalPut;}')
 # Stale initialization and pre-dispatch reservation both reject before any provider call.
 requests_before=len(requests)
 await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.messages.push({id:'concurrent-init',storyId:'s',chatId:'c',role:'user',text:'Concurrent initialization data',ordinal:98});await s.saveVaultAtomic(db,v);}")
 newest=await state(page);await page.click('#storyPhoneButton');await page.wait_for_function("document.getElementById('status').textContent.includes('Reload')");assert await state(page)==newest;assert len(requests)==requests_before
 await page.reload();await page.locator('#storyPhoneButton').wait_for();await page.click('#storyPhoneButton');await page.locator('#storyPhoneOverlay').wait_for(state='visible');await page.click('[data-phone-thread]');await page.locator('#phoneMessageInput').wait_for()
 await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.messages.push({id:'concurrent-reservation',storyId:'s',chatId:'c',role:'user',text:'Concurrent reservation data',ordinal:99});await s.saveVaultAtomic(db,v);}")
 newest=await state(page);await page.fill('#phoneMessageInput','Rejected stale draft');await page.click('#phoneSend');await page.wait_for_function("document.getElementById('phoneNotice').textContent.includes('Reload')");assert await state(page)==newest;assert len(requests)==requests_before;assert await page.input_value('#phoneMessageInput')=='Rejected stale draft';await page.click('#phoneClose')
 return {'failurePreservesUserBranch':True,'explicitQueriesOnly':True,'closeSwitchUnread':True,'missingUsageCountedOnce':True,'staleCompletionUnchanged':True,'realTransactionAbortUnchanged':True,'initializationFailureSafeVisible':True,'preDispatchConflictsNoRequest':True}

async def source_story_deletion(page):
 await page.evaluate(seed)
 await page.evaluate("""async()=>{const st=await import('./src/storage/vault-store.js'),ps=await import('./src/phone/phone-state.js'),db=await st.openVesperDb();let v=await st.loadVault(db);v.personas.push({id:'op',name:'Other persona'});v.characters.push(...['oa','ob','od'].map(id=>({id,name:'Other '+id})));v.stories[1].personaId='op';v.stories[1].characterIds=['oa','ob','od'];v.memoryEntries=[{id:'phone-source-root',storyId:'s',kind:'canon',text:'Source fact'}];v=ps.ensureStoryPhone(v,'other','oc');const tid=v.stories[1].phone.threads[0].id;v=ps.appendPhoneMessage(v,'other',tid,{senderType:'character',senderId:'oa',text:'Obsolete derivative',sourceMemoryIds:['phone-source-root']});v=ps.appendPhoneMessage(v,'other',tid,{senderType:'character',senderId:'oa',text:'Independent phone history'});const current=await st.loadVault(db);await st.saveVaultAtomic(db,v,{expectedRevision:current.storageRevision});}""")
 await page.reload();await page.locator('#storyPhoneButton').wait_for();await page.click('#libraryNavButton');await page.click('button[aria-label="Delete Synthetic s"]');await page.click('#deleteStoryConfirm');await page.locator('#deleteStoryPanel').wait_for(state='hidden')
 result=await page.evaluate("""async()=>{const st=await import('./src/storage/vault-store.js'),b=await import('./src/backup/vesper-backup.js'),v=await st.loadVault(await st.openVesperDb());const texts=v.stories[0].phone.threads[0].messages.map(m=>m.text);let portable=false;try{b.parseVesperBackup(b.serializePortableBackup(v));portable=true;}catch{}return {texts,portable};}""");assert result=={'texts':['Independent phone history'],'portable':True},result

async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];bodies=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:8782/');await page.locator('.milestone-toast').wait_for(state='attached');await page.evaluate(seed);await page.reload();await page.locator('.message').last.wait_for();await page.wait_for_timeout(550)
   baseline=await state(page);assert all('phone' not in s for s in baseline['stories'])
   async def provider(route):
    bodies.append(route.request.post_data_json)
    await route.fulfill(json={'choices':[{'message':{'content':'[{"speakerId":"a","text":"Synthetic phone reply."},{"speakerId":"b","text":"Another neutral reply."}]'}}],'usage':{'prompt_tokens':21,'completion_tokens':7}})
   await ctx.route('https://openrouter.ai/**',provider)
   await page.evaluate("()=>{if(matchMedia('(max-width:799px), (hover:none) and (pointer:coarse)').matches)scrollBy(0,-300);else document.getElementById('messages').scrollTop-=300;}")
   position=await page.evaluate("[scrollY,document.getElementById('messages').scrollTop]")
   await page.click('#storyPhoneButton');await page.locator('#storyPhoneOverlay').wait_for(state='visible');assert len(bodies)==0
   assert await page.locator('[data-phone-thread]').count()==1
   await page.click('#phoneClose');await page.wait_for_timeout(80);after=await page.evaluate("[scrollY,document.getElementById('messages').scrollTop]");assert all(abs(a-b)<2 for a,b in zip(position,after)),(position,after)
   await page.click('#storyPhoneButton');await page.click('[data-phone-thread]');await page.fill('#phoneMessageInput','Draft survives closing');await page.click('#phoneClose');await page.click('#storyPhoneButton');assert await page.input_value('#phoneMessageInput')=='Draft survives closing'
   await page.click('#phoneEditGroup');await page.fill('#phoneGroupTitle','Custom Story Cast');await page.uncheck('input[data-phone-member="d"]');await page.click('#phoneSaveGroup');await page.wait_for_function("document.getElementById('phoneThreadTitle')?.textContent==='Custom Story Cast'")
   await page.fill('#phoneMessageInput','Synthetic user text.');await page.click('#phoneSend');await page.wait_for_function("document.querySelectorAll('.phone-bubble.character').length===2")
   assert len(bodies)==1 and bodies[0]['model']=='synthetic/Exact:free';assert bodies[0]['temperature']==.7 and bodies[0]['max_tokens']==900
   assert await page.input_value('#phoneMessageInput')==''
   v=await state(page);assert unrelated(v)==unrelated(baseline);assert len(v['usageEntries'])==1 and v['usageEntries'][0]['totalTokens']==28;assert v['stories'][0]['phone']['threads'][0]['messages'][0]['audienceIds']==['p','a','b']
   await page.click('#phoneEditGroup');await page.check('input[data-phone-member="d"]');await page.click('#phoneSaveGroup');await page.wait_for_function("document.getElementById('phoneMessageInput')!==null");await page.fill('#phoneMessageInput','Draft during continuation');await page.click('#phoneContinue');await page.wait_for_function("document.querySelectorAll('.phone-bubble.character').length===4")
   assert await page.input_value('#phoneMessageInput')=='Draft during continuation';assert len(bodies)==2;payload=json.loads(bodies[-1]['messages'][0]['content']);assert not payload['phone']['history'],payload
   await page.click('#phoneContacts');await page.fill('input[data-phone-nickname="a"]','Contact Alias');await page.click('button[data-phone-nickname-save="a"]');await page.wait_for_function("document.querySelector('button[data-phone-contact=a]')?.textContent==='Contact Alias'");await page.click('button[data-phone-contact="a"]');assert await page.locator('#phoneThreadTitle').inner_text()=='Contact Alias';privateid=await page.locator('#phoneThreadTitle').get_attribute('data-thread-id');await page.click('#phoneContacts');await page.click('button[data-phone-contact="a"]');assert await page.locator('#phoneThreadTitle').get_attribute('data-thread-id')==privateid
   await page.fill('#phoneMessageInput','Private draft');await page.click('#phoneChats');await page.click('[data-phone-thread] >> nth=0');await page.click('#phoneClose');await page.click('#memoryNavButton');assert not await page.locator('#storyPhoneButton').is_visible();await page.click('#storyNavButton');await page.click('#storyPhoneButton');await page.click('#phoneContacts');await page.click('button[data-phone-contact="a"]');assert await page.input_value('#phoneMessageInput')=='Private draft'
   # Simulated reduced keyboard viewport, not native iOS keyboard testing.
   vp=page.viewport_size;await page.set_viewport_size({'width':vp['width'],'height':420});await page.wait_for_function("document.getElementById('storyPhoneOverlay').getBoundingClientRect().height<=420");await page.fill('#phoneMessageInput','Keyboard draft');box=await page.locator('#phoneSend').bounding_box();assert box['y']>=0 and box['y']+box['height']<=420,box;await page.set_viewport_size(vp)
   await page.click('#phoneClose');await page.select_option('#storyPicker','other');await page.click('#storyPhoneButton');await page.locator('#storyPhoneOverlay').wait_for(state='visible');assert await page.locator('[data-phone-thread]').count()==1;await page.click('#phoneClose');await page.select_option('#storyPicker','s')
   await page.reload();await page.locator('#storyPhoneButton').wait_for();await page.click('#storyPhoneButton');await page.click('#phoneContacts');assert await page.input_value('input[data-phone-nickname="a"]')=='Contact Alias';await page.click('#phoneChats');assert await page.locator('[data-phone-thread]').count()==2;await page.click('[data-phone-thread] >> nth=0');assert await page.locator('.phone-bubble.character').count()==4
   # Backup validation/restore using only synthetic data and existing atomic replacement.
   assert await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),b=await import('./src/backup/vesper-backup.js'),db=await s.openVesperDb(),v=await s.loadVault(db),backup=b.serializePortableBackup(v),restored=b.parseVesperBackup(backup);await s.replaceVaultAtomic(db,restored,{expectedRevision:v.storageRevision});return restored.stories[0].phone.threads[0].title==='Custom Story Cast';}""")
   await page.reload();await page.locator('#storyPhoneButton').wait_for();await page.click('#storyPhoneButton');await page.click('[data-phone-thread] >> nth=0');assert await page.locator('.phone-bubble.character').count()==4
   await page.screenshot(path='/tmp/story-phone-'+device.replace(' ','_')+'.png');await page.click('#phoneClose')
   # Exercise the existing import UI with valid phone data, then reject a corrupted synthetic copy.
   backup=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),b=await import('./src/backup/vesper-backup.js');return b.serializePortableBackup(await s.loadVault(await s.openVesperDb()));}")
   await page.click('#libraryNavButton');await page.locator('#importFile').set_input_files({'name':'synthetic-phone.json','mimeType':'application/json','buffer':backup.encode()});await page.locator('#confirmImport').wait_for();await page.click('#confirmImport');await page.locator('#importPreview').wait_for(state='hidden');await page.click('#storyNavButton');await page.click('#storyPhoneButton');await page.locator('#storyPhoneOverlay').wait_for(state='visible');await page.click('#phoneChats');await page.click('[data-phone-thread] >> nth=0');assert await page.locator('.phone-bubble.character').count()==4;await page.click('#phoneClose')
   await page.click('#libraryNavButton');before_rejection=await state(page);bad=json.loads(backup);bad['stories'][0]['phone']['version']=999
   await page.locator('#importFile').set_input_files({'name':'synthetic-corrupt-phone.json','mimeType':'application/json','buffer':json.dumps(bad).encode()});await page.wait_for_function("document.getElementById('importPreview').textContent.includes('Import error:')");assert await state(page)==before_rejection;assert await page.locator('#confirmImport').count()==0;await page.click('#storyNavButton')
   # Participant-aware provider/repair, real IDB conflicts and regeneration integration.
   checks=await page.evaluate("""async()=>{const st=await import('./src/storage/vault-store.js'),ps=await import('./src/phone/phone-state.js'),pc=await import('./src/phone/phone-context.js'),db=await st.openVesperDb();let v=await st.loadVault(db);const r=ps.openPrivateThread(v,'s','c','a');v=ps.appendPhoneMessage(r.vault,'s',r.threadId,{senderType:'character',senderId:'a',text:'PRIVATE_CANARY'});const filtered=pc.buildPhoneContext(v,{storyId:'s',chatId:'c',respondingCharacterIds:['b']});const other=pc.buildPhoneContext(v,{storyId:'s',chatId:'c2',respondingCharacterIds:['a']});const old=await st.loadVault(db);await st.saveVaultAtomic(db,v,{expectedRevision:old.storageRevision});let conflict=false;try{await st.saveVaultAtomic(db,old);}catch(e){conflict=e.code==='VESPER_VAULT_CONFLICT';}const {runTurn}=await import('./src/chat/turn-engine.js'),saved=fetch,bodies=[];globalThis.fetch=async(_u,o)=>{bodies.push(JSON.parse(o.body));return {ok:true,json:async()=>({choices:[{message:{content:bodies.length===1?'Amanda decided to leave.':'The garden stood quietly.'}}]})};};try{await runTurn({vault:v,storyId:'s',chatId:'c',model:'synthetic/Exact:free'});}finally{globalThis.fetch=saved;}return {privateExcluded:!filtered.some(m=>m.text.includes('PRIVATE_CANARY')),chatExcluded:!other.length,conflict,providerRepair:bodies.length===2&&bodies.every(b=>!JSON.stringify(b).includes('PRIVATE_CANARY'))};}""");assert all(checks.values()),checks
   life=await lifecycle(page,ctx);await source_story_deletion(page);assert not errors,errors;print(json.dumps({'lifecycle':life,'device':device,'realIndexedDB':True,'overlayDraftsScroll':True,'groupNamesMembersNicknames':True,'providerSettingsUsage':True,'reloadRestore':True,'participantPrivacy':checks,'pageErrors':errors}),flush=True);await ctx.close()
  await browser.close()
asyncio.run(run())

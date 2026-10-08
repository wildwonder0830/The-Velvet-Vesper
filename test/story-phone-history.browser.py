# Synthetic-only optional recovery, UI safety and real IndexedDB regressions.
import asyncio, functools, http.server, json, pathlib, threading
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8783),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
seed=r"""async()=>{
 const st=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),ps=await import('./src/phone/phone-state.js');let v=emptyVault();
 v.personas=[{id:'p',name:'Amanda'}];v.characters=[{id:'a',name:'Aedan'},{id:'b',name:'Aeron'},{id:'d',name:'Dorian'}];
 v.stories=[{id:'s',title:'Synthetic history',personaId:'p',characterIds:['a','b','d'],settings:{model:'synthetic/Exact',temperature:.6,maxTokens:800}},{id:'other',title:'Other',personaId:'p',characterIds:['a']}];v.chats=[{id:'c',storyId:'s'},{id:'c2',storyId:'s'},{id:'oc',storyId:'other'}];
 v.messages=Array.from({length:10},(_,i)=>({id:'n'+i,storyId:'s',chatId:'c',role:i%2?'assistant':'user',ordinal:i,text:Array.from({length:8},()=> 'A neutral garden paragraph for synthetic scrolling.').join('\n\n')}));
 v.messages.push({id:'history',storyId:'s',chatId:'c',role:'assistant',ordinal:10,text:'Text conversation: Amanda, Aedan\nAmanda: Exact private gate text.\nAedan: Exact private reply.\n\nGroup chat: Story Cast (Members: Amanda, Aedan, Aeron)\n[09:16] Aeron: Exact group gate text.\n\nText conversation: Amanda, Blue\nBlue: An uncertain alias text.\n\nText messages:\nAmanda: No known recipient.'});
 v=ps.ensureStoryPhone(v,'s','c');v=ps.appendPhoneMessage(v,'s',v.stories[0].phone.threads[0].id,{senderType:'character',senderId:'d',text:'Existing native phone message.'});v=ps.markPhoneThreadRead(v,'s',v.stories[0].phone.threads[0].id);
 const db=await st.openVesperDb(),base=await st.loadVault(db);await st.saveVaultAtomic(db,v,{expectedRevision:base.storageRevision});localStorage.setItem('vesper.ui.lastTab','story');localStorage.setItem('vesper.ui.lastStoryId','s');}
"""
async def state(page):return await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return s.loadVault(await s.openVesperDb());}")
def unrelated(v):
 x=json.loads(json.dumps(v));x.pop('updatedAt',None)
 for s in x['stories']:s.pop('phone',None)
 return x
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];calls=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   async def forbidden(route):calls.append(route.request.url);await route.abort()
   await ctx.route('https://openrouter.ai/**',forbidden)
   await page.goto('http://127.0.0.1:8783/');await page.locator('.milestone-toast').wait_for(state='attached');await page.evaluate(seed);await page.reload();await page.locator('#storyPhoneButton').wait_for();await page.wait_for_timeout(550)
   before=await state(page);assert not any(m.get('recovery') for t in before['stories'][0]['phone']['threads'] for m in t['messages'])
   await page.evaluate("matchMedia('(max-width:799px), (hover:none) and (pointer:coarse)').matches?window.scrollBy(0,-300):document.getElementById('messages').scrollTop-=300")
   position=await page.evaluate('[scrollY,document.getElementById("messages").scrollTop]')
   await page.click('#storyPhoneButton');await page.click('[data-phone-thread]');await page.fill('#phoneMessageInput','Draft stays during review')
   await page.click('#phoneSync');await page.locator('#phoneHistoryPreview').wait_for();assert await state(page)==before
   assert await page.evaluate("document.activeElement.id==='phoneHistoryPreview'")
   await page.keyboard.press('Tab');assert await page.evaluate("!!document.activeElement.closest('#storyPhoneOverlay')")
   await page.screenshot(path='/tmp/phone-history-preview-'+device.replace(' ','_')+'.png')
   assert await page.locator('#phoneHistoryReady [data-history-candidate]').count()==3
   assert await page.locator('#phoneHistoryUncertain [data-history-candidate]').count()==2
   await page.click('#phoneHistoryCancel');assert await page.input_value('#phoneMessageInput')=='Draft stays during review';assert await page.evaluate("document.activeElement.id==='phoneSync'");assert await state(page)==before
   await page.click('#phoneSync');await page.locator('#phoneHistoryReady input[data-history-select]').first.uncheck()
   assert await page.evaluate("!!document.activeElement.dataset.historySelect")
   alias=page.locator('#phoneHistoryUncertain [data-history-candidate]').filter(has_text='An uncertain alias text.')
   await alias.locator('input[data-history-select]').check();assert await page.locator('#phoneHistoryConfirm').is_disabled()
   await alias.locator('button[data-history-resolve]').click();assert await page.evaluate("document.activeElement.dataset.historyIdentity==='Blue'");await page.select_option('[data-history-identity="Blue"]','a');await page.check('#phoneHistoryEvidenceConfirm');await page.click('#phoneHistoryResolveSave');assert await page.evaluate("!!document.activeElement.dataset.historySelect");assert await page.locator('#phoneHistoryConfirm').is_enabled()
   await page.click('#phoneHistoryConfirm');await page.locator('#phoneHistoryPreview').wait_for(state='hidden');after=await state(page)
   recovered=[m for t in after['stories'][0]['phone']['threads'] for m in t['messages'] if m.get('recovery')]
   assert len(recovered)==3 and not any(m['text']=='Exact private gate text.' for m in recovered)
   assert unrelated(after)==unrelated(before);native=[m for t in after['stories'][0]['phone']['threads'] for m in t['messages'] if not m.get('recovery')];assert native==before['stories'][0]['phone']['threads'][0]['messages']
   assert await page.input_value('#phoneMessageInput')=='Draft stays during review'
   await page.click('#phoneSync');assert '3 already recovered' in await page.locator('#phoneHistoryPreview').inner_text();assert await page.locator('#phoneHistoryReady [data-history-candidate]').count()==1;await page.click('#phoneHistoryCancel')
   await page.click('#phoneClose');await page.wait_for_timeout(100);assert all(abs(a-b)<2 for a,b in zip(position,await page.evaluate('[scrollY,document.getElementById("messages").scrollTop]')))
   await page.reload();await page.locator('#storyPhoneButton').wait_for();await page.click('#storyPhoneButton');await page.click('#phoneSync');assert '3 already recovered' in await page.locator('#phoneHistoryPreview').inner_text()
   # Abort the real IDB transaction committing the remaining historical text.
   unchanged=await state(page)
   await page.evaluate("""()=>{window.historyOriginalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){const r=window.historyOriginalPut.call(this,value,key);if(key==='active'&&value.stories?.some(s=>s.phone?.threads.some(t=>t.messages.some(m=>m.recovery&&m.text==='Exact private gate text.'))))queueMicrotask(()=>this.transaction.abort());return r;};}""")
   await page.click('#phoneHistoryConfirm');await page.wait_for_function("document.getElementById('phoneNotice').textContent.includes('kept')");assert await state(page)==unchanged
   await page.evaluate("()=>{IDBObjectStore.prototype.put=window.historyOriginalPut;delete window.historyOriginalPut;}")
   # Concurrent synthetic save after preview: no automatic reconciliation or retry.
   await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.messages.push({id:'concurrent',storyId:'s',chatId:'c',role:'user',text:'Newest concurrent input.',ordinal:11});await s.saveVaultAtomic(db,v);}""")
   newest=await state(page);await page.click('#phoneHistoryConfirm');await page.wait_for_function("document.getElementById('phoneNotice').textContent.includes('Newer data')");assert await state(page)==newest
   await page.click('#phoneClose');await page.reload();await page.locator('#storyPhoneButton').wait_for();await page.click('#storyPhoneButton');await page.click('#phoneSync');await page.click('#phoneHistoryConfirm');await page.locator('#phoneHistoryPreview').wait_for(state='hidden');assert len([m for t in (await state(page))['stories'][0]['phone']['threads'] for m in t['messages'] if m.get('recovery')])==4
   await page.click('#phoneClose')
   portable=await page.evaluate("""async()=>{const st=await import('./src/storage/vault-store.js'),b=await import('./src/backup/vesper-backup.js'),v=await st.loadVault(await st.openVesperDb());return b.serializePortableBackup(v);}""")
   corrupt=json.loads(portable);next(m for t in corrupt['stories'][0]['phone']['threads'] for m in t['messages'] if m.get('recovery'))['recovery']['start']=-1
   await page.click('#libraryNavButton');unchanged=await state(page);await page.locator('#importFile').set_input_files({'name':'synthetic-corrupt-history.json','mimeType':'application/json','buffer':json.dumps(corrupt).encode()});await page.wait_for_function("document.querySelector('#backupTransferContent').textContent.startsWith('Import error:')");assert await page.locator('#confirmImport').count()==0;assert await state(page)==unchanged;await page.click('#backupTransferClose')
   await page.click('#libraryNavButton');await page.locator('#importFile').set_input_files({'name':'synthetic-phone-history.json','mimeType':'application/json','buffer':portable.encode()});await page.locator('#confirmImport').wait_for();await page.check('#restoreBackupSaved');await page.click('#confirmImport');await page.wait_for_function("document.querySelector('#backupTransferContent').textContent.includes('restored successfully')");await page.click('#backupTransferClose');await page.reload();await page.click('#storyNavButton');await page.select_option('#storyPicker','s');await page.locator('#storyPhoneButton').wait_for();await page.click('#storyPhoneButton');await page.click('#phoneSync');assert '4 already recovered' in await page.locator('#phoneHistoryPreview').inner_text()
   assert await page.locator('#phoneHistoryReady [data-history-candidate]').count()==0
   await page.click('#phoneHistoryCancel');await page.click('[data-phone-thread]');assert '09:16' in await page.locator('.phone-transcript').inner_text();assert 'Recovered transcript history' in await page.locator('.phone-transcript').inner_text()
   await page.click('#phoneClose');await page.select_option('#storyPicker','other');await page.click('#storyPhoneButton');await page.click('#phoneSync');assert await page.locator('[data-history-candidate]').count()==0
   assert not calls,calls;assert not errors,errors
   print(json.dumps({'device':device,'previewOptionalReadOnly':True,'excludeAndResolve':True,'exactRecipientsAndWording':True,'noPaidCalls':True,'staleConflictUnchanged':True,'realTransactionAbortUnchanged':True,'keyboardFocusRetained':True,'draftAndStoryScrollPreserved':True,'reloadAndActualImportRestore':True,'corruptRestoreRejectedUnchanged':True,'realIndexedDB':True,'pageErrors':errors}),flush=True)
   await ctx.close()
  await browser.close()
asyncio.run(run())

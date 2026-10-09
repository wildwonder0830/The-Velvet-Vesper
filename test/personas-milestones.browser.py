# Synthetic IndexedDB only. Chromium sizes are not native iOS Safari verification.
import asyncio,functools,http.server,json,pathlib,threading
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8802),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
seed="""async()=>{const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),{seedDefaultGreenLines}=await import('./src/rules/preference-lines.js'),v=emptyVault();v.preferenceLines=seedDefaultGreenLines();v.personas=[{id:'p',name:'Player',storyId:'s',profile:{species:'Human'}}];v.characters=[{id:'x',name:'Character',profile:{species:'Feline'}}];v.stories=[{id:'s',title:'Synthetic Persona Story',personaId:'p',characterIds:['x'],primaryCharacterId:'x',settings:{model:'synthetic/model'}},{id:'o',title:'Other Story',personaId:'p',characterIds:['x'],primaryCharacterId:'x'}];v.chats=[{id:'c',storyId:'s'},{id:'d',storyId:'o'}];v.messages=[{id:'old',storyId:'s',chatId:'c',role:'assistant',ordinal:0,text:'The room stood quiet.'}];await s.replaceVaultAtomic(await s.openVesperDb(),v);localStorage.setItem('vesper.ui.lastTab','story');localStorage.setItem('vesper.ui.lastStoryId','s');localStorage.setItem('vesper.secret.openrouter-api-key','synthetic-key');}"""
state="async()=>{const s=await import('./src/storage/vault-store.js');return s.loadVault(await s.openVesperDb());}"
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda dialog:dialog.accept())
   await page.goto('http://127.0.0.1:8802/');await page.locator('.milestone-toast').wait_for(state='attached');await page.evaluate(seed);await page.reload();await page.locator('#messageInput').wait_for()
   await page.evaluate("()=>{window.calls=[];window.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:'The room settled quietly.'}}]})};};}")
   await page.fill('#messageInput','Unfinished draft');await page.click('#personasButton');await page.get_by_role('button',name='Create persona',exact=True).click();await page.locator('[name=name]').fill('New Player');await page.locator('[name=species]').fill('Human');await page.locator('[name=anatomy]').fill('No tail. Human anatomy.');await page.locator('[name=hardLimits]').fill('Synthetic limit');await page.locator('[name=customFields]').fill('{"role":"Scholar"}');await page.get_by_role('button',name='Save persona',exact=True).click();await page.get_by_text('New Player',exact=True).wait_for()
   card=page.locator('.data-card').filter(has=page.get_by_text('New Player',exact=True));await card.get_by_role('button',name='Edit',exact=True).click();await page.locator('[name=folder]').fill('Synthetic folder');await page.locator('[name=appearance]').fill('Human protagonist.');await page.get_by_role('button',name='Save persona',exact=True).click();await card.get_by_role('button',name='Duplicate',exact=True).click();copy=page.locator('.data-card').filter(has=page.get_by_text('New Player copy',exact=True));await copy.get_by_role('button',name='Archive / Delete',exact=True).click();await page.get_by_text('New Player copy',exact=True).wait_for(state='detached');await card.get_by_role('button',name='Assign independent copy to this story').click();await page.wait_for_timeout(100)
   data=await page.evaluate(state);assert data['stories'][0]['personaId']=='p';selected=data['stories'][0]['personaBinding']['personaId'];profile=next(x for x in data['personas'] if x['id']==selected);assert profile['profile']['species']=='Human';assert data['stories'][1].get('personaBinding') is None;assert data['messages'][0]['text']=='The room stood quiet.'
   await page.click('#storyNavButton');assert await page.locator('#messageInput').input_value()=='Unfinished draft';await page.click('#settingsButton');assert await page.locator('#assignedPersonaName').inner_text()=='New Player';await page.click('#settingsClose')
   # Explicit Send records source-backed completion; management never made a request.
   assert await page.evaluate('calls.length')==0
   await page.fill('#messageInput','New Player and Character shared their first kiss.');await page.click('#sendButton');await page.locator('.milestone-toast').wait_for(state='visible');await page.wait_for_function('calls.length===1');await page.wait_for_function("document.querySelector('#sendButton').disabled===false")
   toast=page.locator('.milestone-toast');assert 'Character' in await toast.inner_text();assert 'First Kiss' in await toast.inner_text();assert '💋' in await toast.inner_text()
   await page.fill('#messageInput','Keep this unfinished');await toast.get_by_role('button',name='Dismiss').click();assert await page.locator('#messageInput').input_value()=='Keep this unfinished';assert await page.evaluate('calls.length')==1
   data=await page.evaluate(state);assert len(data['milestones'])==1;assert data['milestones'][0]['verification']['verifiedBy']=='source-evidence';assert data['messages'][1]['personaId']==selected
   body=await page.evaluate('calls[0]');assert json.loads(body['messages'][0]['content'])['persona']['id']==selected
   # Real reload + serialization/validation + transactional restore and conflict protection.
   await page.reload();await page.locator('#messageInput').wait_for();assert not await toast.is_visible()
   result=await page.evaluate("""async()=>{const store=await import('./src/storage/vault-store.js'),{serializePortableBackup,parseVesperBackup}=await import('./src/backup/vesper-backup.js');const db=await store.openVesperDb(),first=await store.loadVault(db),stale=await store.loadVault(db);const json=serializePortableBackup(first);const restored=parseVesperBackup(json);await store.replaceVaultAtomic(db,restored,{expectedRevision:first.storageRevision});let conflict;try{await store.saveVaultAtomic(db,stale);}catch(e){conflict=e.code;}return {conflict,vault:await store.loadVault(db)};}""")
   assert result['conflict']=='VESPER_VAULT_CONFLICT';assert result['vault']['stories'][0]['personaBinding']['personaId']==selected
   await page.reload();await page.locator('#messageInput').wait_for();assert not await toast.is_visible()
   # Assistant evidence is pending, never automatically awarded; explicit local confirmation only.
   await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),{scanMilestoneEvents}=await import('./src/milestones/events.js');const db=await s.openVesperDb(),v=await s.loadVault(db);v.messages.push({id:'candidate',storyId:'s',chatId:'c',role:'assistant',ordinal:3,text:'New Player and Character went on their first date.'});await s.saveVaultAtomic(db,scanMilestoneEvents(v,['candidate']),{expectedRevision:v.storageRevision});}""")
   assert not await toast.is_visible();await page.reload();await page.locator('#messageInput').wait_for();await page.click('#milestonesNavButton');await page.get_by_role('button',name='Confirm completed milestone').click();await toast.wait_for(state='visible');assert 'First Date' in await toast.inner_text();await toast.get_by_role('button',name='Dismiss').click()
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   assert not errors,errors
   print(json.dumps({'device':device,'personaCRUDAndAssignment':True,'historicalAnchorPreserved':True,'draftPreserved':True,'sourceMilestoneDelivery':True,'candidateConfirmation':True,'reloadRestoreConflict':True,'errors':errors}),flush=True)
   await ctx.close()
  await browser.close()
asyncio.run(run())

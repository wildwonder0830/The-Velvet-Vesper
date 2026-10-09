# Synthetic disposable IndexedDB and mocked requests only. Not native Safari.
import asyncio,functools,http.server,json,pathlib,threading
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8815),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
seed="""async()=>{const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),{seedDefaultGreenLines}=await import('./src/rules/preference-lines.js'),v=emptyVault();v.preferenceLines=seedDefaultGreenLines();v.personas=[{id:'p',name:'Player',profile:{species:'Human',gender:'female',anatomy:'No tail, animal ears, fur or claws.'}},{id:'q',name:'Other Player',profile:{species:'Shifter'}}];v.characters=[{id:'x',name:'Character Example',profile:{species:'Jaguar shifter',gender:'male',anatomy:'Tail and permanent feline ears.'}}];v.stories=[{id:'s',title:'Synthetic History',personaId:'p',characterIds:['x'],settings:{model:'synthetic/model'}},{id:'other',title:'Other Story',personaId:'q',characterIds:['x']}];v.chats=[{id:'c',storyId:'s'},{id:'d',storyId:'other'}];v.messages=[{id:'old',storyId:'s',chatId:'c',role:'user',ordinal:0,text:'I kissed Character for the first time.'},{id:'date',storyId:'s',chatId:'c',role:'assistant',ordinal:1,text:'Player and Character Example went on their first date.'},{id:'plot',storyId:'s',chatId:'c',role:'user',ordinal:2,text:'Player completed the mission.'}];await s.replaceVaultAtomic(await s.openVesperDb(),v);localStorage.setItem('vesper.secret.openrouter-api-key','synthetic-key');localStorage.setItem('vesper.ui.lastTab','story');localStorage.setItem('vesper.ui.lastStoryId','s');} """
state="async()=>{const s=await import('./src/storage/vault-store.js');return s.loadVault(await s.openVesperDb());}"
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
   await page.goto('http://127.0.0.1:8815/');await page.locator('.milestone-toast').wait_for(state='attached');await page.evaluate(seed);await page.reload();await page.locator('#messageInput').wait_for()
   await page.evaluate("()=>{window.calls=[];window.mockText='I smile quietly.';window.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:mockText}}]})};};}")
   before=await page.evaluate(state);await page.fill('#messageInput','Preserved unfinished draft');await page.click('#milestonesNavButton')
   await page.get_by_role('button',name='Review historical milestones',exact=True).click();await page.get_by_text('Needs your verification — not yet canon',exact=True).first.wait_for()
   assert await page.evaluate(state)==before;assert await page.evaluate('calls.length')==0
   assert await page.locator('#dataList input[type=checkbox]').count()==3
   await page.get_by_role('button',name='Cancel preview',exact=True).click();assert await page.evaluate(state)==before
   await page.get_by_role('button',name='Review historical milestones',exact=True).click();await page.get_by_role('button',name='Confirm selected historical milestones',exact=True).wait_for()
   await page.get_by_role('checkbox',name='Include First Date',exact=True).check()
   await page.get_by_role('button',name='Confirm selected historical milestones',exact=True).click();await page.get_by_text('2 historical milestones recorded. Story messages were preserved.',exact=True).wait_for()
   saved=await page.evaluate(state);assert len(saved['milestones'])==2
   for key in before:
    if key!='milestones':assert saved[key]==before[key],key
   assert {m['type'] for m in saved['milestones']}=={'first_kiss','first_date'};assert all(m['storyId']=='s' and m['chatId']=='c' for m in saved['milestones'])
   toast=page.locator('.milestone-toast');await toast.wait_for(state='visible');assert 'Character Example' in await toast.inner_text();await toast.get_by_role('button',name='Dismiss').click();await toast.get_by_role('button',name='Dismiss').click()
   await page.get_by_role('button',name='Review historical milestones',exact=True).click();await page.get_by_role('checkbox',name='Include Story Turning Point',exact=True).wait_for();assert await page.locator('#dataList input[type=checkbox]').count()==1;await page.get_by_role('button',name='Cancel preview',exact=True).click()
   await page.click('#storyNavButton');assert await page.locator('#messageInput').input_value()=='Preserved unfinished draft'
   await page.click('#myTurnButton');await page.wait_for_function("!document.querySelector('#sendButton').disabled");assert await page.locator('#messageInput').input_value()=='I smile quietly.';assert await page.evaluate('calls.length')==1
   body=await page.evaluate('calls[0]');system=json.loads(body['messages'][0]['content'].split('\n\nCURRENT OOC INSTRUCTION:')[0]);assert system['identityOwnership']['actors'][0]['species']=='Human';assert system['identityOwnership']['actors'][1]['id']=='x'
   for bad in ['My tail curled.','Her tail—no, his tail—shifted.']:
    await page.fill('#messageInput','Keep my edited draft');await page.evaluate('(text)=>window.mockText=text',bad);count=await page.evaluate('calls.length');await page.click('#myTurnButton');await page.wait_for_function("!document.querySelector('#sendButton').disabled");assert await page.evaluate('calls.length')==count+1;assert await page.locator('#messageInput').input_value()=='Keep my edited draft'
   assert (await page.evaluate(state))['messages']==before['messages'];await page.reload();await page.locator('#messageInput').wait_for();assert not await page.locator('.milestone-toast').is_visible();assert len((await page.evaluate(state))['milestones'])==2
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert not errors,errors
   print(json.dumps({'device':device,'readOnlyPreview':True,'explicitConfirmationAndExclusions':True,'persistentMilestones':True,'noDuplicateHistory':True,'anatomyDraftBlockedWithoutRetry':True,'draftOnly':True,'errors':errors,'paidRequests':0}),flush=True);await ctx.close()
  await browser.close()
asyncio.run(run());server.shutdown()

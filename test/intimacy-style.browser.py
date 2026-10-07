# Synthetic-only UI and real IndexedDB regressions: python test/intimacy-style.browser.py
import asyncio, functools, http.server, json, pathlib, threading
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8778),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
seed='''async()=>{
 const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),{seedDefaultGreenLines}=await import('./src/rules/preference-lines.js');
 const v=emptyVault('2026-01-01T00:00:00Z');v.personas=[{id:'p',name:'Amanda',profile:{age:30,voice:'Dry humor.'}}];v.characters=[{id:'x',name:'Character',profile:{age:35,voice:'Reserved.',limits:['Established boundary.']}}];v.preferenceLines=seedDefaultGreenLines();
 v.stories=['a','b'].map(id=>({id,title:'Synthetic '+id,personaId:'p',characterIds:['x'],settings:{model:'synthetic',temperature:0,maxTokens:512,intimacyPacing:'slow',enabledPreferenceLineIds:[],custom:'preserve'}}));v.stories.push({id:'legacy',title:'Legacy synthetic',personaId:'p',characterIds:['x']});v.chats=['a','b','legacy'].map(id=>({id:'chat-'+id,storyId:id}));
 v.messages=[{id:'message',storyId:'a',chatId:'chat-a',role:'user',text:'The garden is open.'}];v.memoryEntries=[{id:'safe',storyId:'a',kind:'canon',text:'Established historical fact.'}];v.relationships=[{id:'shared',storyId:'a',stage:'friends',participantIds:['p','x']}];v.sceneStates=[{id:'scene',storyId:'a',chatId:'chat-a',location:'Garden'}];
 await s.replaceVaultAtomic(await s.openVesperDb(),v);localStorage.setItem('vesper.ui.lastStoryId','a');localStorage.setItem('vesper.secret.openrouter-api-key','synthetic-key');
}'''
async def state(page):return await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return await s.loadVault(await s.openVesperDb());}")
def portable_state(v):
 v=json.loads(json.dumps(v));v.pop('updatedAt',None);v.pop('storageRevision',None)
 for s in v['stories']:s.get('settings',{}).pop('intimacyStyle',None)
 return v
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:8778/');await page.locator('.milestone-toast').wait_for(state='attached');await page.evaluate(seed);await page.reload();await page.locator('.milestone-toast').wait_for(state='attached')
   # Settings can be opened from the library before a story tab is active.
   await page.click('#settingsButton');await page.select_option('#intimacyStyle','romantic');await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden');assert (await state(page))['stories'][0]['settings'].get('intimacyStyle')=='romantic'
   await page.click('#settingsButton');await page.select_option('#intimacyStyle','balanced');await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden')
   await page.click('#storyNavButton');await page.select_option('#storyPicker','a')
   await page.click('#settingsButton');selector=page.locator('#intimacyStyle');await selector.wait_for(timeout=3000);assert await selector.input_value()=='balanced'
   assert await selector.locator('option').evaluate_all('(nodes)=>nodes.map(n=>n.value)')==['romantic','balanced','direct','unfiltered']
   await page.click('#settingsClose')
   baseline=await state(page);storage=await page.evaluate('JSON.stringify({...localStorage})')
   for style in ['romantic','direct','unfiltered','balanced']:
    await page.click('#settingsButton');await selector.select_option(style);await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden')
    current=await state(page);assert current['stories'][0]['settings']['intimacyStyle']==style;assert portable_state(current)==portable_state(baseline),'Style changed unrelated data';assert await page.evaluate('JSON.stringify({...localStorage})')==storage
    result=await page.evaluate('''async style=>{
     const s=await import('./src/storage/vault-store.js'),{assemblePrompt}=await import('./src/prompt/prompt-assembler.js'),{runTurn}=await import('./src/chat/turn-engine.js'),v=await s.loadVault(await s.openVesperDb()),a=assemblePrompt({vault:v,storyId:'a',chatId:'chat-a',preferenceLines:v.preferenceLines,storySettings:v.stories[0].settings});if(a.intimacyStyle!==style)throw Error('Wrong projection');
     const old=fetch,bodies=[];globalThis.fetch=async(_u,o)=>{bodies.push(JSON.parse(o.body));return {ok:true,json:async()=>({choices:[{message:{content:bodies.length===1?'Amanda decided to leave.':'The evening settled quietly.'}}]})};};
     try{await runTurn({vault:v,storyId:'a',chatId:'chat-a',model:'synthetic',preferenceLines:v.preferenceLines,storySettings:v.stories[0].settings});if(bodies.length!==2)throw Error('No repair');for(const b of bodies){const c=JSON.parse(b.messages[0].content);if(style==='balanced'?c.intimacyStyle!==undefined:c.intimacyStyle!==a.intimacyStyleDirective)throw Error('Wrong provider style');if(c.greenLines.some(l=>l.tags.includes('cnc')))throw Error('CNC enabled');}return true;}finally{globalThis.fetch=old;}
    }''',style);assert result
   await page.click('#settingsButton');await selector.select_option('unfiltered');await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden')
   for cnc in [True,False]:
    await page.click('#settingsButton');await page.locator('#cncToggle').set_checked(cnc);await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden');v=await state(page);assert v['stories'][0]['settings']['intimacyStyle']=='unfiltered';cnc_id=next(l['id'] for l in v['preferenceLines'] if 'cnc' in l['tags']);assert (cnc_id in v['stories'][0]['settings']['enabledPreferenceLineIds'])==cnc
   # Style-only saves also preserve enabled CNC and the exact permission-line storage.
   await page.click('#settingsButton');await page.check('#cncToggle');await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden');before=await state(page)
   await page.click('#settingsButton');await selector.select_option('romantic');await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden');assert portable_state(await state(page))==portable_state(before)
   await page.click('#storyNavButton');await page.select_option('#storyPicker','b')
   # Toggling CNC alone must not materialize or rewrite an unset style.
   for cnc in [True,False]:
    await page.click('#settingsButton');await page.locator('#cncToggle').set_checked(cnc);await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden');assert 'intimacyStyle' not in (await state(page))['stories'][1]['settings']
   await page.click('#settingsButton');assert await selector.input_value()=='balanced';await selector.select_option('direct');await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden')
   for id,expected in [('a','romantic'),('b','direct'),('a','romantic')]:
    await page.select_option('#storyPicker',id);await page.click('#settingsButton');assert await selector.input_value()==expected;assert await page.locator('#cncToggle').is_checked()==(id=='a');await selector.scroll_into_view_if_needed();box=await selector.bounding_box();vp=page.viewport_size;assert box['x']>=0 and box['x']+box['width']<=vp['width']+1;assert box['height']>=40;await page.screenshot(path='/tmp/vesper-style-'+device.replace(' ','_')+'.png');await page.click('#settingsClose')
   await page.select_option('#storyPicker','legacy');await page.click('#settingsButton');assert await selector.input_value()=='balanced';await selector.select_option('direct');await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden');v=await state(page);assert v['stories'][2]['settings']=={'intimacyStyle':'direct'}
   await page.reload();await page.locator('.milestone-toast').wait_for(state='attached');await page.click('#settingsButton');assert await selector.input_value()=='direct';await page.click('#settingsClose')
   backup=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),b=await import('./src/backup/vesper-backup.js');return b.serializePortableBackup(await s.loadVault(await s.openVesperDb()));}")
   await page.click('#libraryNavButton');await page.locator('#importFile').set_input_files({'name':'synthetic-style.json','mimeType':'application/json','buffer':backup.encode()});await page.locator('#confirmImport').wait_for();await page.click('#confirmImport');await page.locator('#importPreview').wait_for(state='hidden');await page.reload();await page.locator('.milestone-toast').wait_for(state='attached')
   v=await state(page);assert [s['settings']['intimacyStyle'] for s in v['stories']]==['romantic','direct','direct'];assert v['stories'][0]['settings']['enabledPreferenceLineIds']==before['stories'][0]['settings']['enabledPreferenceLineIds'];assert not errors,errors
   print(json.dumps({'device':device,'fourStyles':True,'providerAndRepair':True,'independentCNC':True,'unchangedUnrelatedData':True,'storySwitchReloadRestore':True,'legacyNoSettings':True,'realIndexedDB':True,'mobileSelector':True,'pageErrors':errors}),flush=True);await ctx.close()
  await browser.close()
asyncio.run(run())

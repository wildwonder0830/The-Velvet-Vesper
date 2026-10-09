# Synthetic disposable storage and mocked provider; Chromium emulation, not native Safari.
import asyncio,functools,http.server,json,pathlib,threading,os
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=os.environ.get('VESPER_BROWSER_BASE',f'http://127.0.0.1:{server.server_port}/')
seed="""async()=>{const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),{seedDefaultGreenLines}=await import('./src/rules/preference-lines.js'),v=emptyVault();v.preferenceLines=seedDefaultGreenLines();v.personas=[{id:'p',name:'Player',profile:{species:'Human',age:30}}];v.characters=[{id:'x',name:'Character',profile:{species:'Human',age:30}}];v.stories=[{id:'s',title:'Synthetic Director',personaId:'p',characterIds:['x'],settings:{model:'synthetic/model',intimacyStyle:'balanced'}},{id:'other',title:'Other synthetic story',personaId:'p',characterIds:['x'],settings:{model:'synthetic/model'}}];v.chats=[{id:'c',storyId:'s'},{id:'d',storyId:'other'}];v.messages=Array.from({length:10},(_,i)=>({id:'m'+i,storyId:'s',chatId:'c',role:i%2?'assistant':'user',ordinal:i,text:'The garden was quiet. '.repeat(100)}));await s.replaceVaultAtomic(await s.openVesperDb(),v);localStorage.setItem('vesper.secret.openrouter-api-key','synthetic-key');localStorage.setItem('vesper.ui.lastTab','story');localStorage.setItem('vesper.ui.lastStoryId','s');} """
state="async()=>{const s=await import('./src/storage/vault-store.js');return s.loadVault(await s.openVesperDb());}"
async def run():
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   for device in ['Desktop','iPhone 13','iPhone SE','iPad (gen 7)']:
    opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
    ctx=await browser.new_context(**opts)
    if base.startswith('https:'):
     async def verified_transport(route):
      import urllib.request,urllib.error
      if not route.request.url.startswith(base):raise AssertionError('Unexpected external request')
      def fetch():
       try:
        with urllib.request.urlopen(route.request.url,timeout=45) as r:return r.status,r.headers.get('Content-Type','application/octet-stream'),r.read()
       except urllib.error.HTTPError as e:return e.code,'text/plain',b''
      status,mime,body=await asyncio.to_thread(fetch);await route.fulfill(status=status,content_type=mime,body=body)
     await ctx.route('**/*',verified_transport)
    page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    await page.goto(base);await page.locator('.milestone-toast').wait_for(state='attached')
    # Empty-vault interface still opens existing settings, import and new story.
    await page.click('#settingsButton');await page.locator('#settingsPanel').wait_for(state='visible');await page.click('#settingsClose')
    async with page.expect_file_chooser():await page.click('#importButton')
    await page.click('#newStoryButton');await page.locator('#storySetupPanel').wait_for(state='visible');await page.click('#storySetupClose')
    await page.evaluate(seed);await page.reload();await page.locator('#messageInput').wait_for();await page.wait_for_timeout(550)
    await page.evaluate("""()=>{window.calls=[];window.reply='Character opened the garden gate.';window.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:window.reply}}],usage:{prompt_tokens:10,completion_tokens:10}})};};}""")
    before=await page.evaluate(state);
    positions=await page.evaluate("()=>{const b=document.querySelector('#chatMenuButton').getBoundingClientRect(),i=document.querySelector('#messageInput').getBoundingClientRect();return {left:b.right<=i.left,input:i.width};}");assert positions['left'] and positions['input']>100
    await page.fill('#messageInput','Preserved unfinished draft');await page.press('#messageInput','Enter');await page.wait_for_timeout(100)
    assert await page.evaluate('calls.length')==0
    for id in ['chatMenuButton','sendButton','myTurnButton','regenLatestButton']:
     assert await page.locator('#'+id).is_visible()
     box=await page.locator('#'+id).bounding_box();assert box['x']>=0 and box['x']+box['width']<=page.viewport_size['width'],(id,box)
    await page.click('#chatMenuButton');await page.locator('#chatMenu').wait_for(state='visible')
    assert not await page.locator('#directorDetailLabel').is_visible()
    for heading in ['Story Library','Characters & Personas','Memories & Milestones','OOC Director','Chat Tools','Settings & Backups']:assert await page.get_by_role('heading',name=heading,exact=True).is_visible()
    assert await page.evaluate('calls.length')==0;assert await page.evaluate(state)==before
    await page.press('#chatMenuClose','Escape');assert not await page.locator('#chatMenu').is_visible();assert await page.locator('#messageInput').input_value()=='Preserved unfinished draft\n'
    await page.click('#chatMenuButton');await page.select_option('#directorIntensity','dramatic');await page.wait_for_function("document.querySelector('#directorStatus').textContent.startsWith('Preferences saved')")
    await page.select_option('#directorPacing','immediate');await page.wait_for_function("!document.querySelector('#directorPacing').disabled")
    saved=await page.evaluate(state);assert saved['stories'][0]['settings']['director']=={'intensity':'dramatic','pacing':'immediate'}
    assert saved['stories'][1]==before['stories'][1]
    for key in before:
     if key!='stories':assert saved[key]==before[key],key
    assert await page.evaluate('calls.length')==0
    await page.click('#chatMenuClose');await page.select_option('#storyPicker','other');await page.click('#chatMenuButton');assert await page.input_value('#directorIntensity')=='subtle';await page.click('#chatMenuClose')
    await page.select_option('#storyPicker','s');await page.click('#chatMenuButton');assert await page.input_value('#directorIntensity')=='dramatic';await page.click('#chatMenuClose');await page.reload();await page.locator('#messageInput').wait_for()
    await page.evaluate("""()=>{window.calls=[];window.reply='Character opened the garden gate.';window.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:reply}}]})};};}""")
    await page.fill('#messageInput','Preserved draft');await page.click('#chatMenuButton');await page.select_option('#directorAction','/event attack');await page.click('#directorTrigger');await page.wait_for_function("!document.querySelector('#sendButton').disabled")
    assert await page.evaluate('calls.length')==1;assert 'attempted attack' in json.dumps(await page.evaluate('calls[0]'));assert await page.input_value('#messageInput')=='Preserved draft';assert not await page.locator('#chatMenu').is_visible()
    for command in ['/skip sleep','/skip mundane','/skip 3 hours','/event flirt','/event custom A visitor arrives.','/surprise']:
     count=await page.evaluate('calls.length');await page.fill('#messageInput',command);await page.click('#sendButton');await page.wait_for_function("!document.querySelector('#sendButton').disabled")
     assert await page.evaluate('calls.length')==count+1
     assert not any(m['role']=='user' and m['text']==command for m in (await page.evaluate(state))['messages'])
    count=await page.evaluate('calls.length');await page.fill('#messageInput','/skip forever');await page.click('#sendButton');assert await page.evaluate('calls.length')==count;assert await page.input_value('#messageInput')=='/skip forever'
    await page.fill('#messageInput','Draft stays unsent')
    for tool in ['continueButton','elaborateButton']:
     await page.click('#chatMenuButton');await page.click('#'+tool);await page.wait_for_function("!document.querySelector('#sendButton').disabled");assert await page.input_value('#messageInput')=='Draft stays unsent'
    # My Turn remains a separately authorized editable protagonist contribution.
    await page.evaluate("reply='I look toward the gate.'");messages=(await page.evaluate(state))['messages'];await page.click('#myTurnButton');await page.wait_for_function("!document.querySelector('#sendButton').disabled");assert await page.input_value('#messageInput')=='I look toward the gate.';assert (await page.evaluate(state))['messages']==messages
    # Reduced viewport checks accessibility; this is not a native iOS keyboard.
    if device!='Desktop':
     original=page.viewport_size;await page.set_viewport_size({'width':original['width'],'height':420});await page.locator('#messageInput').focus();await page.wait_for_timeout(100)
     for id in ['chatMenuButton','messageInput','sendButton','myTurnButton','regenLatestButton']:
      box=await page.locator('#'+id).bounding_box();assert box and box['x']>=0 and box['x']+box['width']<=page.viewport_size['width'] and box['y']>=0 and box['y']+box['height']<=420, (id,box)
     await page.set_viewport_size(original)
     # Simulate visualViewport keyboard geometry, including Safari offsetTop.
     await page.evaluate("""()=>{window.savedViewport=Object.getOwnPropertyDescriptor(window,'visualViewport');Object.defineProperty(window,'visualViewport',{configurable:true,value:{height:420,offsetTop:30}});window.dispatchEvent(new Event('resize'));}""")
     assert await page.locator('#app').evaluate("el=>el.classList.contains('keyboard-open')")
     for id in ['chatMenuButton','messageInput','sendButton','myTurnButton','regenLatestButton']:
      box=await page.locator('#'+id).bounding_box();assert box and box['y']>=30 and box['y']+box['height']<=450,(id,box)
     await page.evaluate("()=>{Object.defineProperty(window,'visualViewport',savedViewport);window.dispatchEvent(new Event('resize'));}")
    backup=await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),b=await import('./src/backup/vesper-backup.js'),v=await s.loadVault(await s.openVesperDb());const restored=b.parseVesperBackup(b.serializePortableBackup(v));return Object.keys(v).every(k=>JSON.stringify(restored[k])===JSON.stringify(v[k]));}""");assert backup
    await page.click('#chatMenuButton');await page.get_by_role('button',name='Export Backup',exact=True).click();await page.locator('#downloadBackupFile').wait_for();await page.click('#backupTransferClose')
    await page.click('#chatMenuButton');await page.locator('#chatMenu').get_by_role('button',name='My Personas',exact=True).click();await page.locator('#dataView').wait_for(state='visible');await page.click('#dataBackButton')
    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert not errors,errors
    # Synthetic reproduction: established Valec bond, already asleep, and a prior bad response.
    await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),v=emptyVault();v.personas=[{id:'p',name:'Amanda',profile:{age:30,species:'Human'}}];v.characters=[{id:'x',name:'Valec Thorne',profile:{age:38,species:'Shifter',personality:'Controlled, observant, dryly humorous'}}];v.stories=[{id:'s',title:'Synthetic Valec sleep',personaId:'p',characterIds:['x'],settings:{model:'synthetic/model'}}];v.chats=[{id:'c',storyId:'s'}];v.messages=[{id:'proof',storyId:'s',chatId:'c',role:'user',ordinal:0,text:'Amanda and Valec completed their mate bond.'},{id:'sleep',storyId:'s',chatId:'c',role:'assistant',ordinal:1,text:'Amanda and Valec were already asleep together.'},{id:'old-meta',storyId:'s',chatId:'c',role:'assistant',ordinal:2,text:'The story has reached a complete conclusion. No continuation is necessary.'}];v.milestones=[{id:'bond',storyId:'s',chatId:'c',type:'mated',participants:['p','x'],status:'confirmed',sourceMessageId:'proof',evidence:v.messages[0].text,verification:{verified:true,completed:true,verifiedBy:'user'}}];const db=await s.openVesperDb();await s.replaceVaultAtomic(db,v,{expectedRevision:(await s.loadVault(db)).storageRevision});}""")
    await page.reload();await page.locator('#messageInput').wait_for()
    await page.evaluate("""()=>{window.calls=[];window.reply='The story has reached a complete conclusion. No continuation is necessary.';window.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:reply}}]})};};}""")
    original=await page.evaluate(state);await page.fill('#messageInput','Preserved player draft')
    await page.click('#chatMenuButton');await page.select_option('#directorAction','/skip sleep');await page.click('#directorTrigger');await page.wait_for_function("!document.querySelector('#sendButton').disabled")
    assert await page.evaluate('calls.length')==1;assert 'story-ending commentary' in await page.locator('#status').inner_text()
    rejected=await page.evaluate(state);assert rejected['messages']==original['messages'];assert rejected['milestones']==original['milestones'];assert await page.input_value('#messageInput')=='Preserved player draft'
    assert 'already asleep' in (await page.evaluate('calls[0]'))['messages'][-1]['content']
    await page.evaluate("reply='Morning light reached the room. Valec opened his eyes and listened to the quiet house.'")
    await page.click('#chatMenuButton');await page.select_option('#directorAction','/skip sleep');await page.click('#directorTrigger');await page.wait_for_function("!document.querySelector('#sendButton').disabled")
    continued=await page.evaluate(state);assert await page.evaluate('calls.length')==2;assert continued['messages'][:-1]==original['messages'];assert continued['milestones']==original['milestones'];assert 'Valec opened his eyes' in continued['messages'][-1]['text']
    for key in original:
     if key not in ['messages','usageEntries']:assert continued[key]==original[key],key
    await page.reload();await page.locator('#messageInput').wait_for();assert (await page.evaluate(state))['messages']==continued['messages']
    # Explicit completion is metadata; no provider request or storage write is allowed.
    await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.stories[0].status='finished';await s.saveVaultAtomic(db,v);}""")
    await page.reload();await page.locator('#messageInput').wait_for();await page.evaluate("()=>{window.calls=[];window.fetch=async()=>{calls.push('unexpected');throw new Error('Provider must not run');};}")
    finished=await page.evaluate(state);await page.fill('#messageInput','Unsent finished-story draft');await page.click('#chatMenuButton');await page.click('#directorTrigger')
    assert 'explicitly marked finished' in await page.locator('#directorStatus').inner_text();assert await page.evaluate('calls.length')==0;assert await page.evaluate(state)==finished;assert await page.input_value('#messageInput')=='Unsent finished-story draft';await page.click('#chatMenuClose')
    await page.screenshot(path='/tmp/menu-director-'+device.replace(' ','_')+'.png')
    await page.click('#chatMenuButton');await page.screenshot(path='/tmp/menu-director-drawer-'+device.replace(' ','_')+'.png');await page.click('#chatMenuClose')
    print(json.dumps({'device':device,'drawer':True,'explicitRequestsOnly':True,'myTurnDraftOnly':True,'perStoryIndexedDB':True,'backupRoundTrip':True,'reducedViewportControls':True,'errors':errors,'paidRequests':0,'sleepingValecContinuation':True,'metaReplyRejected':True,'explicitFinishedStateProtected':True}),flush=True);await ctx.close()
   await browser.close()
 finally:server.shutdown()
asyncio.run(run())

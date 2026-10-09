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
   for device in ['Desktop','iPhone 13','iPad (gen 7)']:
    opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
    ctx=await browser.new_context(**opts)
    if base.startswith('https:'):
     async def transport(route):
      import urllib.request
      assert route.request.url.startswith(base)
      def fetch():
       with urllib.request.urlopen(route.request.url,timeout=45) as r:return r.status,r.headers.get('Content-Type','application/octet-stream'),r.read()
      status,mime,data=await asyncio.to_thread(fetch);await route.fulfill(status=status,content_type=mime,body=data)
     await ctx.route('**/*',transport)
    page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    await page.goto(base);await page.locator('.milestone-toast').wait_for(state='attached');await page.evaluate(seed)
    await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.stories[0].title='Venomous Devotion';v.stories[0].premise='USER_SAVED_PREMISE';v.characters[0].name='Valec Thorne';v.characters[0].storyId='s';v.personas[0].profile.work='USER_SAVED_WORK';v.personas[0].profile.onlineUsername='USER_SAVED_HANDLE';v.stories[0].settings.temperature=0;await s.saveVaultAtomic(db,v);}""")
    before=await page.evaluate(state);await page.reload();await page.locator('#messageInput').wait_for();assert await page.evaluate(state)==before,'Boot rewrote existing canon'
    await page.click('#settingsButton');await page.fill('#temperatureSetting','0');await page.check('#requirePlotAfterSex');await page.click('#saveSettings');await page.locator('#settingsPanel').wait_for(state='hidden');assert (await page.evaluate(state))['stories'][0]['settings']['temperature']==0
    await page.click('#settingsButton');before=await page.evaluate(state);await page.fill('#temperatureSetting','');await page.click('#saveSettings');assert await page.locator('#modelSelectionError').is_visible();assert await page.evaluate(state)==before;await page.click('#settingsClose')
    await page.fill('#messageInput','/ooc');await page.click('#sendButton');assert await page.input_value('#messageInput')=='/ooc'
    await page.evaluate("()=>{window.calls=[];window.fetch=async(url,o)=>{calls.push(JSON.parse(o.body));return {ok:true,json:async()=>({choices:[{message:{content:'Mandy entered the garden. '+('ed'+'ging')}}]})};};}")
    await page.fill('#messageInput','/scene');before=await page.evaluate(state);await page.click('#sendButton');await page.wait_for_timeout(100);assert await page.evaluate('calls.length')==0;assert await page.evaluate(state)==before;assert await page.input_value('#messageInput')=='/scene'
    await page.fill('#messageInput','I look at the gate.');await page.click('#sendButton');await page.wait_for_function("!document.querySelector('#sendButton').disabled");assert await page.evaluate('calls.length')==1;after=await page.evaluate(state);assert after['messages'][-1]['role']=='user';assert len(after['usageEntries'])==1;assert not await page.locator('#blockedReplyPanel').is_visible()
    # Synthetic failed save must preserve both the persisted branch and the visible UI snapshot.
    await page.evaluate("""()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){const r=original.call(this,value,key);if(this.name==='vault'&&key==='active'){IDBObjectStore.prototype.put=original;const tx=this.transaction;r.addEventListener('success',()=>tx.abort());}return r;};}""")
    page.once('dialog',lambda d:d.accept());before=await page.evaluate(state);await page.locator('.message.user').last.get_by_role('button',name='Delete this post and later dependent posts',exact=True).click();await page.wait_for_timeout(200);assert await page.evaluate(state)==before
    # Add direct/transitive branch evidence; delete by the existing user-confirmed control.
    await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);const id=v.messages.at(-1).id;v.memoryEntries.push({id:'branch-memory',storyId:'s',kind:'canon',text:'BRANCH_SECRET',sourceMessageId:id},{id:'branch-derived',storyId:'s',kind:'canon',text:'DERIVED_SECRET',sourceMemoryIds:['branch-memory']});v.knowledgeEntries.push({id:'branch-knowledge',storyId:'s',knowerId:'x',factKey:'branch',value:'DEPENDENT_SECRET',sourceMemoryIds:['branch-derived']});await s.saveVaultAtomic(db,v);}""")
    await page.reload();await page.locator('#messageInput').wait_for();page.once('dialog',lambda d:d.accept());await page.locator('.message.user').last.get_by_role('button',name='Delete this post and later dependent posts',exact=True).click();await page.wait_for_timeout(250)
    after=await page.evaluate(state);assert not any(m['id'].startswith('branch-') for m in after['memoryEntries']+after['knowledgeEntries']);assert await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),b=await import('./src/backup/vesper-backup.js');return !!b.parseVesperBackup(b.serializePortableBackup(await s.loadVault(await s.openVesperDb())));}""")
    await page.click('#libraryNavButton');before=await page.evaluate(state);await page.get_by_role('button',name='Delete Venomous Devotion',exact=True).click();await page.click('#deleteStoryConfirm');await page.wait_for_timeout(250);after=await page.evaluate(state);assert len(after['characters'])==1;assert after['characters'][0]=={k:v for k,v in before['characters'][0].items() if k!='storyId'};assert after['personas']==before['personas'];assert len(after['stories'])==1
    assert await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),b=await import('./src/backup/vesper-backup.js');return !!b.parseVesperBackup(b.serializePortableBackup(await s.loadVault(await s.openVesperDb())));}""")
    await page.evaluate(seed)
    assert await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),p=await import('./src/phone/phone-state.js'),e=await import('./src/phone/phone-engine.js'),db=await s.openVesperDb(),base=await s.loadVault(db);base.messages[0].audienceIds=['p'];base.memoryEntries=[{id:'private',storyId:'s',kind:'canon',text:'PRIVATE_DIRECT',audienceIds:['p']},{id:'derived',storyId:'s',kind:'canon',text:'PRIVATE_DERIVED',sourceMessageIds:['m0']},{id:'safe',storyId:'s',kind:'canon',text:'SAFE_SHARED'}];let v=p.ensureStoryPhone(base,'s','c'),r=p.openPrivateThread(v,'s','c','x');await s.saveVaultAtomic(db,r.vault,{expectedRevision:base.storageRevision});let body;await e.runPhoneTurn({vault:await s.loadVault(db),storyId:'s',threadId:r.threadId,action:'continue',send:async options=>{body=JSON.stringify(options);return {choices:[{message:{content:'[{"speakerId":"x","text":"The gate is open."}]'}}]};}});return !body.includes('PRIVATE_DIRECT')&&!body.includes('PRIVATE_DERIVED')&&body.includes('SAFE_SHARED');}""")
    assert await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),pa=await import('./src/prompt/prompt-assembler.js'),db=await s.openVesperDb(),v=await s.loadVault(db),body=JSON.stringify(pa.assemblePrompt({vault:v,storyId:'s',chatId:'c'}));return !body.includes('PRIVATE_DIRECT')&&!body.includes('PRIVATE_DERIVED')&&body.includes('SAFE_SHARED');}""")
    assert await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db),before=JSON.stringify(v);v.memoryEntries=null;let rejected=false;try{await s.saveVaultAtomic(db,v);}catch{rejected=true;}return rejected&&JSON.stringify(await s.loadVault(db))===before;}""");assert not errors,errors
    print(json.dumps({'device':device,'bootNoCanonRewrite':True,'sharedCharacterPreserved':True,'branchCleanupAndAbort':True,'temperatureZero':True,'unsupportedCommandsNoRequest':True,'blockedOneRequest':True,'usageWithoutMetadata':True,'backupValid':True,'phoneAudienceIsolation':True,'storyAudienceIsolation':True,'corruptSavePreserved':True,'errors':errors}),flush=True);await ctx.close()
   await browser.close()
 finally:server.shutdown()
asyncio.run(run())

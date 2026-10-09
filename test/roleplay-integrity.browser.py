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
    await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.messages.push({id:'legacy-meta',storyId:'s',chatId:'c',role:'assistant',ordinal:10,text:'Understood. Future responses will end on complete sentences and resolved narrative moments.'});v.memoryEntries.push({id:'derived',storyId:'s',kind:'canon',text:'CONTAMINATED_DERIVATIVE',sourceMessageIds:['legacy-meta']});await s.saveVaultAtomic(db,v);}""")
    await page.reload();await page.locator('#messageInput').wait_for()
    await page.evaluate("""()=>{window.calls=[];window.reply='Understood. The scene concluded with a complete narrative beat—the quiet declaration of love carried on the bond as Player sleeps, the circle of their story’s opening chapter closed. Future responses will end on complete sentences and resolved narrative moments.';window.fetch=async(url,o)=>{calls.push(JSON.parse(o.body));return {ok:true,json:async()=>({choices:[{message:{content:reply}}],usage:{prompt_tokens:10,completion_tokens:10}})};};}""")
    original=await page.evaluate(state);await page.fill('#messageInput','Unsent player draft')
    for mode in ['myTurnButton','regenLatestButton','continueButton','elaborateButton','directorTrigger']:
     before=await page.evaluate(state);n=await page.evaluate('calls.length')
     if mode in ['continueButton','elaborateButton'] or mode=='directorTrigger':await page.click('#chatMenuButton')
     if mode=='directorTrigger':await page.select_option('#directorAction','/skip sleep')
     await page.click('#'+mode);await page.wait_for_function("!document.querySelector('#sendButton').disabled")
     assert await page.evaluate('calls.length')==n+1,mode
     after=await page.evaluate(state)
     for key in ['messages','memoryEntries','milestones','stories']:assert after[key]==before[key],(mode,key)
     assert await page.input_value('#messageInput')=='Unsent player draft'
     payload=await page.evaluate('calls.at(-1)');assert 'Only the user' in payload['messages'][-1]['content'];assert 'CONTAMINATED_DERIVATIVE' not in json.dumps(payload);assert 'Understood. Future responses' not in json.dumps(payload)
    await page.fill('#messageInput','I look toward the garden.');n=await page.evaluate('calls.length');await page.click('#sendButton');await page.wait_for_function("!document.querySelector('#sendButton').disabled")
    after=await page.evaluate(state);assert len(after['messages'])==len(original['messages'])+1;assert after['messages'][-1]['role']=='user';assert await page.evaluate('calls.length')==n+1
    await page.reload();await page.locator('#messageInput').wait_for();assert (await page.evaluate(state))['messages']==after['messages'];assert not errors,errors
    print(json.dumps({'device':device,'metaRejectedAllModes':True,'legacyHistoryUnchanged':True,'derivedContextExcluded':True,'oneRequestPerAction':True,'realIndexedDBReload':True,'errors':errors,'paidRequests':0}),flush=True);await ctx.close()
   await browser.close()
 finally:server.shutdown()
asyncio.run(run())

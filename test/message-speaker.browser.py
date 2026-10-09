# Synthetic data, mocked provider only; Chromium emulation is not native Safari.
import asyncio,functools,http.server,json,pathlib,threading
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8800),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
seed = "async()=>{const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),{seedDefaultGreenLines}=await import('./src/rules/preference-lines.js'),v=emptyVault();v.preferenceLines=seedDefaultGreenLines();v.personas=[{id:'p',name:'Amanda'}];v.characters=[{id:'x',name:'Character'}];v.stories=[{id:'s',title:'Synthetic scrolling',personaId:'p',characterIds:['x'],settings:{model:'synthetic/model'}}];v.chats=[{id:'c',storyId:'s'}];v.messages=Array.from({length:12},(_,i)=>({id:'m'+i,storyId:'s',chatId:'c',role:i%2?'assistant':'user',ordinal:i,text:Array.from({length:i===11?24:4},(_,n)=>'Neutral paragraph '+n+'. The garden gate stood beneath a quiet sky.').join('\\n\\n')}));await s.replaceVaultAtomic(await s.openVesperDb(),v);localStorage.setItem('vesper.secret.openrouter-api-key','synthetic-key');localStorage.setItem('vesper.ui.lastTab','story');localStorage.setItem('vesper.ui.lastStoryId','s');}"
state="async()=>{const s=await import('./src/storage/vault-store.js');return s.loadVault(await s.openVesperDb());}"
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:8800/');await page.locator('.milestone-toast').wait_for(state='attached');await page.evaluate(seed);await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.characters.push({id:'group-member',name:'Additional Character With A Long Display Name',storyId:'s'});v.stories.find(x=>x.id==='s').characterIds.push('group-member');await s.saveVaultAtomic(db,v);}""");await page.reload();await page.locator('#messageInput').wait_for()
   await page.evaluate("""()=>{window.calls=[];window.fetch=async(url,options)=>{window.calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:'The room settled quietly.'}}]})};};}""")
   before=await page.evaluate(state)
   assert await page.locator('.message-speaker').count()==len(before['messages'])
   expected=await page.evaluate("""async()=>{const st=await import('./src/storage/vault-store.js'),sp=await import('./src/ui/message-speaker.js'),v=await st.loadVault(await st.openVesperDb());return v.messages.filter(m=>m.chatId==='c').map(m=>sp.messageSpeakerLabel(v,m));}""")
   assert await page.locator('.message-speaker').all_text_contents()==expected
   assert await page.evaluate(state)==before
   assert await page.evaluate("()=>Array.from(document.querySelectorAll('.message-speaker')).every(n=>n.getBoundingClientRect().right<=innerWidth+1)")
   assert not errors,errors
   print(json.dumps({'device':device,'speakerLabels':True,'dataUnchanged':True,'noOverflow':True,'errors':errors}),flush=True);await ctx.close()
  await browser.close()
asyncio.run(run());server.shutdown()

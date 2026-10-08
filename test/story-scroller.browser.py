import asyncio,json,pathlib,threading,http.server,functools
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1];server=http.server.ThreadingHTTPServer(('127.0.0.1',8781),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)));threading.Thread(target=server.serve_forever,daemon=True).start()
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None);ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));await page.goto('http://127.0.0.1:8781/');await page.locator('.milestone-toast').wait_for(state='attached')
   await page.evaluate('''async()=>{const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),{seedDefaultGreenLines}=await import('./src/rules/preference-lines.js'),v=emptyVault();v.preferenceLines=seedDefaultGreenLines();v.personas=[{id:'p',name:'Amanda'}];v.characters=[{id:'x',name:'Character'}];v.stories=[{id:'s',title:'Synthetic scrolling',personaId:'p',characterIds:['x'],settings:{model:'synthetic/model'}}];v.chats=[{id:'c',storyId:'s'}];v.messages=Array.from({length:12},(_,i)=>({id:'m'+i,storyId:'s',chatId:'c',role:i%2?'assistant':'user',ordinal:i,text:Array.from({length:i===11?24:4},(_,n)=>'Neutral paragraph '+n+'. The garden gate stood beneath a quiet sky.').join('\\n\\n')}));await s.replaceVaultAtomic(await s.openVesperDb(),v);localStorage.setItem('vesper.secret.openrouter-api-key','synthetic-key');localStorage.setItem('vesper.ui.lastTab','story');localStorage.setItem('vesper.ui.lastStoryId','s');}''')
   await page.reload();await page.locator('.message.assistant').last.wait_for();await page.wait_for_timeout(350)
   metrics=await page.evaluate('''()=>{const s=document.getElementById('messages'),last=s.lastElementChild,r=s.getBoundingClientRect(),l=last.getBoundingClientRect();return {viewport:innerHeight,documentHeight:document.documentElement.scrollHeight,windowY:scrollY,scrollerHeight:s.clientHeight,scrollHeight:s.scrollHeight,scrollTop:s.scrollTop,bottomGap:s.scrollHeight-s.scrollTop-s.clientHeight,lastStart:l.top-r.top,userBackground:getComputedStyle(s.querySelector('.user')).backgroundImage};}''')
   assert metrics['windowY']==0 and metrics['documentHeight']<=metrics['viewport']+1 and metrics['bottomGap']<2
   assert '59, 48, 31' in metrics['userBackground']
   baseline=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return s.loadVault(await s.openVesperDb());}")
   await page.click('#memoryNavButton');await page.click('#storyNavButton');await page.wait_for_timeout(500)
   assert await page.evaluate("(()=>{const s=document.getElementById('messages');return s.scrollHeight-s.scrollTop-s.clientHeight<2;})()")
   assert await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return s.loadVault(await s.openVesperDb());}")==baseline
   bodies=[];release=asyncio.Event();received=asyncio.Event()
   async def provider(r):
    bodies.append(r.request.post_data_json);received.set();await release.wait();await r.fulfill(json={'choices':[{'message':{'content':'\n\n'.join('Neutral replacement paragraph '+str(i)+'. The garden gate stood beneath a quiet sky.' for i in range(24))}}]})
   await ctx.route('https://openrouter.ai/**',provider);await page.fill('#messageInput','Synthetic neutral input.');await page.click('#sendButton');await asyncio.wait_for(received.wait(),15);await page.wait_for_timeout(500)
   assert await page.evaluate("(()=>{const s=document.getElementById('messages');return Math.abs(s.lastElementChild.getBoundingClientRect().top-s.getBoundingClientRect().top-16)<3;})()")
   release.set();await page.wait_for_function("document.querySelectorAll('.message').length>=14");await page.wait_for_timeout(350)
   after=await page.evaluate('''()=>{const s=document.getElementById('messages'),r=s.getBoundingClientRect(),l=s.lastElementChild.getBoundingClientRect();return {windowY:scrollY,scrollerHeight:s.clientHeight,bottomGap:s.scrollHeight-s.scrollTop-s.clientHeight,newResponseStart:l.top-r.top};}''')
   assert after['windowY']==0 and abs(after['newResponseStart']-16)<3 and after['bottomGap']>100
   # Reading is no longer automatically repositioned, including after viewport resize.
   await page.locator('#messages').dispatch_event('wheel',{'deltaY':-100});await page.evaluate("document.getElementById('messages').scrollTop=100");await page.wait_for_timeout(700)
   assert await page.evaluate("document.getElementById('messages').scrollTop")==100
   vp=page.viewport_size;await page.set_viewport_size({'width':vp['width'],'height':vp['height']-80});await page.wait_for_timeout(150)
   assert await page.evaluate("document.getElementById('messages').scrollTop")==100
   await page.click('#scrollBottomButton');await page.wait_for_function("(()=>{const s=document.getElementById('messages');return s.scrollHeight-s.scrollTop-s.clientHeight<2;})()")
   assert await page.evaluate("(()=>{const s=document.getElementById('messages');return s.scrollHeight-s.scrollTop-s.clientHeight<2;})()")
   # A short replacement also aligns at the beginning without document scrolling.
   await ctx.unroute('https://openrouter.ai/**',provider)
   await ctx.route('https://openrouter.ai/**',lambda r:r.fulfill(json={'choices':[{'message':{'content':'The garden gate stood beneath a quiet sky.'}}]}))
   await page.fill('#messageInput','Another synthetic input.');await page.click('#sendButton');await page.wait_for_function("document.querySelectorAll('.message').length===16");await page.wait_for_timeout(600)
   assert await page.evaluate("(()=>{const s=document.getElementById('messages');return Math.abs(s.lastElementChild.getBoundingClientRect().top-s.getBoundingClientRect().top-16)<3&&scrollY===0;})()")
   await page.reload();await page.locator('.message').last.wait_for();await page.wait_for_timeout(600)
   assert await page.evaluate("(()=>{const s=document.getElementById('messages');return s.scrollHeight-s.scrollTop-s.clientHeight<2&&scrollY===0;})()")
   await page.screenshot(path='/tmp/story-scroll-'+device.replace(' ','_')+'.png')
   assert not errors,errors
   print(json.dumps({'device':device,'reopen':metrics,'newResponse':after}),flush=True);await ctx.close()
  await browser.close()
asyncio.run(run())

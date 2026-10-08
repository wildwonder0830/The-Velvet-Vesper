# Synthetic-only original mobile flow, scroll intents, provider, and IndexedDB checks.
import asyncio, functools, http.server, json, pathlib, threading
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parents[1]
server = http.server.ThreadingHTTPServer(('127.0.0.1',8781), functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
seed = "async()=>{const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),{seedDefaultGreenLines}=await import('./src/rules/preference-lines.js'),v=emptyVault();v.preferenceLines=seedDefaultGreenLines();v.personas=[{id:'p',name:'Amanda'}];v.characters=[{id:'x',name:'Character'}];v.stories=[{id:'s',title:'Synthetic scrolling',personaId:'p',characterIds:['x'],settings:{model:'synthetic/model'}}];v.chats=[{id:'c',storyId:'s'}];v.messages=Array.from({length:12},(_,i)=>({id:'m'+i,storyId:'s',chatId:'c',role:i%2?'assistant':'user',ordinal:i,text:Array.from({length:i===11?24:4},(_,n)=>'Neutral paragraph '+n+'. The garden gate stood beneath a quiet sky.').join('\\n\\n')}));await s.replaceVaultAtomic(await s.openVesperDb(),v);localStorage.setItem('vesper.secret.openrouter-api-key','synthetic-key');localStorage.setItem('vesper.ui.lastTab','story');localStorage.setItem('vesper.ui.lastStoryId','s');}"
async def state(page):
    return await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return s.loadVault(await s.openVesperDb());}")
async def metrics(page):
    return await page.evaluate("""()=>{
      const s=document.getElementById('messages'),last=s.lastElementChild;
      const bar=document.querySelector('.topbar').getBoundingClientRect(),nav=document.querySelector('.bottom-nav').getBoundingClientRect();
      const mobile=matchMedia('(max-width: 799px), (hover: none) and (pointer: coarse)').matches;
      return {mobile,viewport:innerHeight,documentHeight:document.documentElement.scrollHeight,windowY:scrollY,
        paneHeight:s.clientHeight,paneTop:s.scrollTop,paneBottomGap:s.scrollHeight-s.scrollTop-s.clientHeight,
        replyStart:mobile?last.getBoundingClientRect().top-bar.bottom:last.getBoundingClientRect().top-s.getBoundingClientRect().top,
        latestBottomGap:nav.top-last.getBoundingClientRect().bottom,navBottom:nav.bottom,
        storyHeaderBottom:document.querySelector('.storybar').getBoundingClientRect().bottom,
        composerTop:document.getElementById('composer').getBoundingClientRect().top,
        userBackground:getComputedStyle(s.querySelector('.user')).backgroundImage};
    }""")
def assert_latest(m):
    if m['mobile']:
        assert m['windowY']>0 and abs(m['latestBottomGap']-16)<3, m
        assert m['storyHeaderBottom']<0 and m['composerTop']>=m['viewport']-46, m
        assert abs(m['navBottom']-m['viewport'])<2, m
    else:
        assert m['windowY']==0 and m['documentHeight']<=m['viewport']+1 and m['paneBottomGap']<2, m
async def run():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        for device in ['Desktop','iPhone 13','iPhone SE','iPad (gen 7)']:
            opts={} if device=='Desktop' else p.devices[device].copy()
            opts.pop('default_browser_type',None)
            ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            await page.goto('http://127.0.0.1:8781/');await page.locator('.milestone-toast').wait_for(state='attached')
            await page.evaluate(seed);await page.reload();await page.locator('.message').last.wait_for();await page.wait_for_timeout(550)
            initial=await metrics(page);assert_latest(initial);mobile=initial['mobile']
            assert await page.locator('#mobileWriteButton,#composerEditor').count()==0
            assert '59, 48, 31' in initial['userBackground']
            baseline=await state(page)
            # Original composer is in the page, reached by normal scrolling; no disclosure.
            await page.locator('#messageInput').scroll_into_view_if_needed()
            await page.fill('#messageInput','Unsent synthetic draft.')
            if mobile:await page.locator('#scrollBottomButton').wait_for(state='hidden')
            assert await page.locator('#continueButton').is_visible()
            await page.click('#memoryNavButton');await page.click('#storyNavButton');await page.wait_for_timeout(550)
            assert_latest(await metrics(page));assert await page.input_value('#messageInput')=='Unsent synthetic draft.'
            assert await state(page)==baseline
            if mobile:
                vp=page.viewport_size
                await page.set_viewport_size({'width':vp['width'],'height':420})
                await page.locator('#messageInput').scroll_into_view_if_needed()
                await page.locator('#sendButton').scroll_into_view_if_needed()
                # Scroll the last few pixels above the original fixed navigation.
                await page.evaluate("(()=>{const b=document.getElementById('sendButton').getBoundingClientRect(),n=document.querySelector('.bottom-nav').getBoundingClientRect();if(b.bottom>n.top)window.scrollBy(0,b.bottom-n.top+12);})()")
                box=await page.locator('#sendButton').bounding_box()
                assert box['y']>=0 and box['y']+box['height']<=420-46,box
                await page.set_viewport_size(vp)
            bodies=[];received=asyncio.Event();release=asyncio.Event()
            async def provider(route):
                bodies.append(route.request.post_data_json);received.set();await release.wait()
                await route.fulfill(json={'choices':[{'message':{'content':'\n\n'.join('Neutral replacement paragraph '+str(i)+'. The garden gate stood beneath a quiet sky.' for i in range(24))}}]})
            await ctx.route('https://openrouter.ai/**',provider)
            await page.fill('#messageInput','Synthetic neutral input.');await page.locator('#sendButton').evaluate("el=>el.scrollIntoView({block:'center'})");await page.click('#sendButton')
            await asyncio.wait_for(received.wait(),15);await page.wait_for_timeout(550)
            submitted=await metrics(page);assert abs(submitted['replyStart']-16)<3,submitted
            release.set();await page.wait_for_function("document.querySelectorAll('.message').length===14");await page.wait_for_timeout(550)
            reply=await metrics(page);assert abs(reply['replyStart']-16)<3,reply
            if mobile:
                assert reply['windowY']>0 and reply['latestBottomGap']<0,reply
                assert await page.evaluate("document.activeElement.id!=='messageInput'")
            else:assert reply['windowY']==0 and reply['paneBottomGap']>100,reply
            # Touch/manual reading cancels positioning, with no later jumps on resize.
            await page.locator('#messages').dispatch_event('touchstart')
            await page.evaluate("matchMedia('(max-width: 799px), (hover: none) and (pointer: coarse)').matches?window.scrollTo(0,1000):document.getElementById('messages').scrollTo(0,100)")
            await page.wait_for_timeout(650)
            before=await metrics(page)
            vp=page.viewport_size;await page.set_viewport_size({'width':vp['width'],'height':vp['height']-60});await page.wait_for_timeout(200)
            after=await metrics(page)
            assert abs((after['windowY'] if mobile else after['paneTop'])-(before['windowY'] if mobile else before['paneTop']))<2
            await page.click('#scrollBottomButton')
            await page.wait_for_function("""()=>{const s=document.getElementById('messages');return matchMedia('(max-width: 799px), (hover: none) and (pointer: coarse)').matches?Math.abs(document.querySelector('.bottom-nav').getBoundingClientRect().top-s.lastElementChild.getBoundingClientRect().bottom-16)<3:s.scrollHeight-s.scrollTop-s.clientHeight<2;}""")
            assert_latest(await metrics(page))
            # Short replies still start below the top bar, including tall iPad viewports.
            await page.set_viewport_size(vp);await ctx.unroute('https://openrouter.ai/**',provider)
            await ctx.route('https://openrouter.ai/**',lambda route:route.fulfill(json={'choices':[{'message':{'content':'The garden gate stood beneath a quiet sky.'}}]}))
            await page.fill('#messageInput','Another synthetic input.');await page.locator('#sendButton').evaluate("el=>el.scrollIntoView({block:'center'})");await page.click('#sendButton')
            await page.wait_for_function("document.querySelectorAll('.message').length===16");await page.wait_for_timeout(550)
            short=await metrics(page);assert abs(short['replyStart']-16)<3,short
            await page.reload();await page.locator('.message').last.wait_for();await page.wait_for_timeout(550)
            assert_latest(await metrics(page))
            await page.screenshot(path='/tmp/restored-story-'+device.replace(' ','_')+'.png')
            assert not errors,errors
            print(json.dumps({'device':device,'initial':initial,'reply':reply,'shortReply':short,'draftPreserved':True,'composerAccessible':True,'realIndexedDB':True,'pageErrors':errors}),flush=True)
            await ctx.close()
        await browser.close()
asyncio.run(run())

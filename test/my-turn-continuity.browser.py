# Synthetic data, mocked provider only; Chromium emulation is not native Safari.
import asyncio,functools,http.server,json,pathlib,threading
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',8811),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
seed = "async()=>{const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),{seedDefaultGreenLines}=await import('./src/rules/preference-lines.js'),v=emptyVault();v.preferenceLines=seedDefaultGreenLines();v.personas=[{id:'p',name:'Amanda'}];v.characters=[{id:'x',name:'Character'}];v.stories=[{id:'s',title:'Synthetic scrolling',personaId:'p',characterIds:['x'],settings:{model:'synthetic/model'}}];v.chats=[{id:'c',storyId:'s'}];v.messages=Array.from({length:12},(_,i)=>({id:'m'+i,storyId:'s',chatId:'c',role:i%2?'assistant':'user',ordinal:i,text:Array.from({length:i===11?24:4},(_,n)=>'Neutral paragraph '+n+'. The garden gate stood beneath a quiet sky.').join('\\n\\n')}));await s.replaceVaultAtomic(await s.openVesperDb(),v);localStorage.setItem('vesper.secret.openrouter-api-key','synthetic-key');localStorage.setItem('vesper.ui.lastTab','story');localStorage.setItem('vesper.ui.lastStoryId','s');}"
state="async()=>{const s=await import('./src/storage/vault-store.js');return s.loadVault(await s.openVesperDb());}"
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:8811/');await page.locator('.milestone-toast').wait_for(state='attached');await page.evaluate(seed);await page.reload();await page.locator('#messageInput').wait_for()
   await page.evaluate("""()=>{window.calls=[];window.fetch=async(url,options)=>{window.calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:'The room settled quietly.'}}]})};};}""")
   before=await page.evaluate(state);await page.fill('#messageInput','Synthetic unfinished draft');await page.press('#messageInput','Enter');await page.wait_for_timeout(150)
   assert await page.locator('#messageInput').input_value()=='Synthetic unfinished draft\n','Return submitted or consumed draft'
   assert await page.evaluate(state)==before;assert await page.evaluate('calls.length')==0
   for key in ["new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true})","new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true})"]:
    await page.evaluate('(event)=>document.querySelector("#messageInput").dispatchEvent(eval(event))',key)
   await page.evaluate("()=>{const f=document.querySelector('#composer');f.requestSubmit();f.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true}));document.querySelector('#sendButton').click();}")
   await page.locator('#messageInput').blur();await page.locator('#messageInput').focus();await page.wait_for_timeout(150)
   assert await page.evaluate(state)==before;assert await page.evaluate('calls.length')==0;assert await page.locator('#messageInput').input_value()=='Synthetic unfinished draft\n'
   # Editing an assistant reply must not submit or consume composer text.
   await page.locator('[aria-label="Edit this reply"]').first.click();await page.fill('#assistantEditText','Corrected synthetic reply.');await page.click('#assistantEditSave');await page.locator('#assistantEditPanel').wait_for(state='detached')
   assert await page.locator('#messageInput').input_value()=='Synthetic unfinished draft\n';assert await page.evaluate('calls.length')==0
   for tool in ['continueButton','elaborateButton']:
    await page.click('#chatMenuButton')
    await page.locator('#'+tool).evaluate("el=>el.scrollIntoView({block:'center'})");await page.click('#'+tool);await page.wait_for_function("!document.querySelector('#sendButton').disabled")
    assert await page.locator('#messageInput').input_value()=='Synthetic unfinished draft\n';assert not any(m['role']=='user' and m['text'].startswith('Synthetic unfinished draft') for m in (await page.evaluate(state))['messages'])
   await page.locator('#sendButton').evaluate("el=>el.scrollIntoView({block:'center'})");await page.dblclick('#sendButton');await page.wait_for_function("!document.querySelector('#sendButton').disabled")
   saved=await page.evaluate(state);assert sum(m['role']=='user' and m['text']=='Synthetic unfinished draft' for m in saved['messages'])==1;assert await page.evaluate('calls.length')==3
   # A delayed My Turn result cannot submit or overwrite newer typing.
   await page.fill('#messageInput','Prior My Turn draft')
   await page.evaluate("""()=>{window.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));await new Promise(r=>window.releaseDraft=r);return {ok:true,json:async()=>({choices:[{message:{content:'Amanda waited quietly.'}}]})};};}""")
   await page.locator('#myTurnButton').evaluate("el=>el.scrollIntoView({block:'center'})");await page.click('#myTurnButton');await page.wait_for_function('typeof releaseDraft==="function"');await page.fill('#messageInput','Typed while My Turn was pending');await page.evaluate('releaseDraft()');await page.wait_for_function("!document.querySelector('#sendButton').disabled")
   assert await page.locator('#messageInput').input_value()=='Typed while My Turn was pending';assert await page.evaluate('calls.length')==4
   assert sum(m['role']=='user' and m['text']=='Synthetic unfinished draft' for m in (await page.evaluate(state))['messages'])==1
   # A failed save keeps the draft and does not send a paid request.
   await page.fill('#messageInput','Unsent after abort');prior=await page.evaluate(state)
   await page.evaluate("()=>{window.oldPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){const r=oldPut.call(this,v,k);if(k==='active')queueMicrotask(()=>this.transaction.abort());return r;};}")
   await page.locator('#sendButton').evaluate("el=>el.scrollIntoView({block:'center'})");await page.click('#sendButton');await page.wait_for_function("!document.querySelector('#sendButton').disabled")
   assert await page.locator('#messageInput').input_value()=='Unsent after abort';assert await page.evaluate(state)==prior;assert await page.evaluate('calls.length')==4
   await page.evaluate('()=>{IDBObjectStore.prototype.put=oldPut;}')
   # One explicit My Turn click creates an editable suggestion, never a saved turn.
   original_messages=(await page.evaluate(state))['messages']
   await page.evaluate("""()=>{window.draftCalls=0;window.fetch=async()=>{draftCalls++;return {ok:true,json:async()=>({choices:[{message:{content:'I smile and stay beside you.'}}]})};};}""")
   await page.locator('#myTurnButton').evaluate("el=>el.scrollIntoView({block:'center'})");await page.click('#myTurnButton');await page.wait_for_function("!document.querySelector('#sendButton').disabled")
   assert await page.locator('#messageInput').input_value()=='I smile and stay beside you.'
   assert await page.evaluate('draftCalls')==1;assert (await page.evaluate(state))['messages']==original_messages
   await page.fill('#messageInput','Player edited suggestion');await page.wait_for_timeout(150)
   assert await page.evaluate('draftCalls')==1;assert (await page.evaluate(state))['messages']==original_messages
   # Provider failure and unusable output preserve the draft without automatic retry/repair.
   for mode in ['failure','empty']:
    await page.evaluate("""mode=>{window.draftCalls=0;window.fetch=async()=>{draftCalls++;if(mode==='failure')throw new Error('Synthetic provider failure');return {ok:true,json:async()=>({choices:[{message:{content:''}}]})};};}""",mode)
    await page.click('#myTurnButton');await page.wait_for_function("!document.querySelector('#sendButton').disabled")
    assert await page.evaluate('draftCalls')==1;assert await page.locator('#messageInput').input_value()=='Player edited suggestion'
    assert (await page.evaluate(state))['messages']==original_messages
   await page.fill('#messageInput','Unsent after abort')
   # Concurrent storage writes reject the stale composer snapshot without consuming text.
   latest=await page.evaluate("""async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.messages.push({id:'concurrent',storyId:'s',chatId:'c',role:'user',text:'Newer synthetic save.',ordinal:500});await s.saveVaultAtomic(db,v);return s.loadVault(db);}""")
   await page.locator('#sendButton').evaluate("el=>el.scrollIntoView({block:'center'})");await page.click('#sendButton');await page.wait_for_function("document.querySelector('#status').textContent.includes('vault changed')");assert await page.locator('#messageInput').input_value()=='Unsent after abort';assert await page.evaluate(state)==latest;assert await page.evaluate('calls.length')==4
   assert not errors,errors
   print(json.dumps({'device':device,'returnNewline':True,'compositionRepeat':True,'implicitAndSyntheticSubmitBlocked':True,'editPreservesDraft':True,'toolsPreserveDraft':True,'myTurnEditableOnly':True,'oneRequestPerDraftClick':True,'doubleSendOneMessage':True,'abortPreservesDraftAndVault':True,'paidRequests':0,'errors':errors}),flush=True);await ctx.close()
  await browser.close()
asyncio.run(run());server.shutdown()

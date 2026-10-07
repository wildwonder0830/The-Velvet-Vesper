# Run: python test/relationship-isolation.browser.py (Playwright/Chromium required).
import asyncio, functools, http.server, json, pathlib, threading
from playwright.async_api import async_playwright

root = pathlib.Path(__file__).resolve().parents[1]
server = http.server.ThreadingHTTPServer(('127.0.0.1', 8777), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()

seed = '''async()=>{
 const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),{seedDefaultGreenLines}=await import('./src/rules/preference-lines.js');
 const v=emptyVault('2026-01-01T00:00:00Z');v.preferenceLines=seedDefaultGreenLines();v.personas=[{id:'p',name:'Amanda'}];v.characters=[{id:'x',name:'Character'}];
 v.stories=[{id:'s',title:'Synthetic relationship story',personaId:'p',characterIds:['x']},{id:'other',title:'Other synthetic story',personaId:'p',characterIds:['x']}];
 v.chats=[{id:'a',storyId:'s'},{id:'b',storyId:'s'},{id:'other-chat',storyId:'other'}];
 v.messages=[{id:'proof',storyId:'s',chatId:'a',role:'user',ordinal:0,text:'They kissed.'}];
 v.milestones=[{id:'shared-ms',storyId:'s',chatId:'a',type:'first_kiss',status:'confirmed',participants:['p','x'],evidence:'They kissed.',sourceMessageId:'proof',verification:{verified:true,completed:true,verifiedBy:'user'}}];
 v.relationships=[{id:'ra',storyId:'s',chatId:'a',stage:'friends',participantIds:['p','x'],labels:['PRIVATE_A'],establishedFacts:[{id:'fa',text:'PRIVATE_A fact.'}]},{id:'shared',storyId:'s',stage:'friends',participantIds:['p','x'],labels:['SHARED_STORY'],sourceMilestoneId:'shared-ms',establishedFacts:[{id:'fs',text:'SHARED_STORY fact.',sourceMilestoneId:'shared-ms'},{id:'fa-nested',chatId:'a',text:'PRIVATE_A nested fact.'},{id:'fb-nested',chatId:'b',text:'PRIVATE_B nested fact.'}]},{id:'other-r',storyId:'other',chatId:'other-chat',stage:'friends',participantIds:['p','x'],labels:['PRIVATE_OTHER']}];
 v.memoryEntries=[{id:'a-summary',storyId:'s',chatId:'a',kind:'summary',status:'active',text:'PRIVATE_A summary.'},{id:'bad-b-summary',storyId:'s',chatId:'b',kind:'summary',status:'active',text:'PRIVATE_A derived summary.',relationshipId:'ra'},{id:'shared-b-summary',storyId:'s',chatId:'b',kind:'summary',status:'active',text:'SHARED_STORY summary.',relationshipId:'shared'},{id:'shared-memory',storyId:'s',chatId:'a',scope:'story',kind:'relationship',status:'active',text:'SHARED_STORY imported relationship memory.'}];
 v.knowledgeEntries=[{id:'private-knowledge',storyId:'s',factKey:'private',value:'PRIVATE_A knowledge.',relationshipId:'ra'}];
 await s.replaceVaultAtomic(await s.openVesperDb(),v);localStorage.setItem('vesper.secret.openrouter-api-key','synthetic-key');
}'''

check = '''async()=>{
 const s=await import('./src/storage/vault-store.js'),{assemblePrompt}=await import('./src/prompt/prompt-assembler.js'),{buildStoryContext}=await import('./src/prompt/context-builder.js'),{runTurn}=await import('./src/chat/turn-engine.js'),backup=await import('./src/backup/vesper-backup.js');
 const db=await s.openVesperDb(),v=await s.loadVault(db),before=JSON.stringify(v),assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
 const ids=['a','b',...(v.chats.some(c=>c.id==='new')?['new']:[]),'other-chat','b','a'];let providerRequests=0;
 for(const chatId of ids){
  const storyId=chatId==='other-chat'?'other':'s',context=buildStoryContext(v,storyId,chatId),p=assemblePrompt({vault:v,storyId,chatId}),text=JSON.stringify(p);
  for(const foreign of ['a','b','other-chat'].filter(id=>id!==chatId)){const marker={a:'PRIVATE_A',b:'PRIVATE_B','other-chat':'PRIVATE_OTHER'}[foreign];assert(!text.includes(marker),'Foreign relationship in '+chatId+': '+marker);assert(!JSON.stringify(context).includes(marker),'Foreign nested context in '+chatId);}
  if(storyId==='s'){assert(context.relationships.some(r=>r.id==='shared'),'Shared state lost');assert(p.memory.some(m=>m.id==='shared-memory'),'Shared imported memory lost');assert(p.milestones.some(m=>m.id==='shared-ms'),'Permanent verified canon lost');}
  if(chatId==='a')assert(p.relationship.id==='ra','Owning chat lost relationship');if(chatId==='b'||chatId==='new')assert(p.relationship.id==='shared','Wrong fallback');
  const previous=globalThis.fetch,bodies=[];globalThis.fetch=async(url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:bodies.length===1?'Amanda decided to leave.':'The evening settled quietly.'}}]})};};
  try{await runTurn({vault:v,storyId,chatId,model:'synthetic'});assert(bodies.length===2,'Repair not exercised');for(const body of bodies){for(const foreign of ['a','b','other-chat'].filter(id=>id!==chatId))assert(!JSON.stringify(body).includes({a:'PRIVATE_A',b:'PRIVATE_B','other-chat':'PRIVATE_OTHER'}[foreign]),'Provider/repair leaked '+chatId);if(chatId==='a')assert(JSON.stringify(body).includes('PRIVATE_A'),'Own relationship missing from provider');}}finally{globalThis.fetch=previous;}providerRequests+=bodies.length;
 }
 const absent={...v,relationships:v.relationships.filter(r=>r.id==='ra')},p=assemblePrompt({vault:absent,storyId:'s',chatId:'b'});assert(p.relationship===null&&p.canonAndContinuity.relationship===null,'Scoped fallback leak');
 const withoutChat=buildStoryContext(v,'s');assert(withoutChat.relationships.every(r=>r.id==='shared'),'Story context inherited scoped relationship');assert(!JSON.stringify(withoutChat.relationships).includes('PRIVATE_'),'Unowned nested facts leak');
 assert(JSON.stringify(await s.loadVault(db))===before,'Projection or provider changed stored state');
 const portable=backup.serializePortableBackup(v);backup.parseVesperBackup(portable);return {backup:portable,chatContexts:ids.length,providerRequests,providerAndRepair:true,sharedVerifiedCanon:true,noFallback:true,historicalRecords:true};
}'''

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        for device in ['Desktop', 'iPhone 13', 'iPad (gen 7)']:
            options = {} if device == 'Desktop' else p.devices[device].copy()
            options.pop('default_browser_type', None)
            context = await browser.new_context(**options)
            page = await context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto('http://127.0.0.1:8777/')
            await page.locator('.milestone-toast').wait_for(state='attached')
            await page.evaluate(seed)
            await page.reload()
            await page.locator('.milestone-toast').wait_for(state='attached')
            phases = []
            for phase in ['seed', 'story-switch', 'reload', 'new-chat', 'update', 'restore']:
                if phase == 'story-switch':
                    await page.click('#storyNavButton')
                    for story in ['other', 's', 'other', 's']:
                        await page.select_option('#storyPicker', story)
                elif phase == 'reload':
                    await page.reload()
                    await page.locator('.milestone-toast').wait_for(state='attached')
                elif phase == 'new-chat':
                    await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.chats.push({id:'new',storyId:'s'});await s.saveVaultAtomic(db,v);}")
                elif phase == 'update':
                    await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),{assemblePrompt}=await import('./src/prompt/prompt-assembler.js'),db=await s.openVesperDb(),v=await s.loadVault(db);assemblePrompt({vault:v,storyId:'s',chatId:'b'});v.relationships[0].labels.push('PRIVATE_A_UPDATE');v.relationships[0].establishedFacts.push({id:'updated',text:'PRIVATE_A_UPDATE fact.'});await s.saveVaultAtomic(db,v);}")
                elif phase == 'restore':
                    # Refresh after direct fixture writes before importing via UI.
                    await page.reload()
                    await page.locator('.milestone-toast').wait_for(state='attached')
                    await page.click('#libraryNavButton')
                    await page.locator('#importFile').set_input_files({'name':'synthetic-relationships.json','mimeType':'application/json','buffer':portable.encode()})
                    await page.locator('#confirmImport').wait_for()
                    await page.click('#confirmImport')
                    await page.locator('#importPreview').wait_for(state='hidden')
                    await page.reload()
                    await page.locator('.milestone-toast').wait_for(state='attached')
                result = await page.evaluate(check)
                portable = result.pop('backup')
                phases.append({'phase':phase, **result})
            protection = await page.evaluate('''async()=>{
             const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),old=await s.loadVault(db),fresh=await s.loadVault(db);fresh.relationships[0].labels.push('PRIVATE_A_NEWER');await s.saveVaultAtomic(db,fresh);const before=JSON.stringify(await s.loadVault(db));let error;try{await s.saveVaultAtomic(db,old);}catch(e){error=e;}if(error?.code!=='VESPER_VAULT_CONFLICT'||!error.refreshRequired||JSON.stringify(await s.loadVault(db))!==before)throw new Error('Stale relationship save changed data');return true;
            }''')
            await page.reload()
            await page.locator('.milestone-toast').wait_for(state='attached')
            await page.evaluate(check)
            assert not errors, errors
            print(json.dumps({'device':device,'phases':phases,'staleConflict':protection,'conflictReload':True,'pageErrors':errors}), flush=True)
            await context.close()
        await browser.close()

asyncio.run(run())

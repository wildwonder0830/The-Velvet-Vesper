# Run: python test/cross-story-forgotten-memory.browser.py (Playwright/Chromium required).
import asyncio, functools, http.server, json, pathlib, threading
from playwright.async_api import async_playwright

root = pathlib.Path(__file__).resolve().parents[1]
server = http.server.ThreadingHTTPServer(
    ('127.0.0.1', 8776),
    functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root)),
)
threading.Thread(target=server.serve_forever, daemon=True).start()

fixture = '''async()=>{
 const s=await import('./src/storage/vault-store.js'),{emptyVault}=await import('./src/schema.js'),{seedDefaultGreenLines}=await import('./src/rules/preference-lines.js');
 const v=emptyVault('2026-01-01T00:00:00Z');v.preferenceLines=seedDefaultGreenLines();
 v.personas=[{id:'p',name:'Amanda'}];v.characters=[{id:'x',name:'Character'}];
 v.stories=['a','b','c'].map(id=>({id,title:'Synthetic '+id,personaId:'p',characterIds:['x']}));
 v.chats=['a','b','c'].map(id=>({id:'chat-'+id,storyId:id}));
 v.messages=[{id:'origin',storyId:'a',chatId:'chat-a',role:'user',ordinal:0,text:'Original private destination.'},{id:'safe-message',storyId:'b',chatId:'chat-b',role:'user',ordinal:0,text:'The garden is open.'},{id:'old',storyId:'b',chatId:'chat-b',role:'assistant',ordinal:1,text:'An old response.'}];
 v.memoryEntries=[{id:'root',storyId:'a',kind:'canon',status:'active',text:'Original private destination.',sourceMessageIds:['origin']},{id:'derived',storyId:'b',kind:'canon',status:'active',text:'DERIVED_B: A concealed refuge was established.',sourceMemoryIds:['root']},{id:'transitive',storyId:'c',kind:'character',status:'active',text:'DERIVED_C: He knows the refuge.',sourceMemoryIds:['derived']},{id:'summary',storyId:'b',chatId:'chat-b',kind:'summary',status:'active',text:'DERIVED_SUMMARY: Their concealed refuge matters.',sourceMemoryIds:['transitive']},{id:'safe',storyId:'b',kind:'canon',status:'active',text:'INDEPENDENT_B: The garden is open.'},{id:'safe-summary',storyId:'b',chatId:'chat-b',kind:'summary',status:'active',text:'The garden is open.',sourceMessageIds:['safe-message']},{id:'branch',storyId:'b',kind:'canon',status:'active',text:'BRANCH_OBSOLETE',sourceMessageIds:['old']}];
 await s.replaceVaultAtomic(await s.openVesperDb(),v);localStorage.setItem('vesper.secret.openrouter-api-key','synthetic-key');
 const m=await import('./src/memory/memory-manager.js'),db=await s.openVesperDb(),loaded=await s.loadVault(db),history=JSON.stringify(loaded.memoryEntries.filter(m=>m.storyId!=='a'));
 loaded.memoryEntries=m.forgetMemory(loaded.memoryEntries,'root');if(JSON.stringify(loaded.memoryEntries.filter(m=>m.storyId!=='a'))!==history)throw new Error('Cross-story history changed');await s.saveVaultAtomic(db,loaded);
}'''

check = '''async()=>{
 const s=await import('./src/storage/vault-store.js'),m=await import('./src/memory/memory-manager.js'),{buildStoryContext}=await import('./src/prompt/context-builder.js'),{assemblePrompt}=await import('./src/prompt/prompt-assembler.js'),{runTurn}=await import('./src/chat/turn-engine.js'),b=await import('./src/backup/vesper-backup.js');
 const db=await s.openVesperDb(),v=await s.loadVault(db),before=JSON.stringify(v),assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
 for(const id of ['b','c'])for(const value of [m.activeMemory(v.memoryEntries,id),buildStoryContext(v,id,'chat-'+id),assemblePrompt({vault:v,storyId:id,chatId:'chat-'+id})])assert(!JSON.stringify(value).includes('DERIVED_'),'Cross-story leak '+id);
 const p=assemblePrompt({vault:v,storyId:'b',chatId:'chat-b'});assert(p.memory.some(m=>m.id==='safe'),'Unrelated memory lost');assert(p.memory.some(m=>m.id==='safe-summary'),'Safe source-backed summary lost');
 assert(v.memoryEntries.find(m=>m.id==='root').status==='forgotten','Forgotten state lost');assert(v.memoryEntries.find(m=>m.id==='derived').status==='active','Historical derivative changed');
 const previous=globalThis.fetch,bodies=[];globalThis.fetch=async(url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:bodies.length===1?'Amanda decided to leave.':'The evening settled quietly.'}}]})};};
 try{await runTurn({vault:v,storyId:'b',chatId:'chat-b',model:'synthetic'});assert(bodies.length===2,'Repair not exercised');for(const body of bodies){assert(!JSON.stringify(body).includes('DERIVED_'),'Provider or repair leak');assert(JSON.stringify(body).includes('INDEPENDENT_B'),'Safe provider context missing');}}finally{globalThis.fetch=previous;}
 assert(JSON.stringify(await s.loadVault(db))===before,'Model projection mutated persisted data');
 const portable=b.serializePortableBackup(v);b.parseVesperBackup(portable);return {backup:portable,providerAndRepair:true,safeSummary:true,historicalRecords:true};
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
            await page.goto('http://127.0.0.1:8776/')
            await page.locator('.milestone-toast').wait_for(state='attached')
            await page.evaluate(fixture)
            await page.reload()
            await page.locator('.milestone-toast').wait_for(state='attached')
            phases = []
            for phase in ['seed', 'story-switch', 'reload', 'update', 'restore']:
                if phase == 'story-switch':
                    await page.click('#storyNavButton')
                    for story in ['b', 'c', 'a', 'b']:
                        await page.select_option('#storyPicker', story)
                elif phase == 'reload':
                    await page.reload()
                    await page.locator('.milestone-toast').wait_for(state='attached')
                elif phase == 'update':
                    await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb(),v=await s.loadVault(db);v.memoryEntries.push({id:'updated-derivative',storyId:'b',kind:'canon',status:'active',text:'DERIVED_UPDATE',sourceMemoryIds:['summary']});await s.saveVaultAtomic(db,v);}")
                elif phase == 'restore':
                    # Direct fixture writes advance the revision; refresh the UI
                    # before intentionally restoring through its import handler.
                    await page.reload()
                    await page.locator('.milestone-toast').wait_for(state='attached')
                    await page.click('#libraryNavButton')
                    await page.locator('#importFile').set_input_files({'name':'synthetic-cross-story.json','mimeType':'application/json','buffer':portable.encode()})
                    await page.locator('#confirmImport').wait_for()
                    await page.click('#confirmImport')
                    await page.locator('#importPreview').wait_for(state='hidden')
                    await page.reload()
                    await page.locator('.milestone-toast').wait_for(state='attached')
                result = await page.evaluate(check)
                portable = result.pop('backup')
                phases.append({'phase':phase, **result})

            protection = await page.evaluate('''async()=>{
             const s=await import('./src/storage/vault-store.js'),r=await import('./src/chat/regeneration.js'),b=await import('./src/backup/vesper-backup.js'),db=await s.openVesperDb(),assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
             const stale=await s.loadVault(db),plan=r.prepareVaultRegeneration(stale,'old'),newer=await s.loadVault(db);newer.memoryEntries.push({id:'new-safe',storyId:'b',kind:'character',status:'active',text:'An unrelated update.'});await s.saveVaultAtomic(db,newer);const before=JSON.stringify(await s.loadVault(db));
             const candidate=r.completeVaultRegeneration(plan,{id:'new',storyId:'b',chatId:'chat-b',role:'assistant',ordinal:1,text:'A replacement.'});let error;try{await s.saveVaultAtomic(db,candidate,{expectedRevision:plan.expectedRevision});}catch(e){error=e;}
             assert(error?.code==='VESPER_VAULT_CONFLICT'&&error.refreshRequired===true,'Missing regeneration conflict');assert(JSON.stringify(await s.loadVault(db))===before,'Stale regeneration modified vault');
             const fresh=r.prepareVaultRegeneration(await s.loadVault(db),'old');await s.saveVaultAtomic(db,r.completeVaultRegeneration(fresh,{id:'new',storyId:'b',chatId:'chat-b',role:'assistant',ordinal:1,text:'A replacement.'}),{expectedRevision:fresh.expectedRevision});
             const saved=await s.loadVault(db);assert(!saved.memoryEntries.some(m=>m.id==='branch'),'Obsolete branch memory retained');assert(saved.memoryEntries.find(m=>m.id==='root').status==='forgotten','Regeneration lost tombstone');b.parseVesperBackup(b.serializePortableBackup(saved));return {staleConflict:true,regeneration:true};
            }''')
            await page.reload()
            await page.locator('.milestone-toast').wait_for(state='attached')
            await page.evaluate(check)
            restored = await page.evaluate('''async()=>{
             const s=await import('./src/storage/vault-store.js'),{assemblePrompt}=await import('./src/prompt/prompt-assembler.js'),db=await s.openVesperDb(),v=await s.loadVault(db),root=v.memoryEntries.find(m=>m.id==='root');root.status='active';delete root.forgottenAt;delete root.forgetReason;await s.saveVaultAtomic(db,v);
             for(const [story,id] of [['b','derived'],['c','transitive'],['b','summary']])if(!assemblePrompt({vault:await s.loadVault(db),storyId:story,chatId:'chat-'+story}).memory.some(m=>m.id===id))throw new Error('Explicit restoration failed '+id);return true;
            }''')
            await page.reload()
            await page.locator('.milestone-toast').wait_for(state='attached')
            assert await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),{activeMemory}=await import('./src/memory/memory-manager.js');return activeMemory((await s.loadVault(await s.openVesperDb())).memoryEntries,'b').some(m=>m.id==='derived');}")
            assert not errors, errors
            print(json.dumps({'device':device,'phases':phases,**protection,'explicitRestore':restored,'restoreReload':True,'pageErrors':errors}), flush=True)
            await context.close()
        await browser.close()

asyncio.run(run())

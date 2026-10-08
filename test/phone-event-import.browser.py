"""Event-ledger acceptance in disposable Chromium contexts. No provider requests.
The private verified package/backup are supplied locally, never served as assets.
"""
import asyncio,functools,http.server,json,os,pathlib,threading
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[1]
fixture=pathlib.Path(os.environ['VESPER_PHONE_EVENT_FIXTURE_DIR'])
paths=json.loads((fixture/'source-hashes.json').read_text())
backup=json.loads(pathlib.Path(next(p for p in paths if p.endswith('.json'))).read_text())
# Do not place credentials in even disposable browser storage.
secret={'apiKey','api_key','openRouterKey','openrouterKey','authorization','token','secret'}
def clean(x):
 if isinstance(x,list):return [clean(v) for v in x]
 if isinstance(x,dict):return {k:clean(v) for k,v in x.items() if k not in secret}
 return x
backup=clean(backup)
package=json.loads((fixture/'verified-package.private.json').read_text())
# Existing archival contacts/nicknames are synthetic challenges on the copy.
story=next(s for s in backup['stories'] if s['id']==package['entries'][0]['claim']['event']['storyId'])
contacts={c['id']:c for e in package['entries'] for c in e['claim']['contacts']}
story['phone']['historicalContacts']=[dict(c,canonicalName=c['canonicalName'].upper()) for c in contacts.values()]
for c in contacts.values():story['phone']['contactDisplayNames'][c['id']]='Synthetic preserved nickname'
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}/'
exercise=r"""async ({vault,packageData})=>{
 const st=await import('./src/storage/vault-store.js'),adapter=await import('./src/phone/phone-event-import.js'),backup=await import('./src/backup/vesper-backup.js'),evidence=await import('./src/phone/phone-event-evidence.js'),phone=await import('./src/phone/phone-context.js');
 const assert=(v,m)=>{if(!v)throw new Error('Adapter browser assertion: '+m);};
 const db=await st.openVesperDb(),initial=await st.loadVault(db);await st.saveVaultAtomic(db,vault,{expectedRevision:initial.storageRevision});
 const original=await st.loadVault(db),preview=adapter.previewPhoneEvents(original,packageData);
 assert(preview.accepted.length===1462&&preview.excluded.length===0,'all ledger events');
 // Abort the actual transaction after its first put, not a mock transaction.
 const put=IDBObjectStore.prototype.put;let aborted=false;
 IDBObjectStore.prototype.put=function(value,key){const r=put.call(this,value,key);if(key==='active'){aborted=true;queueMicrotask(()=>this.transaction.abort());}return r;};
 let abortError=false;try{await adapter.commitPhoneEvents(db,original,preview,{confirmed:true,onCheckpoint:()=>{}});}catch{abortError=true;}finally{IDBObjectStore.prototype.put=put;}
 assert(aborted&&abortError,'real transaction aborted');assert(JSON.stringify(await st.loadVault(db))===JSON.stringify(original),'abort preserved vault');
 let checkpoint;
 const saved=await adapter.commitPhoneEvents(db,original,preview,{confirmed:true,onCheckpoint:value=>{checkpoint=value;assert(evidence.sha256(value.text)===value.sha256,'checkpoint digest');backup.parseVesperBackup(value.text);}});
 const story=saved.stories.find(s=>s.id===packageData.entries[0].claim.event.storyId),threads=story.phone.threads,ms=threads.flatMap(t=>t.messages);
 assert(ms.length===1462&&threads.length===8,'eight persisted threads');assert(JSON.stringify(story.phone.historicalContacts)===JSON.stringify(original.stories.find(s=>s.id===story.id).phone.historicalContacts),'existing contacts preserved');assert(JSON.stringify(story.phone.contactDisplayNames)===JSON.stringify(original.stories.find(s=>s.id===story.id).phone.contactDisplayNames),'nicknames preserved');assert(threads.find(t=>t.kind==='private'&&t.participantIds.includes('character_210ff3ee-5474-4f85-aa2d-20e1e604202e')).messages.length===76,'Lucien private');
 let privacy=0;
 for(const t of threads)for(const m of t.messages){assert(evidence.eventSourceCurrent(m,saved),'current evidence');assert(m.audienceIds.includes(m.senderId),'sender participant');if(t.kind==='private')assert(m.audienceIds.length===2,'private audience');privacy++;}
 const dane='character_2773068d-0acf-436a-97ba-5f982810d648';
 const systems=ms.find(m=>m.recovery.sourceOrdinal===80).recovery.claim.historicalSystemEvents,leave=systems.find(e=>e.type==='leave'&&e.sourceOrdinal===80),rejoin=systems.find(e=>e.type==='join'&&e.sourceMessageId===leave.sourceMessageId&&e.start>leave.end);assert(leave&&rejoin,'documented membership interval');const absence=ms.filter(m=>m.recovery.claim.kind==='group'&&m.recovery.sourceMessageId===leave.sourceMessageId&&m.recovery.start>=leave.end&&m.recovery.start<rejoin.start);assert(absence.length===2&&absence.every(m=>!phone.phoneMessageVisible(saved,m,[dane])),'historical absence');
 const otherChat=saved.chats.find(c=>c.storyId!==story.id);assert(phone.buildPhoneContext(saved,{storyId:otherChat.storyId,chatId:otherChat.id,respondingCharacterIds:story.characterIds}).length===0,'cross story isolation');
 const repeat=adapter.previewPhoneEvents(saved,packageData);assert(repeat.accepted.length===0&&repeat.duplicates.length===1462,'idempotence');
 let conflict=false;try{await adapter.commitPhoneEvents(db,original,preview,{confirmed:true,onCheckpoint:()=>{}});}catch(e){conflict=e.code==='VESPER_VAULT_CONFLICT'&&e.refreshRequired===true;}assert(conflict,'stale conflict');assert(JSON.stringify(await st.loadVault(db))===JSON.stringify(saved),'conflict unchanged');
 const portable=backup.buildPortableBackup(saved),restored=backup.parseVesperBackup(JSON.stringify(portable));assert(JSON.stringify(restored.stories)===JSON.stringify(saved.stories),'backup restore');
 const checkpointVault=backup.parseVesperBackup(checkpoint.text);await st.replaceVaultAtomic(db,checkpointVault,{expectedRevision:saved.storageRevision});const rolled=await st.loadVault(db);assert(JSON.stringify(rolled.stories)===JSON.stringify(original.stories),'rollback');
 const repeatAfterRollback=adapter.previewPhoneEvents(rolled,packageData);await adapter.commitPhoneEvents(db,rolled,repeatAfterRollback,{confirmed:true,onCheckpoint:()=>{}});
 localStorage.setItem('vesper.ui.lastTab','story');localStorage.setItem('vesper.ui.lastStoryId',story.id);
 return {accepted:1462,excluded:0,threads:8,lucienPrivate:76,privacyChecks:privacy,actualIndexedDB:true,realAbort:true,staleConflict:true,verifiedCheckpoint:true,rollback:true,backupRestore:true,repeatAdds:0};
}"""
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for device in ['Desktop','iPhone 13','iPad (gen 7)']:
   opts={} if device=='Desktop' else p.devices[device].copy();opts.pop('default_browser_type',None)
   ctx=await browser.new_context(**opts);page=await ctx.new_page();errors=[];external=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   async def route(r):
    if r.request.url.startswith(base):await r.continue_()
    else:external.append(r.request.url);await r.abort()
   await ctx.route('**/*',route)
   await page.goto(base);await page.locator('#libraryNavButton').wait_for()
   result=await page.evaluate(exercise,{'vault':backup,'packageData':package})
   await page.reload();await page.locator('#storyPhoneButton').wait_for();await page.wait_for_timeout(650)
   scroll_before=await page.evaluate('[scrollY,document.getElementById("messages").scrollTop]')
   await page.click('#storyPhoneButton');await page.locator('#storyPhoneOverlay').wait_for(state='visible')
   await page.click('#phoneChats');assert await page.locator('[data-phone-thread]').count()==8
   await page.locator('[data-phone-thread]').first.click();await page.locator('.phone-transcript').wait_for()
   await page.click('#phoneChats')
   ids=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),v=await s.loadVault(await s.openVesperDb()),ts=v.stories.flatMap(s=>s.phone?.threads||[]);return {group:ts.find(t=>t.kind==='group'&&t.messages.length===1219).id,lucien:ts.find(t=>t.kind==='private'&&t.participantIds.includes('character_210ff3ee-5474-4f85-aa2d-20e1e604202e')).id};}")
   await page.locator('[data-phone-thread]').evaluate_all('(els,id)=>els.find(e=>e.dataset.phoneThread===id).click()',ids['lucien'])
   assert await page.locator('.phone-bubble').count()==76
   await page.click('#phoneChats');await page.locator('[data-phone-thread]').evaluate_all('(els,id)=>els.find(e=>e.dataset.phoneThread===id).click()',ids['group'])
   assert await page.locator('.phone-bubble').count()==1219
   await page.fill('#phoneMessageInput','Synthetic unsent draft');await page.locator('#phoneMessageInput').focus()
   assert await page.evaluate("document.getElementById('phoneMessageInput').getBoundingClientRect().bottom<=document.getElementById('storyPhoneOverlay').getBoundingClientRect().bottom+1")
   assert await page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
   await page.click('#phoneClose');assert not await page.locator('#storyPhoneOverlay').is_visible()
   assert all(abs(a-b)<2 for a,b in zip(scroll_before,await page.evaluate('[scrollY,document.getElementById("messages").scrollTop]')))
   await page.click('#storyPhoneButton');await page.locator('#phoneMessageInput').wait_for();assert await page.input_value('#phoneMessageInput')=='Synthetic unsent draft';await page.click('#phoneClose')
   counts=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),a=await import('./src/phone/phone-event-import.js'),v=await s.loadVault(await s.openVesperDb());return v.stories.flatMap(s=>s.phone?.threads||[]).flatMap(t=>t.messages).length;}")
   assert counts==1462
   # Exercise the actual optional phone-preview integration, not just the API.
   await page.evaluate("async v=>{const s=await import('./src/storage/vault-store.js'),db=await s.openVesperDb();await s.saveVaultAtomic(db,v,{expectedRevision:(await s.loadVault(db)).storageRevision});}",backup)
   await page.reload();await page.locator('#storyPhoneButton').wait_for();await page.click('#storyPhoneButton');await page.click('#phoneSync')
   await page.locator('#phoneEventPackage').wait_for()
   before_digest=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),e=await import('./src/phone/phone-event-evidence.js');return e.sha256(JSON.stringify(await s.loadVault(await s.openVesperDb())));}")
   await page.locator('#phoneEventPackage').set_input_files(str(fixture/'verified-package.private.json'))
   await page.locator('#phoneEventConfirm').wait_for();assert await page.locator('#phoneEventConfirm').is_disabled()
   after_digest=await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),e=await import('./src/phone/phone-event-evidence.js');return e.sha256(JSON.stringify(await s.loadVault(await s.openVesperDb())));}")
   assert before_digest==after_digest
   assert '1462 accepted' in await page.locator('#phoneHistoryPreview').inner_text()
   assert await page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
   assert await page.locator('#phoneEventBackupSaved').is_disabled()
   async with page.expect_download() as download_info:
    await page.click('#phoneEventBackup')
   download=await download_info.value
   checkpoint_text=pathlib.Path(await download.path()).read_text()
   assert await page.evaluate("async text=>{const b=await import('./src/backup/vesper-backup.js');return !!b.parseVesperBackup(text);}",checkpoint_text)
   await page.check('#phoneEventBackupSaved');await page.click('#phoneEventConfirm')
   await page.locator('#phoneHistoryPreview').wait_for(state='hidden')
   assert await page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js'),v=await s.loadVault(await s.openVesperDb());return v.stories.flatMap(s=>s.phone?.threads||[]).flatMap(t=>t.messages).length;}")==1462
   await page.click('#phoneSync');await page.locator('#phoneEventPackage').set_input_files(str(fixture/'verified-package.private.json'));await page.locator('#phoneEventConfirm').wait_for()
   assert '1462 already present' in await page.locator('#phoneHistoryPreview').inner_text();assert await page.locator('#phoneEventConfirm').is_disabled()
   await page.click('#phoneHistoryCancel');await page.click('#phoneClose')
   # Separate browser contexts have independent storage; this is not a claim
   # about native iOS Safari versus Home Screen web-app storage behavior.
   clean_ctx=await browser.new_context(**opts);clean_page=await clean_ctx.new_page();await clean_page.goto(base)
   assert await clean_page.evaluate("async()=>{const s=await import('./src/storage/vault-store.js');return (await s.loadVault(await s.openVesperDb())).stories.length;}")==0
   await clean_ctx.close();assert not errors,errors
   assert not any('openrouter' in u.lower() for u in external)
   result.update({'device':device,'reload':True,'phoneOverlay':True,'lucienAndGroupRender':True,'composerAndDraftAccessible':True,'storyScrollPreserved':True,'noHorizontalOverflow':True,'isolatedBrowserContexts':True,'uncaughtErrors':0,'paidRequests':0,'optionalLedgerPreview':True,'backupDownloadVerified':True,'explicitConfirmation':True,'uiRepeatAdds':0})
   print(json.dumps(result),flush=True);await ctx.close()
  await browser.close()
asyncio.run(run())

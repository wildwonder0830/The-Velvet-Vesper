import {ensureStoryPhone,getPhoneContacts,openPrivateThread,updatePhoneThread,setContactDisplayName,markPhoneThreadRead,phoneUnreadCount} from '../phone/phone-state.js';
import {orderedPhoneMessages,isPhoneMessageUnread} from '../phone/phone-state.js';
import {scanPhoneHistory,resolvePhoneHistoryCandidate,applyPhoneHistory} from '../phone/phone-history.js';

const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
export function createStoryPhone({getSnapshot,commitCandidate,sendPhoneMessage,cancelStoryScroll,isBusy=()=>false,onError=()=>{}}) {
  const launcher=node('button','☎','story-phone-launcher');launcher.id='storyPhoneButton';launcher.type='button';launcher.setAttribute('aria-label','Open story phone');launcher.setAttribute('aria-haspopup','dialog');
  const badge=node('span','','phone-badge');launcher.append(badge);document.body.append(launcher);
  const overlay=node('div',undefined,'story-phone-overlay');overlay.id='storyPhoneOverlay';overlay.hidden=true;
  overlay.innerHTML='<section class="story-phone" role="dialog" aria-modal="true" aria-labelledby="phoneHeading"><header><h2 id="phoneHeading">Story Phone</h2><button id="phoneClose" type="button" aria-label="Close story phone">✕</button></header><nav aria-label="Phone sections"><button id="phoneChats" type="button">Chats</button><button id="phoneContacts" type="button">Contacts</button></nav><p id="phoneNotice" role="status" hidden></p><div id="phoneContent" class="phone-content"></div></section>';
  document.body.append(overlay);
  const sync=node('button','Sync Existing Messages','phone-sync-trigger');sync.id='phoneSync';sync.type='button';overlay.querySelector('nav').after(sync);
  const find=id=>overlay.querySelector('#'+id),content=find('phoneContent');
  const drafts=new Map(),selections=new Map();let storyId=null,threadId=null,tab='chats',editing=false,working=false,scrollState=null,previousFocus=null;
  let historyPreview=null,historySelection=new Set(),historyResolutions={},resolvingKey=null;
  const story=()=>getSnapshot().vault.stories.find(s=>s.id===storyId);
  const draftKey=()=>JSON.stringify([storyId,threadId]);
  const contacts=()=>getPhoneContacts(getSnapshot().vault,storyId);
  const label=id=>contacts().find(c=>c.id===id)?.displayName || getSnapshot().vault.characters.find(c=>c.id===id)?.name || getSnapshot().vault.personas.find(p=>p.id===id)?.name || 'Unavailable contact';
  function notice(text){find('phoneNotice').textContent=text;find('phoneNotice').hidden=!text;}
  function captureDraft(){const input=find('phoneMessageInput');if(input&&threadId)drafts.set(draftKey(),input.value);}
  function button(text,action){const b=node('button',text);b.type='button';b.onclick=()=>perform(action);return b;}
  async function perform(action){if(working||isBusy()){notice('Wait for the current request or save to finish.');if(overlay.hidden)onError('Wait for the current request or save to finish.');return;}working=true;notice('');try{await action();}catch(e){const message=e?.refreshRequired?'Newer data was saved. Reload to refresh before retrying.':e?.message||'Phone operation could not finish. Your saved data was kept.';notice(message);if(overlay.hidden)onError(message);}finally{working=false;}}
  async function save(next,revision){await commitCandidate(next,revision);}
  function clearPreview(){historyPreview=null;historySelection=new Set();historyResolutions={};resolvingKey=null;}
  function focusHistorySelection(key){[...content.querySelectorAll('[data-history-select]')].find(el=>el.dataset.historySelect===key)?.focus({preventScroll:true});}
  function startSync(){captureDraft();const snap=getSnapshot();historyPreview=scanPhoneHistory(snap.vault,storyId);historySelection=new Set(historyPreview.candidates.filter(c=>c.status==='ready').map(c=>c.key));historyResolutions={};resolvingKey=null;render();find('phoneHistoryPreview').focus({preventScroll:true});}
  const unrecoverable=c=>c.issues.some(i=>['recipients','continuation','time','delivery'].includes(i));
  function renderHistoryResolution(candidate,card){
    const form=node('form',undefined,'phone-history-resolution'),values={identities:{}};
    for(const [name,id] of Object.entries(candidate.identities))if(!id){const l=node('label','Canonical identity for '+name),select=node('select');select.dataset.historyIdentity=name;select.required=true;select.append(new Option('Choose a source-supported identity',''));
      const persona=getSnapshot().vault.personas.find(p=>p.id===story().personaId);for(const c of [persona,...contacts().map(c=>({id:c.id,name:c.canonicalName}))])if(c)select.append(new Option(c.name,c.id));l.append(select);form.append(l);}
    if(candidate.issues.includes('thread')){const l=node('label','Existing group confirmed by this source'),select=node('select');select.id='phoneHistoryTarget';select.required=true;select.append(new Option('Choose the matching group',''));for(const t of story().phone.threads.filter(t=>t.chatId===candidate.chatId&&t.kind==='group'))select.append(new Option(t.title,t.id));l.append(select);form.append(l);}
    if(candidate.issues.includes('repeat')){const l=node('label','This is a separate sent text, not a quotation or repeated mention.'),check=node('input');check.type='checkbox';check.id='phoneHistoryDistinct';check.required=true;l.prepend(check);form.append(l);}
    const l=node('label','I confirm these identities and this conversation are supported by the source. This grants no additional recipients.'),check=node('input');check.type='checkbox';check.id='phoneHistoryEvidenceConfirm';check.required=true;l.prepend(check);form.append(l);
    const submit=node('button','Resolve match');submit.type='submit';submit.id='phoneHistoryResolveSave';form.append(submit,button('Cancel resolution',()=>{resolvingKey=null;render();focusHistorySelection(candidate.key);}));
    form.onsubmit=e=>{e.preventDefault();perform(()=>{for(const el of form.querySelectorAll('[data-history-identity]'))Object.defineProperty(values.identities,el.dataset.historyIdentity,{value:el.value,enumerable:true});values.confirmed=check.checked;values.distinct=Boolean(form.querySelector('#phoneHistoryDistinct')?.checked);values.targetThreadId=form.querySelector('#phoneHistoryTarget')?.value;resolvePhoneHistoryCandidate(getSnapshot().vault,candidate,values);historyResolutions[candidate.key]=values;historySelection.add(candidate.key);resolvingKey=null;render();focusHistorySelection(candidate.key);});};card.append(form);
  }
  function renderHistory(){
    const preview=node('section',undefined,'phone-history-preview');preview.id='phoneHistoryPreview';preview.tabIndex=-1;preview.append(node('h3','Review recovered texts'),node('p','Nothing is saved until you confirm. Source order is preserved; unknown send times and missing recipients are never inferred.'),node('p',`${historyPreview.duplicateCount} already recovered · ${historyPreview.candidates.length} matches to review`));
    for(const [status,title,id] of [['ready','Recoverable messages','phoneHistoryReady'],['uncertain','Uncertain matches — explicit resolution required','phoneHistoryUncertain']]){
      const section=node('section');section.id=id;section.append(node('h4',title));
      for(const candidate of historyPreview.candidates.filter(c=>c.status===status)){
        const card=node('article',undefined,'phone-history-candidate');card.dataset.historyCandidate=candidate.key;
        const include=node('label','Include this message'),check=node('input');check.type='checkbox';check.dataset.historySelect=candidate.key;check.checked=historySelection.has(candidate.key);check.disabled=unrecoverable(candidate);check.onchange=()=>{check.checked?historySelection.add(candidate.key):historySelection.delete(candidate.key);render();[...content.querySelectorAll('[data-history-select]')].find(el=>el.dataset.historySelect===candidate.key)?.focus({preventScroll:true});};include.prepend(check);card.append(include,node('strong',candidate.senderLabel+' → '+(candidate.participantLabels.join(', ')||'Recipients unknown')),node('p',candidate.text,'phone-history-text'));
        const chat=getSnapshot().vault.chats.find(c=>c.id===candidate.chatId);card.append(node('small',(chat?.title||candidate.chatId)+' · '+(candidate.timestampText||'Time unknown')));
        const source=node('details'),summary=node('summary','View source excerpt'),excerpt=node('pre',candidate.excerpt);source.append(summary,excerpt);card.append(source);
        if(status==='uncertain'){
          card.append(node('p',unrecoverable(candidate)?'Incomplete recipients, ambiguous text boundaries, unsupported time notation, or unconfirmed delivery: excluded until the source can establish a complete sent exchange.':'Review required: '+candidate.issues.join(', ')));
          if(!unrecoverable(candidate)){const resolved=historyResolutions[candidate.key];if(resolved){const mappings=Object.entries(resolved.identities).map(([name,id])=>name+' → '+(getSnapshot().vault.characters.find(c=>c.id===id)?.name||getSnapshot().vault.personas.find(p=>p.id===id)?.name));card.append(node('small','Explicitly resolved'+(mappings.length?': '+mappings.join(' · '):'')));if(resolved.targetThreadId)card.append(node('small','Reviewed group: '+story().phone.threads.find(t=>t.id===resolved.targetThreadId)?.title));}const resolve=button('Resolve match',()=>{resolvingKey=candidate.key;render();content.querySelector('.phone-history-resolution select, .phone-history-resolution input')?.focus({preventScroll:true});});resolve.dataset.historyResolve=candidate.key;card.append(resolve);if(resolvingKey===candidate.key)renderHistoryResolution(candidate,card);}
        }
        section.append(card);
      }
      preview.append(section);
    }
    const controls=node('div',undefined,'phone-history-actions');controls.append(button('Cancel',()=>{clearPreview();render();sync.focus({preventScroll:true});}));controls.firstChild.id='phoneHistoryCancel';
    const confirm=button('Confirm selected messages',async()=>{const snap=getSnapshot(),next=applyPhoneHistory(snap.vault,historyPreview,{confirmed:true,selectedKeys:[...historySelection],resolutions:historyResolutions});if(next!==snap.vault)await save(next,historyPreview.baseRevision);clearPreview();render();notice('Selected historical messages saved. No AI request was made.');if(!overlay.hidden)sync.focus({preventScroll:true});});confirm.id='phoneHistoryConfirm';confirm.disabled=!historySelection.size||historyPreview.candidates.some(c=>historySelection.has(c.key)&&c.status==='uncertain'&&!historyResolutions[c.key]);controls.append(confirm);preview.append(controls);content.append(preview);
  }
  async function viewThread(id){captureDraft();threadId=id;selections.set(storyId,id);tab='chats';editing=false;
    const snap=getSnapshot(),s=story(),t=s?.phone?.threads.find(t=>t.id===id);
    if(t?.messages.some(m=>isPhoneMessageUnread(m,t))&&!isBusy())await save(markPhoneThreadRead(snap.vault,storyId,id),snap.revision);
    render();}
  function renderContacts(){for(const c of contacts()){
    const row=node('section',undefined,'phone-contact');const open=button(c.displayName,async()=>{const snap=getSnapshot();const result=openPrivateThread(snap.vault,storyId,snap.chatId,c.id);if(JSON.stringify(result.vault)!==JSON.stringify(snap.vault))await save(result.vault,snap.revision);await viewThread(result.threadId);});open.dataset.phoneContact=c.id;
    const canonical=node('small',c.canonicalName);const name=node('input');name.value=story().phone.contactDisplayNames[c.id]||'';name.placeholder='Contact nickname';name.maxLength=120;name.dataset.phoneNickname=c.id;name.setAttribute('aria-label','Nickname for '+c.canonicalName);
    const update=button('Save nickname',async()=>{const snap=getSnapshot();await save(setContactDisplayName(snap.vault,storyId,c.id,name.value),snap.revision);render();});update.dataset.phoneNicknameSave=c.id;
    row.append(open,canonical,name,update);content.append(row);
  }if(!contacts().length)content.append(node('p','No character contacts in this story.'));}
  function renderList(){const threads=story()?.phone?.threads||[];
    for(const t of threads){const unread=t.messages.filter(m=>isPhoneMessageUnread(m,t)).length,latest=orderedPhoneMessages(t).at(-1);
      const row=button('',()=>viewThread(t.id));row.className='phone-thread-row';row.dataset.phoneThread=t.id;
      row.append(node('strong',t.kind==='private'?label(t.participantIds[0]):t.title),node('small',t.participantIds.map(label).join(' · ')),node('span',latest?.text.slice(0,100)||'No messages yet.'));
      const chat=getSnapshot().vault.chats.find(c=>c.id===t.chatId);row.append(node('small',(chat?.title||'Story conversation '+(getSnapshot().vault.chats.filter(c=>c.storyId===storyId).findIndex(c=>c.id===t.chatId)+1))+' · '+(latest?.recovery?(latest.recovery.timestampText||'Time unknown'):latest?.createdAt?new Date(latest.createdAt).toLocaleString():'')));
      if(unread)row.append(node('span',String(unread)+' unread','phone-unread'));content.append(row);
    }if(!threads.length)content.append(node('p','No chats yet. Open Contacts to start a conversation.'));
  }
  function renderEditor(t){const form=node('form',undefined,'phone-group-editor');
    const titleLabel=node('label','Group name');const title=node('input');title.id='phoneGroupTitle';title.value=t.title;title.maxLength=120;title.required=true;titleLabel.append(title);form.append(titleLabel);
    for(const c of contacts()){const l=node('label',undefined,'phone-member');const checkbox=node('input');checkbox.type='checkbox';checkbox.dataset.phoneMember=c.id;checkbox.checked=t.participantIds.includes(c.id);l.append(checkbox,node('span',c.displayName));form.append(l);}
    const submit=node('button','Save group');submit.id='phoneSaveGroup';submit.type='submit';form.append(submit,button('Cancel',()=>{editing=false;render();}));
    form.onsubmit=e=>{e.preventDefault();perform(async()=>{const snap=getSnapshot(),ids=[...form.querySelectorAll('input[type=checkbox]:checked')].map(c=>c.dataset.phoneMember);await save(updatePhoneThread(snap.vault,storyId,t.id,{title:title.value,participantIds:ids}),snap.revision);editing=false;render();});};content.append(form);
  }
  function renderThread(t){const head=node('div',undefined,'phone-thread-heading');const back=button('Back',()=>{captureDraft();threadId=null;selections.delete(storyId);render();});
    const title=node('h3',t.kind==='private'?label(t.participantIds[0]):t.title);title.id='phoneThreadTitle';title.dataset.threadId=t.id;head.append(back,title);
    if(t.kind==='group'){const edit=button('Edit group',()=>{captureDraft();editing=true;render();});edit.id='phoneEditGroup';head.append(edit);}content.append(head);
    if(editing){renderEditor(t);return;}
    const transcript=node('div',undefined,'phone-transcript');transcript.setAttribute('role','log');transcript.setAttribute('aria-label','Phone messages');
    let recovered=false,native=false;for(const m of orderedPhoneMessages(t)){if(m.recovery&&!recovered){transcript.append(node('p','Recovered transcript history — source order; timing relative to live phone messages is unverified.','phone-history-divider'));recovered=true;}if(!m.recovery&&recovered&&!native){transcript.append(node('p','Live phone messages','phone-history-divider'));native=true;}const bubble=node('article',undefined,'phone-bubble '+m.senderType);bubble.append(node('strong',label(m.senderId)),node('p',m.text),node('small',m.recovery?(m.recovery.timestampText||'Time unknown'):new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})));transcript.append(bubble);}content.append(transcript);
    const form=node('form',undefined,'phone-composer'),input=node('textarea');input.id='phoneMessageInput';input.placeholder='Write a text message…';input.setAttribute('aria-label','Phone message');input.rows=2;input.maxLength=10000;input.value=drafts.get(draftKey())||'';input.oninput=()=>drafts.set(draftKey(),input.value);
    const send=node('button','Send');send.type='submit';send.id='phoneSend';const more=button('Continue',()=>dispatch('', 'continue'));more.id='phoneContinue';send.disabled=isBusy();more.disabled=isBusy();form.append(input,send,more);
    form.onsubmit=e=>{e.preventDefault();perform(()=>dispatch(input.value,'send'));};content.append(form);
    transcript.scrollTop=transcript.scrollHeight;
  }
  async function dispatch(text,action){captureDraft();const targetStory=storyId,targetThread=threadId;
    if(action==='send'&&!text.trim()){notice('Write a message first.');return;}
    try{await sendPhoneMessage({storyId:targetStory,threadId:targetThread,text,action,onSubmitted:()=>{notice('Vesper is replying…');if(action==='send'){drafts.delete(JSON.stringify([targetStory,targetThread]));if(storyId===targetStory&&threadId===targetThread){const input=find('phoneMessageInput');if(input)input.value='';}}if(storyId===targetStory&&threadId===targetThread)render();},isViewed:()=>!overlay.hidden&&storyId===targetStory&&threadId===targetThread&&tab==='chats'});notice('');}finally{if(!overlay.hidden)render();}
  }
  function render(){if(overlay.hidden)return;content.replaceChildren();content.classList.toggle('phone-thread-content',!historyPreview&&tab==='chats'&&Boolean(threadId));sync.hidden=Boolean(historyPreview);find('phoneHeading').textContent=(story()?.title||'Story')+' · Phone';
    find('phoneChats').setAttribute('aria-pressed',String(tab==='chats'));find('phoneContacts').setAttribute('aria-pressed',String(tab==='contacts'));
    if(historyPreview)renderHistory();else if(tab==='contacts')renderContacts();else {const t=story()?.phone?.threads.find(t=>t.id===threadId);if(t)renderThread(t);else{threadId=null;renderList();}}refreshBadge();}
  function refreshBadge(){const snap=getSnapshot(),s=snap.vault?.stories.find(s=>s.id===snap.storyId),count=phoneUnreadCount(s);badge.textContent=count>99?'99+':String(count);badge.hidden=!count;launcher.hidden=!snap.storyVisible||!snap.storyId;launcher.setAttribute('aria-label','Open story phone'+(count?`, ${count} unread`:''));}
  function resize(){if(overlay.hidden)return;const vv=window.visualViewport;overlay.style.top=(vv?.offsetTop||0)+'px';overlay.style.height=(vv?.height||window.innerHeight)+'px';}
  async function open(){await perform(async()=>{const snap=getSnapshot();if(!snap.storyVisible||!snap.storyId||!snap.chatId)return;
    const next=ensureStoryPhone(snap.vault,snap.storyId,snap.chatId);if(JSON.stringify(next)!==JSON.stringify(snap.vault))await save(next,snap.revision);
    if(getSnapshot().storyId!==snap.storyId||!getSnapshot().storyVisible)return;
    storyId=snap.storyId;threadId=selections.get(storyId)||null;tab='chats';editing=false;previousFocus=document.activeElement;cancelStoryScroll();
    scrollState={x:scrollX,y:scrollY,bodyStyle:document.body.getAttribute('style'),pane:document.getElementById('messages')?.scrollTop||0};
    document.body.style.position='fixed';document.body.style.top=-scrollState.y+'px';document.body.style.left=-scrollState.x+'px';document.body.style.width='100%';document.body.style.overflow='hidden';
    overlay.hidden=false;resize();if(threadId)await viewThread(threadId);else render();find('phoneClose').focus({preventScroll:true});
  });}
  function close(){if(overlay.hidden)return;captureDraft();clearPreview();overlay.hidden=true;
    if(scrollState){if(scrollState.bodyStyle===null)document.body.removeAttribute('style');else document.body.setAttribute('style',scrollState.bodyStyle);window.scrollTo(scrollState.x,scrollState.y);const pane=document.getElementById('messages');if(pane)pane.scrollTop=scrollState.pane;scrollState=null;}
    if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});refreshBadge();}
  function refresh(){refreshBadge();if(!overlay.hidden){const snap=getSnapshot();if(!snap.storyVisible||snap.storyId!==storyId)close();}}
  const keydown=e=>{if(overlay.hidden)return;if(e.key==='Escape'){e.preventDefault();close();}else if(e.key==='Tab'){const items=[...overlay.querySelectorAll('button,input,textarea,select,summary')].filter(el=>!el.disabled&&el.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  launcher.onclick=open;find('phoneClose').onclick=close;sync.onclick=()=>perform(startSync);find('phoneChats').onclick=()=>perform(()=>{captureDraft();clearPreview();tab='chats';threadId=null;editing=false;render();});find('phoneContacts').onclick=()=>perform(()=>{captureDraft();clearPreview();tab='contacts';editing=false;render();});
  overlay.addEventListener('click',e=>{if(e.target===overlay)close();});document.addEventListener('keydown',keydown);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);window.addEventListener('resize',resize);refreshBadge();
  return {open,close,refresh,destroy(){close();launcher.remove();overlay.remove();document.removeEventListener('keydown',keydown);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',resize);window.removeEventListener('resize',resize);}};
}

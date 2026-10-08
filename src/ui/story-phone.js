import {ensureStoryPhone,getPhoneContacts,openPrivateThread,updatePhoneThread,setContactDisplayName,markPhoneThreadRead,phoneUnreadCount} from '../phone/phone-state.js';

const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
export function createStoryPhone({getSnapshot,commitCandidate,sendPhoneMessage,cancelStoryScroll,isBusy=()=>false,onError=()=>{}}) {
  const launcher=node('button','☎','story-phone-launcher');launcher.id='storyPhoneButton';launcher.type='button';launcher.setAttribute('aria-label','Open story phone');launcher.setAttribute('aria-haspopup','dialog');
  const badge=node('span','','phone-badge');launcher.append(badge);document.body.append(launcher);
  const overlay=node('div',undefined,'story-phone-overlay');overlay.id='storyPhoneOverlay';overlay.hidden=true;
  overlay.innerHTML='<section class="story-phone" role="dialog" aria-modal="true" aria-labelledby="phoneHeading"><header><h2 id="phoneHeading">Story Phone</h2><button id="phoneClose" type="button" aria-label="Close story phone">✕</button></header><nav aria-label="Phone sections"><button id="phoneChats" type="button">Chats</button><button id="phoneContacts" type="button">Contacts</button></nav><p id="phoneNotice" role="status" hidden></p><div id="phoneContent" class="phone-content"></div></section>';
  document.body.append(overlay);
  const find=id=>overlay.querySelector('#'+id),content=find('phoneContent');
  const drafts=new Map(),selections=new Map();let storyId=null,threadId=null,tab='chats',editing=false,working=false,scrollState=null,previousFocus=null;
  const story=()=>getSnapshot().vault.stories.find(s=>s.id===storyId);
  const draftKey=()=>JSON.stringify([storyId,threadId]);
  const contacts=()=>getPhoneContacts(getSnapshot().vault,storyId);
  const label=id=>contacts().find(c=>c.id===id)?.displayName || getSnapshot().vault.characters.find(c=>c.id===id)?.name || getSnapshot().vault.personas.find(p=>p.id===id)?.name || 'Unavailable contact';
  function notice(text){find('phoneNotice').textContent=text;find('phoneNotice').hidden=!text;}
  function captureDraft(){const input=find('phoneMessageInput');if(input&&threadId)drafts.set(draftKey(),input.value);}
  function button(text,action){const b=node('button',text);b.type='button';b.onclick=()=>perform(action);return b;}
  async function perform(action){if(working||isBusy()){notice('Wait for the current request or save to finish.');if(overlay.hidden)onError('Wait for the current request or save to finish.');return;}working=true;notice('');try{await action();}catch(e){const message=e?.refreshRequired?'Newer data was saved. Reload to refresh before retrying.':e?.message||'Phone operation could not finish. Your saved data was kept.';notice(message);if(overlay.hidden)onError(message);}finally{working=false;}}
  async function save(next,revision){await commitCandidate(next,revision);}
  async function viewThread(id){captureDraft();threadId=id;selections.set(storyId,id);tab='chats';editing=false;
    const snap=getSnapshot(),s=story(),t=s?.phone?.threads.find(t=>t.id===id);
    if(t?.messages.some(m=>m.senderType==='character'&&m.ordinal>t.readThroughOrdinal)&&!isBusy())await save(markPhoneThreadRead(snap.vault,storyId,id),snap.revision);
    render();}
  function renderContacts(){for(const c of contacts()){
    const row=node('section',undefined,'phone-contact');const open=button(c.displayName,async()=>{const snap=getSnapshot();const result=openPrivateThread(snap.vault,storyId,snap.chatId,c.id);if(JSON.stringify(result.vault)!==JSON.stringify(snap.vault))await save(result.vault,snap.revision);await viewThread(result.threadId);});open.dataset.phoneContact=c.id;
    const canonical=node('small',c.canonicalName);const name=node('input');name.value=story().phone.contactDisplayNames[c.id]||'';name.placeholder='Contact nickname';name.maxLength=120;name.dataset.phoneNickname=c.id;name.setAttribute('aria-label','Nickname for '+c.canonicalName);
    const update=button('Save nickname',async()=>{const snap=getSnapshot();await save(setContactDisplayName(snap.vault,storyId,c.id,name.value),snap.revision);render();});update.dataset.phoneNicknameSave=c.id;
    row.append(open,canonical,name,update);content.append(row);
  }if(!contacts().length)content.append(node('p','No character contacts in this story.'));}
  function renderList(){const threads=story()?.phone?.threads||[];
    for(const t of threads){const unread=t.messages.filter(m=>m.senderType==='character'&&m.ordinal>t.readThroughOrdinal).length;
      const row=button('',()=>viewThread(t.id));row.className='phone-thread-row';row.dataset.phoneThread=t.id;
      row.append(node('strong',t.kind==='private'?label(t.participantIds[0]):t.title),node('small',t.participantIds.map(label).join(' · ')),node('span',t.messages.at(-1)?.text.slice(0,100)||'No messages yet.'));
      const chat=getSnapshot().vault.chats.find(c=>c.id===t.chatId);row.append(node('small',(chat?.title||'Story conversation '+(getSnapshot().vault.chats.filter(c=>c.storyId===storyId).findIndex(c=>c.id===t.chatId)+1))+' · '+(t.messages.at(-1)?.createdAt?new Date(t.messages.at(-1).createdAt).toLocaleString():'')));
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
    for(const m of t.messages){const bubble=node('article',undefined,'phone-bubble '+m.senderType);bubble.append(node('strong',label(m.senderId)),node('p',m.text),node('small',new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})));transcript.append(bubble);}content.append(transcript);
    const form=node('form',undefined,'phone-composer'),input=node('textarea');input.id='phoneMessageInput';input.placeholder='Write a text message…';input.setAttribute('aria-label','Phone message');input.rows=2;input.maxLength=10000;input.value=drafts.get(draftKey())||'';input.oninput=()=>drafts.set(draftKey(),input.value);
    const send=node('button','Send');send.type='submit';send.id='phoneSend';const more=button('Continue',()=>dispatch('', 'continue'));more.id='phoneContinue';send.disabled=isBusy();more.disabled=isBusy();form.append(input,send,more);
    form.onsubmit=e=>{e.preventDefault();perform(()=>dispatch(input.value,'send'));};content.append(form);
    transcript.scrollTop=transcript.scrollHeight;
  }
  async function dispatch(text,action){captureDraft();const targetStory=storyId,targetThread=threadId;
    if(action==='send'&&!text.trim()){notice('Write a message first.');return;}
    try{await sendPhoneMessage({storyId:targetStory,threadId:targetThread,text,action,onSubmitted:()=>{notice('Vesper is replying…');if(action==='send'){drafts.delete(JSON.stringify([targetStory,targetThread]));if(storyId===targetStory&&threadId===targetThread){const input=find('phoneMessageInput');if(input)input.value='';}}if(storyId===targetStory&&threadId===targetThread)render();},isViewed:()=>!overlay.hidden&&storyId===targetStory&&threadId===targetThread&&tab==='chats'});notice('');}finally{if(!overlay.hidden)render();}
  }
  function render(){if(overlay.hidden)return;content.replaceChildren();content.classList.toggle('phone-thread-content',tab==='chats'&&Boolean(threadId));find('phoneHeading').textContent=(story()?.title||'Story')+' · Phone';
    find('phoneChats').setAttribute('aria-pressed',String(tab==='chats'));find('phoneContacts').setAttribute('aria-pressed',String(tab==='contacts'));
    if(tab==='contacts')renderContacts();else {const t=story()?.phone?.threads.find(t=>t.id===threadId);if(t)renderThread(t);else{threadId=null;renderList();}}refreshBadge();}
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
  function close(){if(overlay.hidden)return;captureDraft();overlay.hidden=true;
    if(scrollState){if(scrollState.bodyStyle===null)document.body.removeAttribute('style');else document.body.setAttribute('style',scrollState.bodyStyle);window.scrollTo(scrollState.x,scrollState.y);const pane=document.getElementById('messages');if(pane)pane.scrollTop=scrollState.pane;scrollState=null;}
    if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});refreshBadge();}
  function refresh(){refreshBadge();if(!overlay.hidden){const snap=getSnapshot();if(!snap.storyVisible||snap.storyId!==storyId)close();}}
  const keydown=e=>{if(overlay.hidden)return;if(e.key==='Escape'){e.preventDefault();close();}else if(e.key==='Tab'){const items=[...overlay.querySelectorAll('button,input,textarea')].filter(el=>!el.disabled&&el.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  launcher.onclick=open;find('phoneClose').onclick=close;find('phoneChats').onclick=()=>perform(()=>{captureDraft();tab='chats';threadId=null;editing=false;render();});find('phoneContacts').onclick=()=>perform(()=>{captureDraft();tab='contacts';editing=false;render();});
  overlay.addEventListener('click',e=>{if(e.target===overlay)close();});document.addEventListener('keydown',keydown);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);window.addEventListener('resize',resize);refreshBadge();
  return {open,close,refresh,destroy(){close();launcher.remove();overlay.remove();document.removeEventListener('keydown',keydown);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',resize);window.removeEventListener('resize',resize);}};
}

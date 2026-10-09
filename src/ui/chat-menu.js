// Existing actions remain the sole owners of navigation, generation and backup behavior.
export function mountChatMenu({document:doc=document,getContext,onPreferences,onTrigger,onError,cancelScroll}){
 const $=id=>doc.getElementById(id),dialog=$('chatMenu'),button=$('chatMenuButton');
 let saving=false,owner=null;
 const close=()=>{if(dialog.open)dialog.close();button.setAttribute('aria-expanded','false');};
 const activate=id=>{close();$(id)?.click();};
 const sections=$('chatMenuSections');
 for(const [title,actions] of [
  ['Story Library',[['Library','libraryNavButton'],['Back to Story','storyNavButton'],['New Story','newStoryButton']]],
  ['Characters & Personas',[['My Personas','personasButton']]],
  ['Memories & Milestones',[['Memories','memoryNavButton'],['Milestones','milestonesNavButton']]],
  ['Settings & Backups',[['Story Settings','settingsButton'],['Export Backup','backupButton'],['Import Backup / Add Story Package','importButton']]]
 ]){
  const section=doc.createElement('section');section.className='menu-section';const heading=doc.createElement('h3');heading.textContent=title;section.append(heading);
  for(const [text,id] of actions){const action=doc.createElement('button');action.type='button';action.className='ghost';action.textContent=text;action.onclick=()=>activate(id);section.append(action);}
  if(title==='Characters & Personas'){const cast=doc.createElement('div');cast.id='menuCast';section.append(cast);}
  sections.append(section);
 }
 const setBusy=()=>{for(const id of ['directorIntensity','directorPacing','directorTrigger'])$(id).disabled=saving;};
 const open=()=>{
  const context=getContext();if(owner!==context.storyId){$('directorAction').value='/skip sleep';$('directorDetail').value='';$('directorDetailLabel').hidden=true;}owner=context.storyId;
  $('directorIntensity').value=context.preferences.intensity;$('directorPacing').value=context.preferences.pacing;
  $('menuCast').replaceChildren();for(const character of context.characters){const details=doc.createElement('details'),title=doc.createElement('summary'),profile=doc.createElement('p');title.textContent=character.name;profile.textContent=Object.entries(character.profile||{}).map(([key,value])=>key+': '+(typeof value==='object'?JSON.stringify(value):value)).join('\n');details.append(title,profile);$('menuCast').append(details);}
  $('directorStatus').textContent='No model request until you press Trigger Director or Send a command.';
  cancelScroll();dialog.showModal();button.setAttribute('aria-expanded','true');
 };
 button.onclick=open;$('chatMenuClose').onclick=close;
 dialog.addEventListener('close',()=>button.setAttribute('aria-expanded','false'));
 dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}});
 const preferences=async()=>{if(saving)return;saving=true;setBusy();try{await onPreferences(owner,{intensity:$('directorIntensity').value,pacing:$('directorPacing').value});$('directorStatus').textContent='Preferences saved for this story. No model request made.';}catch(e){$('directorStatus').textContent=e.message;onError(e.message);const current=getContext().preferences;$('directorIntensity').value=current.intensity;$('directorPacing').value=current.pacing;}finally{saving=false;setBusy();}};
 $('directorIntensity').onchange=preferences;$('directorPacing').onchange=preferences;
 $('directorAction').onchange=()=>{$('directorDetailLabel').hidden=!['/skip','/event custom'].includes($('directorAction').value);};
 $('directorTrigger').onclick=async()=>{if(saving)return;const selection=$('directorAction').value,command=selection+(['/skip','/event custom'].includes(selection)?' '+$('directorDetail').value:'');try{await onTrigger(command,owner,close);}catch(e){$('directorStatus').textContent=e.message;}};
 for(const id of ['continueButton','elaborateButton'])$(id).addEventListener('click',close);
 $('oocButton').addEventListener('click',()=>{close();$('messageInput').focus({preventScroll:true});});
 for(const chip of doc.querySelectorAll('#commandChips button'))chip.addEventListener('click',()=>{close();$('messageInput').focus({preventScroll:true});});
 return {close};
}
export function bindComposerViewport({window:win=window,document:doc=document}){
 const composer=doc.getElementById('composer'),shell=doc.getElementById('app');
 const update=()=>{
  const viewport=win.visualViewport,height=viewport?.height||win.innerHeight,offset=viewport?.offsetTop||0;
  const keyboard=['TEXTAREA','INPUT','SELECT'].includes(doc.activeElement?.tagName)&&win.innerHeight-height>120;
  doc.documentElement.style.setProperty('--keyboard-inset',`${keyboard?Math.max(0,win.innerHeight-height-offset):0}px`);
  shell.classList.toggle('keyboard-open',keyboard);
  shell.style.setProperty('--composer-reserved',`${composer.getBoundingClientRect().height}px`);
 };
 win.visualViewport?.addEventListener('resize',update,{passive:true});win.visualViewport?.addEventListener('scroll',update,{passive:true});win.addEventListener('resize',update,{passive:true});doc.addEventListener('focusin',update);doc.addEventListener('focusout',()=>win.requestAnimationFrame(update));
 const observer=win.ResizeObserver?new win.ResizeObserver(update):null;observer?.observe(composer);update();
}

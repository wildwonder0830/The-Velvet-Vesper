// Owns all automatic chat positioning; never scrolls the document or saved data.
export function createStoryScroller({scroller,button,shell,window:win=window}) {
  let frame=null,timer=null,pending=null,observer=null;
  const updateButton=()=>{if(button)button.hidden=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<80;};
  function cancel(){if(frame!==null)win.cancelAnimationFrame(frame);if(timer!==null)win.clearTimeout(timer);frame=timer=null;pending=null;observer?.disconnect();observer=null;}
  function apply(){
    if(!pending)return;
    const {target,smooth}=pending;
    let top=scroller.scrollHeight-scroller.clientHeight;
    if(target){
      const tail=Math.max(0,scroller.clientHeight-target.offsetHeight-16);
      scroller.style.setProperty('--reply-tail',`${tail}px`);
      top=scroller.scrollTop+target.getBoundingClientRect().top-scroller.getBoundingClientRect().top-16;
    }
    scroller.scrollTo({top:Math.max(0,top),behavior:smooth?'smooth':'auto'});updateButton();
  }
  function schedule(){if(pending&&frame===null)frame=win.requestAnimationFrame(()=>{frame=null;apply();});}
  function viewport(){if(shell?.classList.contains('story-open'))shell.style.setProperty('--story-viewport-height',`${win.visualViewport?.height||win.innerHeight}px`);schedule();}
  function position({target=null,smooth=false}={}){
    cancel();scroller.style.removeProperty('--reply-tail');
    pending={target,smooth:smooth&&!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches};viewport();apply();
    // Only observe the initial rendering window, then leave reading entirely manual.
    if(win.ResizeObserver){observer=new win.ResizeObserver(schedule);observer.observe(scroller);if(target)observer.observe(target);}
    timer=win.setTimeout(()=>{cancel();updateButton();},450);
  }
  for(const event of ['wheel','touchstart','pointerdown'])scroller.addEventListener(event,cancel,{passive:true});
  scroller.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key))cancel();});
  scroller.addEventListener('scroll',updateButton,{passive:true});
  win.addEventListener('resize',viewport,{passive:true});win.visualViewport?.addEventListener('resize',viewport,{passive:true});
  return {position,cancel,updateButton};
}

// Mobile-only disclosure. Draft text stays in the existing textarea, never in storage.
export function mountMobileComposer({composer,toggle,input,window:win=window}) {
  const media=win.matchMedia('(max-width: 799px), (hover: none) and (pointer: coarse)');
  function setOpen(open){
    composer.classList.toggle('composer-open',Boolean(open));
    toggle.setAttribute('aria-expanded',String(Boolean(open)));
    toggle.textContent=open?'Read Story':'Write';
    if(media.matches){if(open)input.focus({preventScroll:true});else if(composer.contains(win.document.activeElement))win.document.activeElement.blur();}
  }
  toggle.addEventListener('click',()=>setOpen(!composer.classList.contains('composer-open')));
  composer.addEventListener('keydown',event=>{if(event.key==='Escape'&&media.matches){setOpen(false);toggle.focus({preventScroll:true});}});
  media.addEventListener('change',()=>setOpen(false));
  setOpen(false);
  return {close:()=>setOpen(false),isMobile:()=>media.matches};
}

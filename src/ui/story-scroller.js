// One cancellable positioning owner: mobile page flow, desktop chat pane.
export function isMobileStoryLayout(win=window) {
  return win.matchMedia('(max-width: 799px), (hover: none) and (pointer: coarse)').matches;
}
export function createStoryScroller({scroller,button,shell,window:win=window}) {
  let frame=null,timer=null,pending=null,observer=null,tail=0;
  function visiblePage(){
    const offset=win.visualViewport?.offsetTop||0;
    const height=win.visualViewport?.height||win.innerHeight;
    const bar=win.document.querySelector('.topbar')?.getBoundingClientRect();
    const nav=win.document.querySelector('.bottom-nav')?.getBoundingClientRect();
    const composer=win.document.querySelector('.story-open #composer')?.getBoundingClientRect();
    const bottom=composer&&composer.top>offset&&composer.top<offset+height?composer.top:offset+height;
    return {top:Math.max(offset,bar?.bottom||0)+16,bottom:nav&&nav.top<bottom&&nav.bottom>offset?Math.min(bottom,nav.top)-16:bottom-16};
  }
  function updateButton(){
    if(!button)return;
    if(isMobileStoryLayout(win)){
      const last=scroller.lastElementChild,bounds=visiblePage();
      const writing=win.document.activeElement?.id==='messageInput';
      button.hidden=Boolean(writing)||!last||Math.abs(last.getBoundingClientRect().bottom-bounds.bottom)<80;
    }else button.hidden=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<80;
  }
  function cancel(){if(frame!==null)win.cancelAnimationFrame(frame);if(timer!==null)win.clearTimeout(timer);frame=timer=null;pending=null;observer?.disconnect();observer=null;}
  function apply(){
    if(!pending)return;
    const {target,smooth}=pending;
    const behavior=smooth?'smooth':'auto';
    if(isMobileStoryLayout(win)){
      const message=target||scroller.lastElementChild;
      if(!message){updateButton();return;}
      const bounds=visiblePage(),rect=message.getBoundingClientRect();
      if(target){
        const remaining=win.document.scrollingElement.scrollHeight-(win.scrollY+rect.bottom)-tail;
        // Document scroll limits use the full layout viewport, including the nav area.
        tail=Math.max(0,win.innerHeight-bounds.top-target.offsetHeight-remaining);
        scroller.style.setProperty('--reply-tail',`${tail}px`);
      }
      win.scrollTo({top:Math.max(0,win.scrollY+(target?rect.top-bounds.top:rect.bottom-bounds.bottom)),behavior});
    }else{
      let top=scroller.scrollHeight-scroller.clientHeight;
      if(target){
        tail=Math.max(0,scroller.clientHeight-target.offsetHeight-16);
        scroller.style.setProperty('--reply-tail',`${tail}px`);
        top=scroller.scrollTop+target.getBoundingClientRect().top-scroller.getBoundingClientRect().top-16;
      }
      scroller.scrollTo({top:Math.max(0,top),behavior});
    }
    updateButton();
  }
  function schedule(){if(pending&&frame===null)frame=win.requestAnimationFrame(()=>{frame=null;apply();});}
  function viewport(){if(shell?.classList.contains('story-open'))shell.style.setProperty('--story-viewport-height',`${win.visualViewport?.height||win.innerHeight}px`);schedule();}
  function position({target=null,smooth=false}={}){
    cancel();tail=0;scroller.style.removeProperty('--reply-tail');
    pending={target,smooth:smooth&&!win.matchMedia('(prefers-reduced-motion: reduce)').matches};viewport();apply();
    // Observe only the initial render window, then leave reading entirely manual.
    if(win.ResizeObserver){observer=new win.ResizeObserver(schedule);observer.observe(scroller);if(target)observer.observe(target);}
    timer=win.setTimeout(()=>{cancel();updateButton();},450);
  }
  for(const event of ['wheel','touchstart','pointerdown']){
    scroller.addEventListener(event,cancel,{passive:true});
    win.addEventListener(event,()=>{if(isMobileStoryLayout(win))cancel();},{passive:true});
  }
  const readingKey=e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)&&!['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName))cancel();};
  scroller.addEventListener('keydown',readingKey);
  win.addEventListener('keydown',e=>{if(isMobileStoryLayout(win))readingKey(e);});
  scroller.addEventListener('scroll',updateButton,{passive:true});
  win.addEventListener('scroll',()=>{if(isMobileStoryLayout(win))updateButton();},{passive:true});
  win.addEventListener('resize',viewport,{passive:true});win.visualViewport?.addEventListener('resize',viewport,{passive:true});
  return {position,cancel,updateButton};
}

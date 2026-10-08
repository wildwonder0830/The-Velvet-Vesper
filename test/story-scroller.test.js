import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryScroller } from '../src/ui/story-scroller.js';
function fixture(){
 const handlers={},frames=new Map();let serial=0;
 const pane={scrollTop:0,scrollHeight:1000,clientHeight:300,style:{setProperty(){},removeProperty(){}},addEventListener:(name,fn)=>handlers[name]=fn,getBoundingClientRect:()=>({top:20}),scrollTo({top}){this.scrollTop=top;}};
 const win={requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:()=>1,clearTimeout(){},addEventListener(){},innerHeight:700,matchMedia:()=>({matches:false})};
 const button={hidden:true};const controller=createStoryScroller({scroller:pane,button,window:win});
 return {pane,button,controller,handlers,frames,flush(){const jobs=[...frames.values()];frames.clear();jobs.forEach(fn=>fn());}};
}
test('opening uses bottom without an outer-page scroll',()=>{const f=fixture();f.controller.position();assert.equal(f.pane.scrollTop,700);});
test('new reply aligns its beginning instead of its conclusion',()=>{const f=fixture();f.controller.position({target:{getBoundingClientRect:()=>({top:520}),offsetHeight:600}});assert.equal(f.pane.scrollTop,484);});
test('manual interaction cancels pending layout positioning',()=>{const f=fixture();f.controller.position();f.handlers.wheel();f.pane.scrollTop=100;f.flush();assert.equal(f.pane.scrollTop,100);});
test('new intent cancels old frames',()=>{const f=fixture();f.controller.position();f.controller.position({target:{getBoundingClientRect:()=>({top:36}),offsetHeight:500}});assert.equal(f.frames.size,1);});
test('deactivation prevents pending positioning',()=>{const f=fixture();f.controller.position();f.controller.cancel();assert.equal(f.frames.size,0);});

import { mountMobileComposer } from '../src/ui/story-scroller.js';
function composerFixture(mobile=true){
 const classes=new Set(),events={},attributes={};let focused=0,blurred=0;
 const input={value:'Unsent draft',focus(){focused++;},blur(){blurred++;}};
 const win={document:{activeElement:input},matchMedia:()=>({matches:mobile,addEventListener(){}})};
 const composer={classList:{toggle(c,on){if(on)classes.add(c);else classes.delete(c);},contains:c=>classes.has(c)},contains:el=>el===input,addEventListener:(e,f)=>events[e]=f};
 const toggle={setAttribute:(k,v)=>attributes[k]=v,addEventListener:(e,f)=>events['toggle-'+e]=f,focus(){}};
 const api=mountMobileComposer({composer,toggle,input,window:win});
 return {api,input,toggle,attributes,events,classes,focused:()=>focused,blurred:()=>blurred};
}
test('mobile composer starts collapsed without discarding draft',()=>{const f=composerFixture();assert.equal(f.attributes['aria-expanded'],'false');assert.equal(f.input.value,'Unsent draft');});
test('Write opens and focuses the mobile editor',()=>{const f=composerFixture();f.events['toggle-click']();assert.equal(f.attributes['aria-expanded'],'true');assert.equal(f.toggle.textContent,'Read Story');assert.equal(f.focused(),1);});
test('Read Story closes the editor and preserves its draft',()=>{const f=composerFixture();f.events['toggle-click']();f.events['toggle-click']();assert.equal(f.input.value,'Unsent draft');assert.equal(f.attributes['aria-expanded'],'false');assert.equal(f.toggle.textContent,'Write');});
test('Escape returns to mobile reading without clearing input',()=>{const f=composerFixture();f.events['toggle-click']();f.events.keydown({key:'Escape'});assert.equal(f.attributes['aria-expanded'],'false');assert.equal(f.input.value,'Unsent draft');});
test('desktop disclosure initialization leaves focus alone',()=>{const f=composerFixture(false);assert.equal(f.blurred(),0);assert.equal(f.focused(),0);assert.equal(f.api.isMobile(),false);});

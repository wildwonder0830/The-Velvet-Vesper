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

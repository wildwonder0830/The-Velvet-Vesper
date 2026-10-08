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

function mobileFixture(){
 const f=fixture(),events={};f.pane.lastElementChild={offsetHeight:500,getBoundingClientRect:()=>({top:2200-win.scrollY,bottom:2700-win.scrollY})};
 const win={scrollY:0,innerHeight:700,document:{scrollingElement:{scrollHeight:3200},querySelector:s=>({getBoundingClientRect:()=>s==='.topbar'?{top:0,bottom:59,height:59}:{top:654,bottom:700,height:46}})},matchMedia:()=>({matches:true}),requestAnimationFrame:fn=>{f.frames.set(1,fn);return 1;},cancelAnimationFrame:id=>f.frames.delete(id),setTimeout:()=>1,clearTimeout(){},addEventListener:(name,fn)=>events[name]=fn,scrollTo({top}){this.scrollY=top;}};
 f.controller=createStoryScroller({scroller:f.pane,button:f.button,window:win});return {...f,win,events};
}
test('mobile reopen aligns newest message above fixed navigation',()=>{const f=mobileFixture();f.controller.position();assert.equal(f.win.scrollY,2062);assert.equal(f.pane.scrollTop,0);});
test('mobile new reply begins below sticky topbar',()=>{const f=mobileFixture();f.controller.position({target:f.pane.lastElementChild});assert.equal(f.win.scrollY,2125);});
test('mobile manual page scrolling cancels pending positioning',()=>{const f=mobileFixture();f.controller.position();f.events.wheel();f.win.scrollY=100;f.flush();assert.equal(f.win.scrollY,100);});
test('mobile visible viewport accounts for keyboard shrink',()=>{const f=mobileFixture();f.win.visualViewport={height:420,offsetTop:0,addEventListener(){}};f.controller.position();assert.equal(f.win.scrollY,2296);});
test('mobile empty conversations do not throw or change the page position',()=>{const f=mobileFixture();f.pane.lastElementChild=null;f.controller.position();assert.equal(f.win.scrollY,0);});
test('mobile jump control does not overlap the original composer',()=>{const f=mobileFixture();const query=f.win.document.querySelector;f.win.document.querySelector=s=>s==='#composer'?{getBoundingClientRect:()=>({top:350,bottom:650})}:query(s);f.controller.updateButton();assert.equal(f.button.hidden,true);});
test('mobile reply positioning respects a panned visual viewport',()=>{const f=mobileFixture();f.win.visualViewport={height:420,offsetTop:100,addEventListener(){}};f.controller.position({target:f.pane.lastElementChild});assert.equal(f.win.scrollY,2084);});
test('mobile short replies have enough document space to align below the topbar',()=>{const f=mobileFixture();f.pane.lastElementChild={offsetHeight:50,getBoundingClientRect:()=>({top:2200-f.win.scrollY,bottom:2250-f.win.scrollY})};f.win.document.scrollingElement.scrollHeight=2600;f.pane.style.setProperty=(_k,value)=>{f.win.document.scrollingElement.scrollHeight=2600+Number.parseFloat(value);};f.win.scrollTo=function({top}){this.scrollY=Math.min(top,this.document.scrollingElement.scrollHeight-this.innerHeight);};f.controller.position({target:f.pane.lastElementChild});assert.equal(f.win.scrollY,2125);});

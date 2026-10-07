// Minimal transactional IndexedDB test double; real browser coverage is separate.
export function vaultDb({failWrites=false}={}) {
 const records=new Map();let tail=Promise.resolve();
 return {name:'synthetic',records,transaction(_store,mode){
  const tx={error:null};let release,pending=0,started=false,finished=false;
  const ready=tail;tail=new Promise(resolve=>release=resolve);const writes=new Map();
  function finish(){if(!started||pending||finished)return;finished=true;
   if(mode==='readwrite'&&failWrites){tx.error=new Error('aborted');tx.onabort?.();}
   else{for(const [k,v] of writes)v===undefined?records.delete(k):records.set(k,v);tx.oncomplete?.();}release();}
  function request(work){pending++;const r={};ready.then(()=>{queueMicrotask(()=>{if(finished)return;try{r.result=work();r.onsuccess?.();}catch(e){r.error=e;r.onerror?.();}pending--;queueMicrotask(finish);});});return r;}
  tx.objectStore=()=>({get:k=>request(()=>structuredClone(writes.has(k)?writes.get(k):records.get(k))),put:(v,k)=>request(()=>{writes.set(k,structuredClone(v));return k;}),delete:k=>request(()=>writes.set(k,undefined))});
  tx.abort=()=>{finished=true;queueMicrotask(()=>{tx.onabort?.();release();});};
  ready.then(()=>{started=true;queueMicrotask(finish);});return tx;
 }};
}

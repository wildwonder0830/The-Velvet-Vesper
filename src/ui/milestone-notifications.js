import {canonicalMilestones} from '../milestones/verifier.js';

// Device-session delivery only: receipts never alter canonical history or backups.
const eventKey = m => JSON.stringify([m.storyId,m.chatId,m.type,
  [...(m.participants || m.participantIds || [])].sort(),m.sourceMessageId || m.evidence]);
const receiptKey = m => JSON.stringify([eventKey(m),m.verification?.verifiedAt || null]);
function eligible(vault){
  return (vault.stories || []).flatMap(story => (vault.chats || [])
    .filter(chat => chat.storyId === story.id)
    .flatMap(chat => canonicalMilestones(vault,story.id,chat.id)))
    .filter((m,index,all) => all.findIndex(row => row.id === m.id) === index);
}
export function createMilestoneNotifications({show,hide}){
  let current=null,queue=[],latest=[],seen=new Set(),delivered=new Map(),revoked=new Set();
  function advance(){
    while(!current && queue.length){
      const key=queue.shift(),m=latest.find(row => eventKey(row)===key);
      if(!m)continue;
      current=key;
      show(m,()=>{if(current!==key)return;hide();current=null;advance();});
    }
  }
  return {
    baseline(vault){hide();current=null;queue=[];latest=eligible(vault);
      for(const m of latest){seen.add(receiptKey(m));delivered.set(eventKey(m),m.id);}},
    observe(vault){const previous=new Set(latest.map(eventKey));latest=eligible(vault);
      const validIds=new Set(latest.map(m=>m.id));
      for(const m of vault.milestones || []){
        if(!validIds.has(m.id) && [...delivered.values()].includes(m.id) &&
          (['candidate','rejected','provisional'].includes(m.status) || m.verification?.verified===false))revoked.add(m.id);
      }
      if(current && !latest.some(m => eventKey(m)===current)){hide();current=null;}
      for(const m of latest){const key=receiptKey(m);if(!seen.has(key)){seen.add(key);const event=eventKey(m);
        if(!previous.has(event) && (!delivered.has(event) ||
          (delivered.get(event)===m.id && revoked.has(m.id) && m.verification?.verifiedAt &&
            m.verification?.verified===true && m.verification?.completed===true && m.verification?.verifiedBy==='user'))){
          delivered.set(event,m.id);revoked.delete(m.id);queue.push(event);
        }}}
      advance();
    }
  };
}

export function mountMilestoneNotifications(doc=document){
  const host=doc.createElement('section');host.className='milestone-toast';host.hidden=true;
  host.setAttribute('role','status');host.setAttribute('aria-live','polite');
  const label=doc.createElement('strong');label.textContent='Milestone completed';
  const title=doc.createElement('p');const close=doc.createElement('button');
  close.type='button';close.textContent='Dismiss';close.setAttribute('aria-label','Dismiss milestone notification');
  host.append(label,title,close);doc.body.append(host);
  // Manual dismissal avoids losing queued notifications during keyboard use,
  // background tabs, or a long modal interaction. No animation timers to race.
  return createMilestoneNotifications({
    show(m,dismiss){title.textContent=m.title || m.type.replaceAll('_',' ');close.onclick=dismiss;host.hidden=false;},
    hide(){host.hidden=true;close.onclick=null;}
  });
}

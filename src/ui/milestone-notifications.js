import {milestonePresentation,relationshipMilestoneKey} from '../milestones/events.js';
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
export function createMilestoneNotifications({show,hide,oncePerRelationship=false}){
  const eventKeyLocal=oncePerRelationship?relationshipMilestoneKey:eventKey;
  const receiptKeyLocal=oncePerRelationship?relationshipMilestoneKey:receiptKey;
  let current=null,queue=[],latest=[],seen=new Set(),delivered=new Map(),revoked=new Set();
  function advance(){
    while(!current && queue.length){
      const key=queue.shift(),m=latest.find(row => eventKeyLocal(row)===key);
      if(!m)continue;
      current=key;
      show(m,()=>{if(current!==key)return;hide();current=null;advance();});
    }
  }
  return {
    baseline(vault){hide();current=null;queue=[];latest=eligible(vault);
      for(const m of latest){seen.add(receiptKeyLocal(m));delivered.set(eventKeyLocal(m),m.id);}},
    observe(vault){const previous=new Set(latest.map(eventKeyLocal));latest=eligible(vault);
      const validIds=new Set(latest.map(m=>m.id));
      for(const m of vault.milestones || []){
        if(!validIds.has(m.id) && [...delivered.values()].includes(m.id) &&
          (['candidate','rejected','provisional'].includes(m.status) || m.verification?.verified===false))revoked.add(m.id);
      }
      if(current && !latest.some(m => eventKeyLocal(m)===current)){hide();current=null;}
      for(const m of latest){const key=receiptKeyLocal(m);if(!seen.has(key)){seen.add(key);const event=eventKeyLocal(m);
        if(!previous.has(event) && (!delivered.has(event) ||
          (!oncePerRelationship && delivered.get(event)===m.id && revoked.has(m.id) && m.verification?.verifiedAt &&
            m.verification?.verified===true && m.verification?.completed===true && m.verification?.verifiedBy==='user'))){
          delivered.set(event,m.id);revoked.delete(m.id);queue.push(event);
        }}}
      advance();
    }
  };
}

export function mountMilestoneNotifications(doc=document,{getContext,getVault}={}){
  const host=doc.createElement('section');host.className='milestone-toast';host.hidden=true;
  host.setAttribute('role','status');host.setAttribute('aria-live','polite');
  const label=doc.createElement('strong');label.textContent='Milestone completed';
  const title=doc.createElement('p');const close=doc.createElement('button');
  close.type='button';close.textContent='Dismiss';close.setAttribute('aria-label','Dismiss milestone notification');
  const details=doc.createElement("div");details.className="milestone-description";host.append(label,title,details,close);doc.body.append(host);
  // Manual dismissal avoids losing queued notifications during keyboard use,
  // background tabs, or a long modal interaction. No animation timers to race.
  return createMilestoneNotifications({oncePerRelationship:Boolean(getContext),
    show(m,dismiss){const meta=milestonePresentation[m.type];title.textContent=m.title || meta?.name || m.type.replaceAll('_',' ');const v=getVault?.();const names=(m.participants||m.participantIds||[]).map(id=>v?.characters?.find(c=>c.id===id)?.name).filter(Boolean);label.textContent=getContext?`${meta?.icon||'✦'} ${names.join(' · ')||'Milestone completed'}`:'Milestone completed';details.textContent=getContext?(meta?.description||m.description||'Verified story event.') : '';close.onclick=dismiss;host.hidden=false;
      if(getContext){const rect=doc.getElementById('messages')?.getBoundingClientRect();const topbar=doc.querySelector('.topbar')?.getBoundingClientRect();host.style.top=Math.max((topbar?.bottom||64)+8,Math.min(rect?.top||72,120))+'px';}
    },
    hide(){host.hidden=true;close.onclick=null;}
  });
}

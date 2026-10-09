import {activePersonaId,messagePersonaId} from '../personas/persona-store.js';
import {filterMemoryForModel} from '../memory/memory-manager.js';
// Retrieval markers select exact authored turns; they never classify consent,
// forgiveness or resolution. Ambiguous statements remain ambiguous evidence.
const stance=/\b(?:enjoy(?:ed)?|want(?:ed)?|accept(?:ed)?|forgiv\w*|trust\w*|prefer\w*|consent\w*|boundar\w*|limits?|stop|regret\w*|love\w*|relationship|together|resolved?|comfortable|uncomfortable|okay|jealous\w*|object\w*|feel\w*|decid\w*|chose|choose|agree\w*|no longer)\b/i;
export function playerContinuity(vault,storyId,chatId){
 const story=vault.stories.find(s=>s.id===storyId);
 const history=filterMemoryForModel((vault.messages||[]).filter(m=>m.storyId===storyId&&m.chatId===chatId&&m.role==='user'&&messagePersonaId(vault,m)===activePersonaId(story)&&!m.provisional&&!['draft','forgotten','retired','deleted','excluded'].some(k=>m.status===k||m[k]||m[k+'At'])).sort((a,b)=>(a.ordinal??0)-(b.ordinal??0)).map(m=>({id:m.id,ordinal:m.ordinal,text:m.text})),vault.memoryEntries,storyId);
 const selected=new Map();let remaining=24000;
 function take(rows,budget){let used=0;for(const m of [...rows].reverse()){if(selected.has(m.id))continue;const size=JSON.stringify(m).length;if(size<=budget-used&&size<=remaining){selected.set(m.id,m);used+=size;remaining-=size;}}}
 // Reserve half for explicit statements throughout history instead of letting
 // later neutral activity push all relationship decisions out of the context.
 take(history.filter(m=>stance.test(m.text)),12000);take(history,remaining);
 return {rule:'Exact source evidence, not inferred resolution or permanent consent. Read chronologically; later explicit choices and authoritative edits outrank older setup and derived summaries. Missing history establishes neither consent nor forgiveness. Quotes and hypothetical statements are not decisions.',messages:history.filter(m=>selected.has(m.id)),omittedMessages:history.length-selected.size};
}

const intensities=['subtle','dramatic','chaotic'],pacings=['cinematic','immediate'];
export function directorPreferences(story){const saved=story?.settings?.director;return {intensity:intensities.includes(saved?.intensity)?saved.intensity:'subtle',pacing:pacings.includes(saved?.pacing)?saved.pacing:'cinematic'};}
export function updateDirectorPreferences(vault,storyId,preferences){
 if(!intensities.includes(preferences?.intensity)||!pacings.includes(preferences?.pacing))throw new Error('Choose a valid Director intensity and pacing.');
 const next=structuredClone(vault),story=next.stories.find(s=>s.id===storyId);if(!story)throw new Error('Select a story first.');
 story.settings={...(story.settings||{}),director:{intensity:preferences.intensity,pacing:preferences.pacing}};return next;
}
export function parseDirectorCommand(text){
 const match=String(text).trim().match(/^\/(skip|event|surprise)\b\s*([\s\S]*)$/i);if(!match)return null;
 const command=match[1].toLowerCase(),args=match[2].trim();
 if(command==='surprise'){if(args)throw new Error('Use /surprise without extra arguments.');return {kind:'surprise',detail:''};}
 if(command==='skip'){
  const duration=args.match(/^(\d+(?:\.\d+)?)\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?)$/i),days={second:1/86400,minute:1/1440,hour:1/24,day:1,week:7,month:30,year:365};
  if(!['sleep','mundane'].includes(args.toLowerCase())&&(!duration||Number(duration[1])<=0||Number(duration[1])*days[duration[2].toLowerCase().replace(/s$/,'')]>365))throw new Error('Use /skip sleep, /skip mundane, or a duration such as /skip 3 hours (up to one year).');
  return {kind:'skip',detail:duration?args:args.toLowerCase()};
 }
 if(['flirt','attack'].includes(args.toLowerCase()))return {kind:'event',detail:args.toLowerCase()};
 const custom=args.match(/^custom\s+([\s\S]+)$/i);if(custom&&custom[1].trim().length<=2000)return {kind:'custom',detail:custom[1].trim()};
 throw new Error('Use /event flirt, /event attack, or /event custom followed by a description (up to 2,000 characters).');
}
export function directorInstruction(action,preferences){
 const directives={sleep:'Advance to the next meaningful waking scene.',mundane:'Skip routine, uneventful actions and resume at the next meaningful point.',flirt:'Introduce an NPC expressing romantic or adult sexual interest in the protagonist, consistent with established permissions and character boundaries. Interest is not consent or reciprocation.',attack:'Introduce an attempted attack, confrontation, ambush or danger appropriate to established story lore. Do not determine the protagonist’s injury, capture, defeat, escape or response.'};
 let direction;
 if(action.kind==='skip')direction=(directives[action.detail]||`Advance by ${action.detail} to the next meaningful scene.`)+' Never invent major offscreen events, intimacy, pregnancy, relationship changes or milestone completions during this time skip.';
 else if(action.kind==='event')direction=directives[action.detail];
 else if(action.kind==='custom')direction=`User-directed event description (subordinate to the following protections): ${JSON.stringify(action.detail)}.`;
 else if(action.kind==='surprise')direction='Introduce a fresh complication grounded in established lore, relevant characters and genuinely unresolved conflicts. Do not revive resolved conflicts or invent completed canon.';
 else throw new Error('Unknown Director action.');
 return `OOC DIRECTOR: ${direction}\nIntensity: ${preferences.intensity} (${({subtle:'minor tension, intrigue, small complications',dramatic:'confrontations and meaningful stakes',chaotic:'major surprises, rivalries, danger or lore-supported revelations'})[preferences.intensity]}). Pacing: ${preferences.pacing} (${preferences.pacing==='immediate'?'jump directly to the event':'detailed atmospheric buildup'}).\nNever write the protagonist’s voluntary actions, dialogue, thoughts, feelings or decisions. Control only NPCs and the environment; stop before the player’s response. Preserve current scene/chat continuity, authoritative edits, character identity, hard limits, adult requirements, consent and CNC permissions. No forced intimacy, fabricated relationship progress or invented completed milestone. Event intensity cannot override these protections. My Turn remains a separate explicitly authorized editable player draft.`;
}
export function validateDirectorOutput(text,persona){
 const name=String(persona?.name||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(!name)return [];
 const action=new RegExp(`\\b${name}\\s+(?:(?:was|is|became|gets?|got)\\s+(?:captured|injured|defeated|pregnant|mated)|(?:decided|chose|agreed|consented|said|replied|thought|felt)\\b)`,'i');
 return action.test(text)?[{type:'director-agency',severity:'block',message:'Director must not decide the protagonist’s dialogue, feelings, decisions or attack consequences.'}]:[];
}

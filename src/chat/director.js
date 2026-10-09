import { roleplayMetaIssues } from "./roleplay-integrity.js";
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
 const directives={sleep:'Advance to the next meaningful waking scene, normally the next morning, even if both characters are already asleep. If the NPC wakes first, narrate only that character’s actions and perspective; leave the protagonist’s waking behavior and response to the player.',mundane:'Skip routine, uneventful actions and resume at the next meaningful point.',flirt:'Introduce an NPC expressing romantic or adult sexual interest in the protagonist, consistent with established permissions and character boundaries. Interest is not consent or reciprocation.',attack:'Introduce an attempted attack, confrontation, ambush or danger appropriate to established story lore. Do not determine the protagonist’s injury, capture, defeat, escape or response.'};
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
 const action=new RegExp(`\\b${name}\\s+(?:(?:was|is|became|gets?|got)\\s+(?:captured|injured|defeated|pregnant|mated)|(?:woke|wakes|awoke|awakens|opened (?:her|his|their) eyes|stirred awake|decided|chose|agreed|consented|said|replied|thought|felt)\\b)`,'i');
 return (action.test(text)||/(?:^|\n)\s*You\s+(?:wake|woke|awoke|open your eyes|opened your eyes|stir awake)\b/i.test(text))?[{type:'director-agency',severity:'block',message:'Director must not decide the protagonist’s dialogue, feelings, decisions or attack consequences.'}]:[];
}

// Completion is explicit record metadata, never inferred from prose or a bond.
export function assertDirectorStoryOpen(story){
 if(['finished','completed'].includes(story?.status)||story?.finished===true||story?.completed===true)throw new Error('This story is explicitly marked finished. Director did not continue it or change that state. Reopen it explicitly before continuing.');
}
export const directorContinuationRule=`ACTIVE DIRECTOR CONTINUATION: Execute the current explicit request within established hard limits, consent, permissions and canon. A complete response beat is not the end of the story. Sleeping, cuddling, a peaceful scene, an established mate bond or emotional satisfaction never authorize concluding an ongoing roleplay. Previous assistant claims that continuation is unnecessary are not user-set story completion.
Skip sleep advances to the next meaningful waking scene even when the characters are already asleep; ordinarily begin the next morning. Narrate the environment and NPC actions/perspective. If an NPC wakes first, narrate that character without deciding whether the protagonist wakes or responds. Never narrate the protagonist's waking behavior, actions, speech, thoughts, feelings or decisions; My Turn is a separate explicitly authorized draft mode.
Write immersive in-world narrative only. Do not discuss narrative structure, announce a conclusion, refuse because the scene is peaceful, or say continuation is unnecessary. Preserve established relationship status, individual personalities, continuity and boundaries. Do not invent major offscreen events, intimacy, pregnancy, relationship changes or milestone completions during a skip.`;
export function validateOocNarrativeOutput(text,{director=false}={}){
 const issues=roleplayMetaIssues(text);
 const structure=/(?:^|\n)\s*(?:from a narrative (?:perspective|standpoint)|narratively(?: speaking)?|the narrative (?:arc|structure)|this (?:scene|story) (?:symbolizes|represents|demonstrates))\b/i;
 return (issues.length||director&&structure.test(String(text)))?[{type:'director-meta',severity:'block',message:'OOC returned story-ending commentary instead of immersive continuation. No reply was added; retry only if you explicitly choose to.'}]:[];
}

import { roleplayMetaIssues } from "../chat/roleplay-integrity.js";
import { humanBody } from "../prompt/identity-ownership.js";
import { findHardRuleViolations } from "../rules/hard-rules.js";
import { findSexualRedLineViolations } from "../rules/sexual-red-lines.js";

const USER_AGENCY_PATTERNS = [
  // Catch clear NEW voluntary/consequential actions. Do not flag simple references
  // to dialogue, feelings, or realizations because those may be restating facts the
  // user just established in her own turn.
  /\bAmanda\s+(?:kissed|touch(?:ed|es)|reached\s+for|took|takes|accepted|accepts|agreed|agrees|followed|follows|chose|chooses|decided|decides|nodded|nods|stepped\s+(?:toward|closer)|walked\s+(?:toward|with)|gave\s+him|gave\s+them|handed\s+(?:him|them))\b/i
];

const PASSIVE_HANDOFF_PATTERNS = [
  /\byour move\b/i,
  /\bwait(?:s|ing)? for (?:her|Amanda) to (?:respond|react|decide|speak|act)\b/i
];

const PRIVATE_AUTHORSHIP_CONTEXT = /\b(?:notes?|journal|diary|entries?|fantas(?:y|ies)|wish\s*list|private\s*list|drafts?|saved\s*(?:messages?|entries?)|app\s*(?:notes?|entries?))\b/i;
const INVENTED_PERSONA_PRIVATE_VOICE = /(?:^|\n)\s*(?:[*_>\-\s]*\d+[.)]?\s*)?(?:[*_]?\s*)?(?:I\s+(?:want|need|wish|imagine|love|like)|Want\s+(?:him|her|them|to|the)|Need\s+(?:him|her|them|to|the)|I(?:'|’)m\s+(?:his|hers|theirs)|Make\s+me\b)/im;

function findPrivateImmortalityLeak(text, persona, knowledge = []) {
  const profile = JSON.stringify(persona?.profile || {});
  if (!/immortal|centur(?:y|ies)|thousand.year|millenni|\b3000\b/i.test(profile)) return [];
  // The knowledge record must explicitly establish Jessica's awareness, not just
  // mention Jessica and the protagonist in unrelated story facts.
  const jessicaKnows = knowledge.some(k => {
    const fact = JSON.stringify(k);
    return /Jessica/i.test(fact) && /(?:knows|learned|discovered|was told|revealed|confessed|aware|disclosed)/i.test(fact)
      && /immortal|true age|three thousand|3000|centur|supernatural|species/i.test(fact);
  });
  if (jessicaKnows) return [];
  const output = String(text || "");
  // Restrict rejection to clear Jessica-attributed dialogue or knowledge;
  // narrative omniscience alone must not be treated as her spoken admission.
  const dialogue = /(?:Jessica(?:\s+(?:said|asked|laughed|murmured|whispered|announced|joked|teased|called|declared|replied|giggled))?[^\n]{0,160}["“][^"”\n]{0,260}(?:immortal|centur(?:y|ies)|three thousand|3000)[^"”\n]*["”])|(?:["“][^"”\n]{0,180}(?:immortal (?:best )?friend|best friend[^"”\n]{0,30}immortal|(?:first couple|several) centur(?:y|ies))[^"”\n]*["”][^\n]{0,100}Jessica)/i;
  const unquotedAttribution = /Jessica[^.\n]{0,130}(?:immortal (?:best )?friend|(?:best )?friend[^.\n]{0,45}immortal|Amanda[^.\n]{0,45}(?:immortal|centur(?:y|ies)))/i;
  if (!dialogue.test(output) && !unquotedAttribution.test(output)) return [];
  return [{ type: "npc-private-knowledge", severity: "block", message: "Jessica revealed or referred to the protagonist's secret immortality without confirmed character-specific evidence that she knows. Preserve Jessica's ignorance and rewrite her dialogue." }];
}
function repetitivePermissionLoop(text, priorUserText = '') {
  const output=String(text||"");
  const asks=output.match(/(?:may i|can i|do i have (?:your )?permission to|is it okay if i|would you let me|i need (?:your )?(?:explicit )?consent (?:to|before)|i need (?:you to say )?yes (?:before|to))\s+(?:[^.!?\n]{0,65})/gi)||[];
  const tactile=asks.filter(x=>/touch|kiss|hold|caress|cheek|face|hand|waist|embrace|closer|ass|butt|lip/i.test(x));
  const procedural=/(?:must|need to|have to)\s+(?:ask|obtain|get|wait for)\s+(?:your |her |his )?(?:explicit |verbal )?(?:permission|consent|yes)\s+(?:before|for|to)\s+(?:every|each|any)\s+(?:touch|kiss|gesture|caress|move)/i.test(output);
  const prior=String(priorUserText||"");
  const rejectedRitual=/(?:don['’]?t|do not|doesn['’]?t|no need|not required|stop|without|unnecessary)[^\n.]{0,100}(?:ask|permission|consent|every (?:touch|time)|each (?:touch|time))/i.test(prior)
    || /(?:ask|permission|consent)[^\n.]{0,95}(?:every|each|not required|unnecessary)/i.test(prior);
  const insistsOnAsking=/(?:instinct|need|have|must|going|want)[^\n.]{0,65}(?:ask|permission|consent)[^\n.]{0,55}(?:every time|always|each time)/i.test(output)
    || /(?:ask|permission)[^\n.]{0,40}(?:every time|always|each time)/i.test(output);
  const touchHesitation=/(?:hand|fingers|palm)[^\n.]{0,115}(?:stopp(?:ed|ing)|hover(?:ed|ing)|paused|wait(?:ed|ing))[^.\n]{0,70}(?:cheek|face|skin|touch|permission|response|reaction)?/i.test(output);
  return tactile.length>=2 || procedural || (rejectedRitual && (insistsOnAsking || touchHesitation));
}
export function validateModelOutput({ text, continuity = {}, forbiddenTerms = [], opening = false, personaDraft = false, priorUserText = "", persona = null, characters = [], knowledge = [], cncEnabled = false }) {
  const issues = roleplayMetaIssues(text);
  if (!String(text || "").trim()) {
    issues.push({
      type: "empty-output",
      severity: "repair",
      message: "Model returned no visible reply text. Produce the requested roleplay prose in the assistant message content."
    });
  }
  for (const violation of findHardRuleViolations(text)) issues.push({ type: "hard-rule", severity: "block", ...violation });
  for (const violation of findSexualRedLineViolations(text)) issues.push({ type: "sexual-red-line", severity: "block", ...violation });
  if (!personaDraft) issues.push(...findPrivateImmortalityLeak(text, persona, knowledge));
  if (!personaDraft && cncEnabled && repetitivePermissionLoop(text, priorUserText)) issues.push({type:"permission-loop",severity:"block",message:"Repetitive verbal permission requests for ordinary romantic touch contradict this story's established initiative dynamic. Rewrite with natural initiation and responsiveness, without inventing the protagonist's reaction or ignoring any refusal or hard limit."});

  for (const term of forbiddenTerms) {
    if (term && String(text).toLowerCase().includes(String(term).toLowerCase())) {
      issues.push({ type: "forbidden-term", severity: "block", term });
    }
  }

  if (!personaDraft) {
    const name=persona?.name||"Amanda",escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const agencyPatterns=USER_AGENCY_PATTERNS.map(p=>new RegExp(p.source.replace("Amanda",escaped),p.flags));
    for (const pattern of agencyPatterns) {
      const outputMatch = text.match(pattern)?.[0]?.replace(/\s+/g, " ").trim().toLowerCase();
      const userEstablished = outputMatch && priorUserText.replace(/\s+/g, " ").toLowerCase().includes(outputMatch);
      if (outputMatch && !userEstablished) issues.push({ type: "user-agency", severity: "repair", message: `Model supplied a voluntary or consequential choice for ${name}.` });
    }
  }
  if (!personaDraft && PRIVATE_AUTHORSHIP_CONTEXT.test(String(text)) && INVENTED_PERSONA_PRIVATE_VOICE.test(String(text))) {
    issues.push({
      type: "persona-private-authorship",
      severity: "block",
      message: "Model invented Amanda-authored private notes, fantasies, desires, or messages. Only user-supplied Amanda-authored content may be quoted or specified; otherwise leave the contents undescribed."
    });
  }
  if (!opening && !personaDraft) {
    for (const pattern of PASSIVE_HANDOFF_PATTERNS) {
      if (pattern.test(text)) issues.push({ type: "passive-handoff", severity: "repair", message: "Model defaulted to passive waiting/hand-off." });
    }
  }
  if (personaDraft && /(?:the correction landed|he listened[.,; ]+he adjusted|she filed that away[^\\n]{0,100}(?:evidence|data)|\\bmaster witch[.! ]+three thousand years[.! ]+i know things)/i.test(String(text))) issues.push({type:"persona-draft-editorial-leak",severity:"block",message:"My Turn leaked author-edit commentary or omniscient private knowledge into the protagonist's narration. Draft only an in-character response to saved in-world events."});
  if (personaDraft && /\b(?:understood|previous response|future responses|ready for the next turn|whenever you are|i(?:\'| a)?m ready)\b/i.test(String(text))) {
    issues.push({ type: "persona-draft-meta", severity: "repair", message: "My Turn returned meta/instructional chatter instead of Amanda\'s draft." });
  }

  if (continuity.mateBond && /\b(?:first kiss|do you love me|does she love him|are we together)\b/i.test(text)) {
    issues.push({ type: "continuity-reset", severity: "repair", message: "Output conflicts with established mate-bond state." });
  }

  if(humanBody(persona)){
    const escaped=(persona.name||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const forbidden=new RegExp(`\\b${escaped}(?:['’]s|\\s+(?:has|grew|sprouted))\\s+(?:[\\w-]+\\s+){0,2}(?:tail|feline ears|fur|claws)\\b`,'i');
    if(escaped&&forbidden.test(String(text)))issues.push({type:'persona-identity',severity:'repair',message:'The assigned protagonist is human; NPC feline anatomy must not be transferred to this persona.'});
  }
  const gender=record=>String(record?.profile?.gender||record?.profile?.sex||'').toLowerCase();
  const protagonistPronoun=gender(persona)==='female'?'her':gender(persona)==='male'?'his':null;
  const exclusivePronoun=protagonistPronoun&&characters.every(c=>['female','male'].includes(gender(c))&&gender(c)!==gender(persona));
  if(humanBody(persona)&&personaDraft&&exclusivePronoun&&new RegExp(`\\b${protagonistPronoun}\\s+(?:[\\w-]+\\s+){0,2}(?:tail|feline ears|animal ears|fur|claws)\\b`,'i').test(String(text)))issues.push({type:'persona-identity',severity:'block',message:'This unambiguous pronoun identifies the human protagonist, not the NPC owning that anatomy.'});
  if(humanBody(persona)&&personaDraft&&/\bmy\s+(?:[\w-]+\s+){0,2}(?:tail|feline ears|animal ears|fur|claws)\b/i.test(String(text)))issues.push({type:'persona-identity',severity:'block',message:'The human protagonist cannot own NPC anatomy. Keep each physical trait with its established actor.'});
  if(/\b(?:her|his|my|their)\s+(?:tail|ears|fur|claws)\s*[—–,-]\s*(?:no|wait|rather|i mean)\s*[,—–-]?\s*(?:her|his|my|their)\s+(?:tail|ears|fur|claws)\b/i.test(String(text)))issues.push({type:'prose-self-correction',severity:'block',message:'Do not expose inline actor/anatomy corrections in finished prose. Attribute the body part to its correct owner before writing the draft.'});
  return {
    ok: !issues.some(issue => issue.severity === "block"),
    needsRepair: issues.some(issue => issue.severity === "repair"),
    issues
  };
}

export function buildRepairInstruction(result, { opening = false, personaDraft = false, persona = null } = {}) {
  if (!result?.issues?.length) return "";
  const reasons = result.issues.map(issue => `- ${issue.message || issue.term || issue.type}`).join("\n");
  const agencyRule=(personaDraft
    ? "This is a MY TURN draft: write only Amanda's proposed turn and do not write model-controlled characters' dialogue, actions, thoughts, or reactions."
    : "Do not supply the user-controlled persona's voluntary actions, substantive dialogue, thoughts, feelings, intentions, trust, consent, or consequential choices. Never invent Amanda-authored private notes, fantasies, desires, diary entries, messages, lists, recordings, or offscreen confessions; only use contents explicitly supplied by the user. Involuntary, unavoidable, mechanically necessary, or explicitly pre-established events may be narrated.").replaceAll("Amanda",persona?.name||"Amanda");
  const identity=persona?` Assigned protagonist: ${persona.name}. Species: ${persona.profile?.species||"unspecified"}. Follow the assigned profile and hard limits.`:"";
  return `Rewrite the response without changing the intended story beat. Correct these violations:\n${reasons}\n${agencyRule}${identity} Preserve established canon and relationship state.${opening ? " For an opening turn, do not use passive handoff language; simply end on the configured completed opening beat without narrating Amanda." : ""}`;
}

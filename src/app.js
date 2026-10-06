import { openVesperDb, loadVault, saveVaultAtomic } from "./storage/vault-store.js";
import { previewImport, prepareImport, commitPreparedImport } from "./migration/import-service.js";
import { makeId } from "./schema.js";
import { createMemory } from "./memory/memory-manager.js";
import { recordKnowledge } from "./knowledge/ledger.js";
import { createSceneState } from "./scene/scene-state.js";
import { runTurn } from "./chat/turn-engine.js";
import { replaceOpenRouterKey, getDeviceSecret, DEVICE_SECRET_NAMES } from "./settings/secret-store.js";
import { seedDefaultGreenLines } from "./rules/preference-lines.js";
import { storyIsRunnable, listStoryChoices, chooseInitialChat } from "./library/story-selection.js";
import { recordUsage } from "./usage/usage-ledger.js";
import { serializePortableBackup } from "./backup/vesper-backup.js";

const $ = id => document.getElementById(id);
const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
let db, vault, preparedImport = null, activeStoryId = null, activeChatId = null, pendingDeleteStoryId = null, sending = false, retryMessageId = null, activeGenerationController = null;
const LAST_TAB_KEY="vesper.ui.lastTab";
const rememberTab=tab=>{try{localStorage.setItem(LAST_TAB_KEY,tab);}catch{}};
const lastTab=()=>{try{return localStorage.getItem(LAST_TAB_KEY)||"library";}catch{return "library";}};
const QUERY_LIMIT=1000;
function localDayKey(date=new Date()){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");}
function usageDayKey(entry){const d=new Date(entry.createdAt);return Number.isNaN(d.getTime())?"":localDayKey(d);}
function queryCountToday(){return (vault?.usageEntries||[]).filter(e=>usageDayKey(e)===localDayKey()).length;}
function renderQueryMeter(){const el=$("queryCount");if(el)el.textContent=`${queryCountToday().toLocaleString()} / ${QUERY_LIMIT.toLocaleString()}`;}
function recordTurnUsage(result,{storyId,chatId,model}){const usages=result?.usage||[];for(const usage of usages){vault.usageEntries.push(recordUsage({storyId,chatId,model,promptTokens:usage?.prompt_tokens||0,completionTokens:usage?.completion_tokens||0,cost:null}));}renderQueryMeter();}

async function boot() {
  db = await openVesperDb(); vault = await loadVault(db); bindUi(); render();
}
function bindUi() {
  const on=(id,event,handler)=>{const el=$(id);if(el)el.addEventListener(event,handler);};
  on("importButton","click",()=>$("importFile")?.click()); on("importFile","change",handleImportFile); on("libraryNavButton","click",showLibrary); on("storyNavButton","click",showActiveStory); on("memoryNavButton","click",()=>showDataView("memory")); on("milestonesNavButton","click",()=>showDataView("milestones")); on("dataBackButton","click",showActiveStory);
  $("newStoryButton").onclick=openStorySetup; $("composer").onsubmit=sendTurn;
  $("messageInput").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();$("composer").requestSubmit();}};
  $("continueButton").onclick=()=>runStoryTool("continue");
  $("elaborateButton").onclick=()=>runStoryTool("elaborate");
  $("myTurnButton").onclick=()=>runStoryTool("myturn"); on("regenLatestButton","click",regenerateLatestReply); on("stopButton","click",stopGeneration); on("scrollBottomButton","click",()=>jumpMessagesToLatest(true)); document.querySelectorAll("#commandChips [data-command]").forEach(button=>button.addEventListener("click",()=>insertCommand(button.dataset.command||"")));
  $("storySetupClose").onclick=closeStorySetup; $("createStoryFromSetup").onclick=createStarterStory; on("setupTemplate","change",applyStoryTemplate);
  $("settingsButton")?.addEventListener("click",openSettings); $("settingsClose")?.addEventListener("click",()=>{$("settingsPanel").hidden=true;});
  $("saveSettings").onclick=saveSettings; on("backupButton","click",downloadBackup); on("replaceKeyButton","click",beginKeyReplacement); on("testConnectionButton","click",testModelConnection); on("rpQualityTestButton","click",testRpQuality); on("retryButton","click",retryFailedTurn); $("storyPicker").onchange=changeStory; $("deleteStoryClose").onclick=closeDeleteStory; $("deleteStoryCancel").onclick=closeDeleteStory; $("deleteStoryConfirm").onclick=confirmDeleteStory;
}

function backupFilename(){const d=new Date(),stamp=[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")+"_"+[String(d.getHours()).padStart(2,"0"),String(d.getMinutes()).padStart(2,"0")].join("-");return `Vesper_Backup_${stamp}.json`;}
async function downloadBackup(){
  try{
    vault.updatedAt=new Date().toISOString();await saveVaultAtomic(db,vault);
    const json=serializePortableBackup(vault),blob=new Blob([json],{type:"application/json"}),url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download=backupFilename();document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    showStatus("Backup created. Keep that JSON file somewhere safe.","notice");
  }catch(error){showStatus(`Backup failed: ${error.message}`,"error");}
}

async function handleImportFile(e){
  const file=e.target.files?.[0]; if(!file)return;
  try{const source=JSON.parse(await file.text()), preview=previewImport(source); preparedImport=prepareImport(source);
    const counts=preview.counts||preparedImport.preview?.counts||{}; $("importPreview").hidden=false;
    $("importPreview").innerHTML=`<strong>Import preview</strong><p>${Object.entries(counts).map(([k,v])=>`${k}: ${v}`).join(" · ")}</p><p>No existing Vesper data changes until you confirm.</p><button class="primary" id="confirmImport">Confirm Import</button>`;
    $("confirmImport").onclick=confirmImport;
  }catch(error){$("importPreview").hidden=false;$("importPreview").textContent=`Import error: ${error.message}`;}
}
async function confirmImport(){if(!preparedImport)return;const button=$("confirmImport");if(button){button.disabled=true;button.textContent="Importing…";}try{await commitPreparedImport(db,preparedImport);vault=await loadVault(db);preparedImport=null;const preview=$("importPreview");preview.hidden=true;preview.replaceChildren();const input=$("importFile");if(input)input.value="";render();showStatus("Backup imported successfully.","notice");}catch(error){if(button){button.disabled=false;button.textContent="Confirm Import";}showStatus(`Import failed: ${error.message}`,"error");}}
function applyStoryTemplate(){
  const template=$("setupTemplate")?.value;
  if(template==="blackthorn"){
    $("setupStoryTitle").value="The Blackthorn Prophecy";$("setupPersonaName").value="Amanda";$("setupCharacterOne").value="Aedan Blackthorn";$("setupCharacterTwo").value="Aeron Blackthorn";
  }else if(template==="venomous-devotion"){
    $("setupStoryTitle").value="Venomous Devotion";$("setupPersonaName").value="Amanda";$("setupCharacterOne").value="Valec Thorne";$("setupCharacterTwo").value="";
  }
}
function openStorySetup(){$("storySetupPanel").hidden=false;}
function closeStorySetup(){$("storySetupPanel").hidden=true;}
async function createStarterStory(){
  const title=$("setupStoryTitle").value.trim()||"Untitled Vesper Story",personaName=$("setupPersonaName").value.trim();
  const characterNames=[$("setupCharacterOne").value.trim(),$("setupCharacterTwo").value.trim()].filter(Boolean);
  if(!personaName||!characterNames.length)return;
  const now=new Date().toISOString(),storyId=makeId("story"),chatId=makeId("chat"),personaId=makeId("persona");
  const template=$("setupTemplate")?.value||"custom";
  const blackthorn=template==="blackthorn"&&title==="The Blackthorn Prophecy"&&personaName==="Amanda"&&characterNames.includes("Aedan Blackthorn")&&characterNames.includes("Aeron Blackthorn");
  const venomous=template==="venomous-devotion"&&title==="Venomous Devotion"&&personaName==="Amanda"&&characterNames.includes("Valec Thorne");
  const personaProfile=blackthorn?{age:24,adult:true,species:"immortal witch-wolf hybrid",history:"Severely abused and deliberately diminished by her family; kept isolated except for required appearances. Her father has forced suppressants on her for years to lock down both wolf and witch, muting supernatural healing and her side of the mate bond.",family:"Her full-blooded half-sister is the favored daughter and widely expected to become Luna.",supernaturalForm:"A spectral ghost-pale wolf with white/silver mane-like fur and red-and-silver witch-light emanating from her.",healing:"Suppression prevents normal immortal healing. As the fated bond strengthens, Amanda's own returning supernatural power progressively heals old scars.",prophecy:"Full suppression breaks only when the prophecy is fulfilled through her first intimate union with her fated mates; recognition, love, or kissing alone cannot trigger full release."}:venomous?{age:24,adult:true,species:"rabbit shifter",work:"Works inside an elite supernatural command organization under Commander Valec Thorne while concealing that she is a prey-species shifter.",secret:"Her rabbit identity is hidden at work. She uses a scent product she believes repels snake shifters, but to Valec's black-mamba instincts it reads as an intensely provocative mate-attraction signal.",heat:"Her rabbit-shifter heat occurs unusually often and is an established private topic with her anonymous online partner.",onlineHistory:"For months she has had an emotionally intimate and explicitly sexual relationship through an anonymous shifter app with a man she knows only by the username nobunnyonmymenu. She does not know he is Valec Thorne."}:{age:24,adult:true};
  const persona={id:personaId,name:personaName,storyId,profile:personaProfile,directives:["Protect this persona's meaningful agency. Do not choose her voluntary actions, substantive dialogue, thoughts, feelings, intentions, trust, consent, relationship decisions, or consequential choices. Involuntary, unavoidable, mechanically necessary, or explicitly pre-established events involving her may be narrated when they do not imply a voluntary choice.",...(blackthorn?["Abuse history is canon but does not define the persona's entire personality or make her inherently fragile."]:[]),...(venomous?["Amanda is not timid merely because she is a prey-species shifter. Preserve her intelligence, humor, competence, sexuality, and ability to push back."]:[])],createdAt:now,updatedAt:now};
  const profiles={"Aedan Blackthorn":{age:28,adult:true,species:"werewolf",rank:"co-Alpha",personality:"Calm, strategic, observant, disciplined, patient, intelligent, difficult to manipulate. Quiet authority, dry humor, quieter when angry. Protective without infantilizing. Affection through consistency, deliberate touch, practical care, and remembered details.",flaw:"Can over-calculate.",romance:"Amanda is his first romantic and intimate partner. He wants a distinct individual relationship with her as well as the triad bond."},"Aeron Blackthorn":{age:28,adult:true,species:"werewolf",rank:"co-Alpha",personality:"Playful, perceptive, charismatic, affectionate, curious, stubborn, emotionally direct, quick-witted. Tactile and teasing, with hotter jealousy, obvious affection, and a faster temper; sharply focused when serious.",flaw:"Can act from emotional impulse.",romance:"Amanda is his first romantic and intimate partner. He wants a distinct individual relationship with her as well as the triad bond."},"Valec Thorne":{age:38,adult:true,species:"black mamba shifter",rank:"S-rank commander",appearance:"Very tall, broad, heavily muscled, thick through the chest and shoulders, powerful rather than lean. Dark hair, severe handsome features, dark green-to-near-black eyes, expensive immaculate clothing, unnerving predator stillness.",personality:"Hyper-observant, strategic, frighteningly patient, highly intelligent, dryly funny, controlled and economical in public. He rarely raises his voice because he expects to be obeyed the first time.",romance:"For months he has been emotionally and sexually involved with an anonymous woman on a shifter app under his username nobunnyonmymenu. He calls her little rabbit/bunny, knows her heat patterns and private needs, and is already deeply attached before learning she is Amanda.",jealousy:"Possessive and territorial. Harmless flirting earns cold watchfulness; deliberate boundary crossing, threats, predatory intimidation, or exploitation of Amanda's prey status can provoke targeted physical violence. He is not randomly brutal and does not become stupid when jealous.",sexualForm:"All sexual activity remains between adult humanoid forms with human/humanoid anatomy. Snake instincts may color scent, possessiveness, tracking, stillness, and predatory attention but never introduce animal mating anatomy or mechanics."}};
  const characters=characterNames.map((name,index)=>({id:makeId("character"),name,storyId,profile:(blackthorn||venomous)?(profiles[name]||{age:28,adult:true}):{age:28,adult:true},directives:["Maintain an individual voice, memory, knowledge state, and relationship with the persona.","Never merge identity, memories, actions, dialogue, or milestones with another character.",...(blackthorn?["Aedan and Aeron are equal co-Alphas and lifelong brothers. Neither is subordinate. Their sibling bond is never romantic or sexual.","They share one three-person fated bond with Amanda while each twin also loves and courts Amanda individually. Amanda is never merely 'the twins' mate'."]:[]),...(venomous?["Valec should initiate, investigate, pursue, command professionally, flirt, scent, crowd, protect, and become jealous according to character without choosing Amanda's voluntary response for her.","Valec's online identity is nobunnyonmymenu. Before the reveal, he knows his anonymous partner intimately but does not know with certainty that she is Amanda until the opening confirmation beat."]:[])],castOrder:index,createdAt:now,updatedAt:now}));
  vault.personas.push(persona);vault.characters.push(...characters);
  const story={id:storyId,title,characterIds:characters.map(x=>x.id),primaryCharacterId:characters[0].id,personaId,settings:{model:localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL},createdAt:now,updatedAt:now};
  if(blackthorn){story.premise="Aedan and Aeron Blackthorn are equal co-Alphas who share one fated mate: Amanda. Everyone expects their public mate announcement to name Amanda's favored full-blooded half-sister. The twins already know Amanda is their mate.";story.openingScene={location:"Major formal pack gathering for the co-Alphas' mate and future Luna announcement",facts:["Amanda is present because her family requires the appearance.","The favored half-sister deliberately trips Amanda at the start, causing her to fall.","Aedan and Aeron both directly witness the sister trip Amanda. Never rewrite this as an accident or something either twin missed.","The sister then says: Oh, you should really be more careful. And don't forget to smile. You look sad.","The family has no advance warning that Amanda will be named.","The twins already know Amanda is their mate before the announcement; do not write uncertain mate recognition.","Stop before narrating Amanda's response, reaction, dialogue, thoughts, feelings, or choices."],direction:"Aedan reacts with controlled strategic focus and recognizes evidence of the family dynamic. Aeron reacts hotter and less diplomatically without becoming foolish. The public reveal should land as a genuine shock."};story.prophecy={state:"unfulfilled",unlockTrigger:"first intimate union with her fated mates",earlyUnlockForbidden:true,effects:["forced suppression breaks","witch power fully returns","wolf fully returns","immortal healing resumes"]};}
  if(venomous){
    story.premise="For months, Amanda and Valec Thorne have maintained an emotionally intimate and explicitly sexual relationship through an anonymous shifter app without knowing each other's real-world identity. Valec is the S-rank black-mamba commander Amanda works under; online he is nobunnyonmymenu and affectionately calls his anonymous partner little rabbit/bunny. Amanda secretly is a rabbit shifter and conceals her prey identity at work. Her supposed snake-repellent scent affects Valec like an intense mate-attraction signal.";
    story.openingScene={location:"Valec Thorne's private office inside the elite supernatural command center",facts:["The story begins after months of established anonymous online emotional and sexual history between Amanda and nobunnyonmymenu.","Valec has begun privately suspecting that Amanda may be his anonymous partner, but he does not yet know for certain.","Before summoning Amanda to his office, Valec schedules a delayed message to his anonymous partner so it will arrive while Amanda is standing in front of him. The message should be innocuous but intimate and recognizable as part of their established private dynamic.","Amanda enters Valec's office while wearing the scent product she believes repels snake shifters. To Valec it is intensely provocative and reinforces his suspicion.","While Valec observes Amanda, the delayed message arrives and her phone audibly dings in her pocket.","The stress/startle plus unstable concealment causes Amanda's rabbit ears to pop out visibly. This is involuntary and may be narrated.","The phone ding and rabbit ears together give Valec decisive confirmation that Amanda is his anonymous little rabbit.","Valec does NOT immediately tell Amanda that he is nobunnyonmymenu. He keeps that knowledge to himself for the moment and reacts with controlled, predatory intelligence rather than blurting out the reveal.","Stop before narrating Amanda's voluntary reaction, dialogue, decision, or attempt to explain."],direction:"Play the opening with strong dramatic irony, scent tension, predator/prey contrast, and Valec's unnerving self-control. Online Valec is warm, attentive, teasing, dominant, and sexually familiar with Amanda; Commander Thorne is controlled, intimidating, observant, and economical. When confirmation lands, let the internal impact be intense while his outward reaction remains restrained. Do not rush the identity reveal beyond the configured beat."};
  }
  vault.stories.push(story);vault.chats.push({id:chatId,storyId,title:"Main Story",createdAt:now,updatedAt:now});
  if(venomous){
    const valec=characters.find(x=>x.name==="Valec Thorne");
    const pinnedCanon=[
      ["online-history","Amanda and Valec have months of established anonymous online emotional and sexual history before page one."],
      ["online-identity","Valec's anonymous shifter-app username is nobunnyonmymenu. Amanda does not know Commander Valec Thorne is nobunnyonmymenu at the start."],
      ["rabbit-secret","Amanda is secretly a rabbit shifter and conceals her prey-species identity at work."],
      ["scent","Amanda's supposed snake-repellent scent acts on Valec's black-mamba instincts like an intense mate-attraction signal."],
      ["heat-history","Amanda experiences unusually frequent rabbit-shifter heat; her anonymous partner already knows this and has helped her through it sexually online."],
      ["opening-test","Before calling Amanda into his office, Valec schedules a delayed intimate message to his anonymous partner to test whether Amanda reacts when it arrives."],
      ["opening-confirmation","The delayed message dings in Amanda's pocket and her rabbit ears involuntarily pop out, giving Valec confirmation that Amanda is his anonymous little rabbit."],
      ["reveal-delay","Valec does not immediately reveal that he is nobunnyonmymenu after confirming Amanda's identity."],
      ["jealousy","Valec is possessive and capable of targeted physical violence when someone genuinely threatens, exploits, or deliberately crosses a boundary around Amanda; harmless flirting alone does not make him irrational."],
      ["anatomy","Snake-shifter sexual scenes use adult humanoid bodies and human/humanoid sexual anatomy only; no animal mating anatomy or mechanics."]
    ];
    vault.memoryEntries.push(...pinnedCanon.map(([key,text])=>createMemory({storyId,chatId,kind:"canon",text,data:{key},pinned:true},now)));
    if(valec){
      vault.knowledgeEntries.push(
        recordKnowledge({storyId,knowerId:valec.id,subjectId:personaId,factKey:"suspects-online-identity",value:"Valec suspects Amanda may be his anonymous partner before the office test, but certainty comes only from the delayed-message and rabbit-ear confirmation.",learnedAt:now},now)
      );
    }
    vault.sceneStates.push(createSceneState({storyId,chatId,location:"Valec Thorne's private office - supernatural command center",time:"Opening workday",participantIds:[personaId,...characters.map(x=>x.id)],tags:["anonymous-online-lovers","secret-identity","black-mamba","rabbit-shifter","delayed-message","identity-test"]},now));
  }
  if(blackthorn){
    const pinnedCanon=[
      ["bond","Aedan, Aeron, and Amanda share one fated three-person bond. Each twin also has his own individual romantic relationship with Amanda."],
      ["rank","Aedan and Aeron are equal co-Alphas; neither outranks the other."],
      ["recognition","Aedan and Aeron already know Amanda is their fated mate before the opening scene."],
      ["opening-witness","At the formal announcement, both Aedan and Aeron directly witness Amanda's favored half-sister deliberately cause Amanda to fall."],
      ["family-secret","Amanda's family has no advance warning that Amanda will be publicly named instead of her favored half-sister."],
      ["release-gate","Amanda's full supernatural release is gated by the prophecy's later relationship milestone and cannot trigger early from recognition, affection, or kissing."],
      ["healing","Amanda's own returning supernatural power progressively restores her suppressed healing as the bond strengthens."]
    ];
    vault.memoryEntries.push(...pinnedCanon.map(([key,text])=>createMemory({storyId,chatId,kind:"canon",text,data:{key},pinned:true},now)));
    const twins=characters.filter(x=>x.name==="Aedan Blackthorn"||x.name==="Aeron Blackthorn");
    for(const twin of twins){
      vault.knowledgeEntries.push(
        recordKnowledge({storyId,knowerId:twin.id,subjectId:personaId,factKey:"fated-mate",value:true,learnedAt:now},now),
        recordKnowledge({storyId,knowerId:twin.id,subjectId:personaId,factKey:"opening-witness",value:"Directly witnessed the favored half-sister deliberately cause Amanda to fall.",learnedAt:now},now)
      );
    }
    vault.sceneStates.push(createSceneState({storyId,chatId,location:"Formal pack gathering - mate and future Luna announcement",time:"Opening night",participantIds:[personaId,...twins.map(x=>x.id)],tags:["formal-gathering","public-announcement","future-luna","family-politics","opening-scene"]},now));
  }
  vault.updatedAt=now;await saveVaultAtomic(db,vault);closeStorySetup();renderStory(storyId,chatId);
  if(blackthorn||venomous){
    const model=story.settings?.model||localStorage.getItem("vesper.model"),key=getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY);
    if(model&&key){
      sending=true;$("sendButton").disabled=true;showStatus("Vesper is opening the story…","working");
      try{
        const preferenceLines=vault.preferenceLines?.length?vault.preferenceLines:seedDefaultGreenLines();
        const result=await runTurn({vault,storyId,chatId,model,preferenceLines,storySettings:story.settings||{},opening:true,maxTokens:3000});
        recordTurnUsage(result,{storyId,chatId,model});
        if(result.blocked||!result.validation?.ok||!result.text?.trim()) throw new Error("Opening was blocked by a Vesper hard rule.");
        vault.messages.push({id:makeId("message"),storyId,chatId,role:"assistant",text:result.text,ordinal:0,createdAt:new Date().toISOString(),validation:result.validation,repaired:result.repaired});
        await saveVaultAtomic(db,vault);renderStory(storyId,chatId);showStatus(result.repaired?"Opening repaired before display.":"","notice");
      }catch(error){showStatus(`Story created, but opening generation failed: ${error.message}`,"error");}
      finally{sending=false;activeGenerationController=null;setGenerationUi(false);}
    }else showStatus((blackthorn?"The Blackthorn Prophecy":"Venomous Devotion")+" is ready. Add your OpenRouter key and model in Settings, then begin when ready.","notice");
  }else showStatus("Story created. Cast identities are isolated and ready for canon.","notice");
}
const VESPER_HARD_LIMITS=["Anal sex or anal penetration","Breath play","Hard choking or strangulation","Suffocation or intentional oxygen restriction","Eroticized loss of consciousness from airway or blood-flow restriction","Electrical stimulation / e-stim","Sexual content involving animals or bestiality","Extreme or torture pain","Crying as an erotic goal, kink, or escalation target","Urine","Feces / scat","Overstimulation","Canine reproductive anatomy, knotting, tie, or bulbus-glandis","Canine genital locking or literal animal mating mechanics","Werewolf/shifter sexual anatomy","Double penetration"];
function renderHardLimits(){const list=$("hardLimitsList");if(!list)return;list.replaceChildren(...VESPER_HARD_LIMITS.map(text=>{const row=document.createElement("div");row.className="hard-limit-item";row.textContent=text;return row;}));}
function renderKeyStatus(){const hasKey=Boolean(getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY));$("apiKeyStatus").textContent=hasKey?"•••••••• stored securely on this device":"No API key stored on this device";$("replaceKeyButton").textContent=hasKey?"Replace API Key":"Add API Key";}
function beginKeyReplacement(){const row=$("apiKeyReplaceRow"),input=$("apiKey");row.hidden=false;input.value="";input.focus({preventScroll:true});}
async function probeOpenRouter(prompt){const draft=$("apiKey").value.trim(),key=draft||getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY),model=$("modelName").value.trim();if(!key)throw new Error("No OpenRouter API key is loaded.");if(!model)throw new Error("No model is selected.");const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model,messages:[{role:"user",content:prompt}],temperature:0,max_tokens:32})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data?.error?.message||`OpenRouter request failed (${response.status}).`);return data;}
async function testModelConnection(){const out=$("connectionTestStatus");out.textContent="Testing…";try{await probeOpenRouter("Reply with exactly: VESPER CONNECTED");out.textContent="✓ Connection successful.";}catch(error){out.textContent=`Connection failed: ${error.message}`;}}
async function testRpQuality(){const out=$("connectionTestStatus");out.textContent="Running RP quality test…";try{const data=await probeOpenRouter("In one short sentence, write atmospheric gothic roleplay prose about a candlelit hall. No sexual content.");const sample=data?.choices?.[0]?.message?.content?.trim();out.textContent=sample?`RP test: ${sample}`:"RP test connected, but returned no text.";}catch(error){out.textContent=`RP test failed: ${error.message}`;}}
function openSettings(){
  const story=vault.stories.find(s=>s.id===activeStoryId)||vault.stories[0];
  $("apiKey").value="";$("apiKeyReplaceRow").hidden=true;renderKeyStatus();
  $("modelName").value=story?.settings?.model||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL;
  const settings=story?.settings||{};$("temperatureSetting").value=settings.temperature??0.9;$("maxTokensSetting").value=settings.maxTokens??1200;$("intimacyPacing").value=settings.intimacyPacing||"balanced";$("requirePlotAfterSex").checked=Boolean(settings.requirePlotAfterSex);renderHardLimits();$("connectionTestStatus").textContent="";
  $("settingsPanel").hidden=false;
}
async function saveSettings(){
  const enteredKey=$("apiKey").value.trim();
  if(!$("apiKeyReplaceRow").hidden&&enteredKey) replaceOpenRouterKey(enteredKey);
  $("apiKey").value="";$("apiKeyReplaceRow").hidden=true;renderKeyStatus();
  localStorage.setItem("vesper.model",$("modelName").value.trim());
  const story=vault.stories.find(s=>s.id===activeStoryId);
  if(story){story.settings={...(story.settings||{}),model:$("modelName").value.trim(),temperature:Number($("temperatureSetting").value)||0.9,maxTokens:Number($("maxTokensSetting").value)||1200,intimacyPacing:$("intimacyPacing").value,requirePlotAfterSex:$("requirePlotAfterSex").checked};await saveVaultAtomic(db,vault);}
  $("settingsPanel").hidden=true;
}
async function runStoryTool(kind){
  if(sending)return;
  const prompts={
    continue:"[OOC: Continue directly from the exact point where the previous response stopped. If it ended mid-sentence, complete that sentence first. Do not repeat or summarize prior prose. Continue the scene naturally and stop on a complete narrative beat.]",
    elaborate:"[OOC: Elaborate the immediately preceding assistant response with richer sensory detail, character-specific behavior, dialogue, and atmosphere while preserving every established event and fact. Do not advance past its endpoint more than necessary.]"
  };
  if(kind==="myturn"){await generateMyTurnDraft();return;}
  const input=$("messageInput"),prior=input.value;input.value=prompts[kind];
  $("composer").requestSubmit();input.value=prior;
}
async function generateMyTurnDraft(){
  if(sending)return;
  const story=vault.stories.find(s=>s.id===activeStoryId),chat=vault.chats.find(c=>c.id===activeChatId);
  if(!story||!chat)return;
  const model=story.settings?.model||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL;
  if(!model){showStatus("Choose an OpenRouter model in Settings first.","error");return;}
  if(!getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY)){showStatus("Add your OpenRouter API key in Settings first.","error");return;}
  const input=$("messageInput"),prior=input.value;
  sending=true;setGenerationUi(true);activeGenerationController=new AbortController();showStatus("Drafting your turn…","working");
  try{
    const preferenceLines=vault.preferenceLines?.length?vault.preferenceLines:seedDefaultGreenLines();
    const instruction="[OOC TOOL — MY TURN: Draft Amanda's next possible roleplay turn for the user to review and edit. Write ONLY Amanda's proposed turn, in her established voice and consistent with current canon and scene context. Do not write any other character's dialogue, actions, thoughts, or reactions. Do not advance the scene beyond Amanda's proposed response. This is a draft only and must not be treated as sent canon until the user submits it.]";
    const result=await runTurn({vault,storyId:story.id,chatId:chat.id,model,preferenceLines,storySettings:story.settings||{},oocInstruction:instruction,personaDraft:true,temperature:story.settings?.temperature??0.9,maxTokens:story.settings?.maxTokens??1200,signal:activeGenerationController.signal});
    recordTurnUsage(result,{storyId:story.id,chatId:chat.id,model});
    if(result.blocked||!result.validation?.ok||!result.text?.trim())throw new Error("Vesper couldn't produce a usable draft.");
    input.value=result.text.trim();
    input.focus({preventScroll:true});
    input.setSelectionRange(input.value.length,input.value.length);
    showStatus("Draft ready. Edit anything you want, then Send when it feels like you.","notice");
  }catch(error){
    input.value=prior;
    showStatus(error?.name==="AbortError"?"Drafting stopped.":`Draft failed: ${error.message}`,"error");
  }finally{
    sending=false;activeGenerationController=null;setGenerationUi(false);
  }
}
function insertCommand(command){const input=$("messageInput"),start=input.selectionStart??input.value.length,end=input.selectionEnd??start,before=input.value.slice(0,start),after=input.value.slice(end),needsSpace=before&&!/\s$/.test(before);input.value=before+(needsSpace?" ":"")+command+after;const pos=(before+(needsSpace?" ":"")+command).length;input.focus({preventScroll:true});input.setSelectionRange(pos,pos);}
function stopGeneration(){
  if(activeGenerationController&&!activeGenerationController.signal.aborted){
    activeGenerationController.abort();
    showStatus("Generation stopped.","notice");
  }else{
    // Recover from a stale mobile UI where generation already finished but
    // Stop/Writing remained visible.
    sending=false;
    activeGenerationController=null;
    setGenerationUi(false);
    showStatus("Generation was already finished. Composer restored.","notice");
  }
}
async function regenerateLatestReply(){if(sending)return;const latest=[...vault.messages].filter(m=>m.chatId===activeChatId&&m.role==="assistant").sort((a,b)=>(b.ordinal??0)-(a.ordinal??0))[0];if(!latest){showStatus("There is no Vesper reply to regenerate yet.","notice");return;}await regenerateAssistantMessage(latest);}
async function retryFailedTurn(){
  if(sending||!retryMessageId)return;
  const message=vault.messages.find(m=>m.id===retryMessageId&&m.role==="user");
  if(!message){retryMessageId=null;showRetry(false);return;}
  const story=vault.stories.find(s=>s.id===message.storyId),chat=vault.chats.find(c=>c.id===message.chatId);if(!story||!chat)return;
  await generateReplyForMessage({message,story,chat});
}
function showRetry(show,label="Retry Reply"){const button=$("retryButton");if(button){button.hidden=!show;button.textContent=label;}}
function setGenerationUi(active){
  const send=$("sendButton"),stop=$("stopButton"),writing=$("writingState");
  if(send){send.disabled=active;send.hidden=active;}
  if(stop)stop.hidden=!active;
  if(writing)writing.hidden=!active;
}
async function generateReplyForMessage({message,story,chat}){
  const model=story.settings?.model||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL;
  if(!model){showStatus("Choose an OpenRouter model in Settings first.","error");return;}
  if(!getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY)){showStatus("Add your OpenRouter API key in Settings first.","error");return;}
  sending=true;setGenerationUi(true);showRetry(false);activeGenerationController=new AbortController();showStatus("Vesper is writing…","working");
  try{
    const preferenceLines=vault.preferenceLines?.length?vault.preferenceLines:seedDefaultGreenLines();
    const result=await runTurn({vault,storyId:story.id,chatId:chat.id,model,preferenceLines,storySettings:story.settings||{},temperature:story.settings?.temperature??0.9,maxTokens:story.settings?.maxTokens??1200,signal:activeGenerationController.signal});
    recordTurnUsage(result,{storyId:story.id,chatId:chat.id,model});
    if(result.blocked||!result.validation?.ok||!result.text?.trim()){const why=(result.issueTypes||result.validation?.issues?.map(x=>x.type)||[]).join(", ");throw new Error(why?`Vesper rejected the reply: ${why}.`:"Vesper couldn't produce a valid reply.");}
    const ordinal=Math.max(-1,...vault.messages.filter(m=>m.chatId===chat.id).map(m=>Number(m.ordinal)??-1))+1;
    vault.messages.push({id:makeId("message"),storyId:story.id,chatId:chat.id,role:"assistant",text:result.text,ordinal,createdAt:new Date().toISOString(),validation:result.validation,repaired:result.repaired});
    retryMessageId=null;await saveVaultAtomic(db,vault);sending=false;activeGenerationController=null;setGenerationUi(false);showStatus(result.repaired?"Reply repaired before display.":"",result.repaired?"notice":"clear");renderStory(story.id,chat.id);const composer=$("messageInput");composer.hidden=false;composer.focus({preventScroll:true});
  }catch(error){retryMessageId=message.id;showStatus(`Generation failed: ${error.message}`,"error");showRetry(true);}
  finally{sending=false;activeGenerationController=null;$("sendButton").disabled=false;$("sendButton").hidden=false;$("stopButton").hidden=true;$("writingState").hidden=true;}
}
async function sendTurn(event){
  event.preventDefault(); if(sending)return;
  const composerDraft=$("messageInput").value;
  const text=composerDraft.trim(),story=vault.stories.find(s=>s.id===activeStoryId),chat=vault.chats.find(c=>c.id===activeChatId);
  if(!text||!story||!chat)return;
  const runnable=storyIsRunnable(vault,story.id);if(!runnable.ok){showStatus(runnable.reason,"error");return;}
  const model=story.settings?.model||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL;
  if(!model){showStatus("Choose an OpenRouter model in Settings first.","error");return;}
  if(!getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY)){showStatus("Add your OpenRouter API key in Settings first.","error");return;}
  const now=new Date().toISOString(),ordinal=vault.messages.filter(m=>m.chatId===chat.id).length;
  const userMessage={id:makeId("message"),storyId:story.id,chatId:chat.id,role:"user",text,ordinal,createdAt:now};
  vault.messages.push(userMessage);
  $("messageInput").value="";await saveVaultAtomic(db,vault);renderStory(story.id,chat.id);$("messageInput").focus({preventScroll:true});
  retryMessageId=userMessage.id;
  await generateReplyForMessage({message:userMessage,story,chat});
}
function changeStory(e){const storyId=e.target.value,chat=chooseInitialChat(vault,storyId);renderStory(storyId,chat?.id);}
function renderStoryPicker(){const picker=$("storyPicker"),choices=listStoryChoices(vault);picker.innerHTML="";for(const choice of choices){const option=document.createElement("option");option.value=choice.storyId;option.textContent=`${choice.title} — ${choice.characterName} / ${choice.personaName}`;picker.appendChild(option);}if(activeStoryId)picker.value=activeStoryId;picker.hidden=choices.length<2;}
function showStatus(text,type="clear"){$("status").replaceChildren();$("status").className=`status ${type}`;$("status").hidden=!text;if(!text)return;if(type==="working"){const dot=document.createElement("span");dot.className="writing-dot";dot.setAttribute("aria-hidden","true");const label=document.createElement("span");label.textContent=text;$("status").append(dot,label);}else $("status").textContent=text;}
function openDeleteStory(storyId){
  const story=vault.stories.find(s=>s.id===storyId);if(!story)return;
  pendingDeleteStoryId=storyId;$("deleteStoryText").textContent='This will permanently delete "'+story.title+'" and its chats, messages, story-scoped memory, milestones, relationships, stats, scene state, knowledge, lore, and story-owned persona/characters from this device. This cannot be undone.';
  $("deleteStoryPanel").hidden=false;
}
function closeDeleteStory(){pendingDeleteStoryId=null;$("deleteStoryPanel").hidden=true;}
async function confirmDeleteStory(){
  const storyId=pendingDeleteStoryId;if(!storyId)return;
  const story=vault.stories.find(s=>s.id===storyId);if(!story){closeDeleteStory();return;}
  const chatIds=new Set(vault.chats.filter(x=>x.storyId===storyId).map(x=>x.id));
  const storyScoped=["messages","memoryEntries","milestones","relationships","statEvents","sceneStates","knowledgeEntries","loreEntries","usageEntries"];
  for(const key of storyScoped)vault[key]=(vault[key]||[]).filter(x=>x.storyId!==storyId&&!chatIds.has(x.chatId));
  vault.chats=vault.chats.filter(x=>x.storyId!==storyId);
  vault.personas=vault.personas.filter(x=>x.storyId!==storyId&&x.id!==story.personaId);
  const charIds=new Set([story.primaryCharacterId,...(story.characterIds||[])].filter(Boolean));
  vault.characters=vault.characters.filter(x=>x.storyId!==storyId&&!charIds.has(x.id));
  vault.stories=vault.stories.filter(x=>x.id!==storyId);vault.updatedAt=new Date().toISOString();
  if(activeStoryId===storyId){activeStoryId=null;activeChatId=null;}
  await saveVaultAtomic(db,vault);closeDeleteStory();showLibrary();
}
function showLibrary(){
  rememberTab("library");renderQueryMeter();
  $("dataView").hidden=true;$("chatView").hidden=true;$("emptyState").hidden=false;
  const library=$("storyLibrary");library.replaceChildren();
  const choices=listStoryChoices(vault);
  if(!choices.length){const empty=document.createElement("div");empty.className="library-empty";empty.textContent="No stories yet. Create one or import your Noctis vault.";library.append(empty);}
  for(const choice of choices){
    const story=vault.stories.find(s=>s.id===choice.storyId);
    const chatCount=vault.chats.filter(x=>x.storyId===choice.storyId).length;
    const messageCount=vault.messages.filter(x=>x.storyId===choice.storyId).length;
    const cast=(story?.characterIds||[]).map(id=>vault.characters.find(c=>c.id===id)?.name).filter(Boolean);
    const card=document.createElement("article");card.className="library-card";
    const open=document.createElement("button");open.type="button";open.className="library-open";
    const title=document.createElement("strong");title.textContent=choice.title;
    const castLine=document.createElement("span");castLine.className="library-cast";castLine.textContent=cast.length?cast.join(" · "):choice.characterName;
    const counts=document.createElement("span");counts.className="library-counts";counts.textContent=chatCount+" "+(chatCount===1?"chat":"chats")+" · "+messageCount+" saved "+(messageCount===1?"message":"messages");
    const cta=document.createElement("span");cta.className="library-cta";cta.textContent="Open story →";
    open.append(title,castLine,counts,cta);
    open.onclick=()=>{const chat=chooseInitialChat(vault,choice.storyId);renderStory(choice.storyId,chat?.id);};
    const del=document.createElement("button");del.type="button";del.className="library-delete";del.innerHTML="&#128465;&#65039;";del.title="Delete story";del.setAttribute("aria-label","Delete "+choice.title);del.onclick=()=>openDeleteStory(choice.storyId);
    card.append(open,del);library.append(card);
  }
  ["libraryNavButton","storyNavButton","memoryNavButton","milestonesNavButton"].forEach(id=>$(id).classList.remove("active"));$("libraryNavButton").classList.add("active");
}
function showDataView(kind){
  rememberTab(kind);
  $("emptyState").hidden=true;$("chatView").hidden=true;$("dataView").hidden=false;
  const isMemory=kind==="memory",storyId=activeStoryId;
  $("dataEyebrow").textContent=storyId?(vault.stories.find(s=>s.id===storyId)?.title||"ACTIVE STORY"):"VESPER";
  $("dataTitle").textContent=isMemory?"Memory":"Milestones";
  const rows=(isMemory?vault.memoryEntries:vault.milestones).filter(x=>!storyId||!x.storyId||x.storyId===storyId);
  const list=$("dataList");list.replaceChildren();
  if(!rows.length){const empty=document.createElement("div");empty.className="data-empty";empty.textContent=isMemory?"No memory entries for this story yet.":"No milestones for this story yet.";list.append(empty);}
  for(const row of rows){const card=document.createElement("article");card.className="data-card";const title=document.createElement("strong"),body=document.createElement("div");title.textContent=isMemory?(row.kind||"Memory"):(row.title||row.name||row.kind||"Milestone");body.textContent=row.text||row.description||row.label||JSON.stringify(row.data||row.value||"");card.append(title,body);list.append(card);}
  ["libraryNavButton","storyNavButton","memoryNavButton","milestonesNavButton"].forEach(id=>$(id).classList.remove("active"));
  $(isMemory?"memoryNavButton":"milestonesNavButton").classList.add("active");
}
function showActiveStory(){rememberTab("story");if(activeStoryId){renderStory(activeStoryId,activeChatId);return;}const s=vault.stories[0];if(s){const c=chooseInitialChat(vault,s.id);renderStory(s.id,c?.id);}else showLibrary();}
function render(){
  const tab=lastTab();
  if(tab==="library"){showLibrary();return;}
  if(!vault.stories.length){showLibrary();return;}
  const s=vault.stories[0],c=vault.chats.find(x=>x.storyId===s.id);activeStoryId=s.id;activeChatId=c?.id||null;
  if(tab==="memory"){showDataView("memory");return;}
  if(tab==="milestones"){showDataView("milestones");return;}
  renderStory(s.id,c?.id);
}
function isOpeningMessage(message){
  const firstAssistant=vault.messages.filter(m=>m.chatId===message.chatId&&m.role==="assistant").sort((a,b)=>(a.ordinal??0)-(b.ordinal??0))[0];
  return firstAssistant?.id===message.id;
}
async function editUserMessage(message){
  if(sending){showStatus("Wait for Vesper to finish writing before editing.","notice");return;}
  const next=window.prompt("Edit your post",String(message.text||""));
  if(next===null)return;
  const text=next.trim();if(!text||text===String(message.text||"").trim())return;
  message.text=text;message.editedAt=new Date().toISOString();vault.updatedAt=message.editedAt;
  await saveVaultAtomic(db,vault);renderStory(message.storyId,message.chatId);showStatus("Post edited. Vesper will use the corrected version from now on.","notice");
}
async function regenerateAssistantMessage(message){
  if(sending)return;
  const story=vault.stories.find(s=>s.id===message.storyId),chat=vault.chats.find(c=>c.id===message.chatId);if(!story||!chat)return;
  const later=vault.messages.filter(m=>m.chatId===message.chatId&&(m.ordinal??0)>(message.ordinal??0));
  if(later.length&&!window.confirm("Regenerate this reply and remove the later messages in this chat?"))return;
  vault.messages=vault.messages.filter(m=>m.chatId!==message.chatId||(m.ordinal??0)<(message.ordinal??0));await saveVaultAtomic(db,vault);renderStory(story.id,chat.id);
  const previous=[...vault.messages].filter(m=>m.chatId===chat.id&&m.role==="user").sort((x,y)=>(x.ordinal??0)-(y.ordinal??0)).at(-1);
  if(!previous){showStatus("There is no user post to regenerate from.","error");return;}
  await generateReplyForMessage({message:previous,story,chat});
}
function renderMessage(node,message){
  node.replaceChildren();
  const text=String(message.text||"");
  if(message.role==="user"){
    const body=document.createElement("div");body.className="user-message-text";body.textContent=text;node.append(body);
    const controls=document.createElement("div");controls.className="message-controls";
    const edit=document.createElement("button");edit.type="button";edit.className="message-edit";edit.textContent="Edit";edit.setAttribute("aria-label","Edit this post");edit.onclick=()=>editUserMessage(message);controls.append(edit);
    if(message.editedAt){const tag=document.createElement("small");tag.className="edited-tag";tag.textContent="edited";controls.append(tag);}
    node.append(controls);return;
  }
  const quotePattern=/(["“][^"”\n]+["”])/g;
  for(const paragraph of text.split(/\n+/)){
    if(!paragraph.trim())continue;
    const block=document.createElement("div");block.className="message-paragraph";
    let last=0;
    for(const match of paragraph.matchAll(quotePattern)){
      if(match.index>last)block.append(document.createTextNode(paragraph.slice(last,match.index)));
      const speech=document.createElement("span");speech.className="dialogue-highlight";speech.textContent=match[0];block.append(speech);
      last=match.index+match[0].length;
    }
    if(last<paragraph.length)block.append(document.createTextNode(paragraph.slice(last)));
    node.append(block);
  }
  const controls=document.createElement("div");controls.className="message-controls assistant-controls";const regen=document.createElement("button");regen.type="button";regen.className="message-edit";regen.textContent="Regenerate";regen.onclick=()=>regenerateAssistantMessage(message);controls.append(regen);node.append(controls);
}
function jumpMessagesToLatest(smooth=false){
  const scroller=$("messages");if(!scroller)return;
  const behavior=smooth?"smooth":"auto";
  scroller.scrollTo({top:scroller.scrollHeight,behavior});
  const last=scroller.lastElementChild;
  if(last)last.scrollIntoView({block:"end",behavior});
  const b=$("scrollBottomButton");if(b)b.hidden=true;
}
function updateScrollBottomButton(){const scroller=$("messages"),b=$("scrollBottomButton");if(!scroller||!b)return;const distance=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight;b.hidden=distance<80;}
function bindMessageScroller(){const scroller=$("messages");if(!scroller||scroller.dataset.bound==="1")return;scroller.dataset.bound="1";scroller.addEventListener("scroll",updateScrollBottomButton,{passive:true});}
function renderStory(storyId,chatId){rememberTab("story");renderQueryMeter();if(!sending)setGenerationUi(false);activeStoryId=storyId;activeChatId=chatId;$("dataView").hidden=true;$("storyNavButton").classList.add("active");$("libraryNavButton").classList.remove("active");$("memoryNavButton").classList.remove("active");$("milestonesNavButton").classList.remove("active");renderStoryPicker();const s=vault.stories.find(x=>x.id===storyId);$("emptyState").hidden=true;$("chatView").hidden=false;$("storyTitle").textContent=s?.title||"Untitled";
 const rows=vault.messages.filter(m=>m.storyId===storyId&&(!chatId||m.chatId===chatId)&&!(m.role==="user"&&/^\s*\/continue\s*$/i.test(String(m.text||""))));$("messages").innerHTML=rows.map(m=>`<article class="message ${m.role==="user"?"user":"assistant"}"></article>`).join("");[...$("messages").children].forEach((n,i)=>renderMessage(n,rows[i]));const latest=[...rows].sort((x,y)=>(Number(y.ordinal)??0)-(Number(x.ordinal)??0))[0];if(!sending&&latest?.role==="user"){retryMessageId=latest.id;showRetry(true,"Generate Missing Reply");showStatus("Your last turn has no Vesper reply yet.","notice");}else if(!sending){showRetry(false);}bindMessageScroller();jumpMessagesToLatest(false);requestAnimationFrame(()=>{jumpMessagesToLatest(false);requestAnimationFrame(()=>{jumpMessagesToLatest(false);setTimeout(()=>{jumpMessagesToLatest(false);updateScrollBottomButton();},80);});});}
boot().catch(error=>{document.body.innerHTML=`<main style="padding:24px;color:#f3ece7;background:#090708;min-height:100vh"><h1>Vesper could not start.</h1><pre></pre></main>`;document.querySelector("pre").textContent=error.stack||error.message;});

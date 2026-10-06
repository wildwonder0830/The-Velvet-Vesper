import { openVesperDb, loadVault, saveVaultAtomic } from "./storage/vault-store.js";
import { previewImport, prepareImport, commitPreparedImport } from "./migration/import-service.js";
import { makeId } from "./schema.js";
import { createMemory } from "./memory/memory-manager.js";
import { recordKnowledge } from "./knowledge/ledger.js";
import { createSceneState } from "./scene/scene-state.js";
import { runTurn } from "./chat/turn-engine.js";
import { setDeviceSecret, getDeviceSecret, DEVICE_SECRET_NAMES } from "./settings/secret-store.js";
import { seedDefaultGreenLines } from "./rules/preference-lines.js";
import { storyIsRunnable, listStoryChoices, chooseInitialChat } from "./library/story-selection.js";

const $ = id => document.getElementById(id);
const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
let db, vault, preparedImport = null, activeStoryId = null, activeChatId = null, sending = false;

async function boot() {
  db = await openVesperDb(); vault = await loadVault(db); bindUi(); render();
}
function bindUi() {
  $("importButton").onclick=()=>$("importFile").click(); $("importFile").onchange=handleImportFile;
  $("newStoryButton").onclick=openStorySetup; $("composer").onsubmit=sendTurn;
  $("storySetupClose").onclick=closeStorySetup; $("createStoryFromSetup").onclick=createStarterStory;
  $("settingsButton").onclick=openSettings; $("settingsClose").onclick=()=>$("settingsPanel").hidden=true;
  $("saveSettings").onclick=saveSettings; $("storyPicker").onchange=changeStory;
}
async function handleImportFile(e){
  const file=e.target.files?.[0]; if(!file)return;
  try{const source=JSON.parse(await file.text()), preview=previewImport(source); preparedImport=prepareImport(source);
    const counts=preview.counts||preparedImport.preview?.counts||{}; $("importPreview").hidden=false;
    $("importPreview").innerHTML=`<strong>Import preview</strong><p>${Object.entries(counts).map(([k,v])=>`${k}: ${v}`).join(" · ")}</p><p>No existing Vesper data changes until you confirm.</p><button class="primary" id="confirmImport">Confirm Import</button>`;
    $("confirmImport").onclick=confirmImport;
  }catch(error){$("importPreview").hidden=false;$("importPreview").textContent=`Import error: ${error.message}`;}
}
async function confirmImport(){if(!preparedImport)return;await commitPreparedImport(db,preparedImport);vault=await loadVault(db);preparedImport=null;render();}
function openStorySetup(){$("storySetupPanel").hidden=false;}
function closeStorySetup(){$("storySetupPanel").hidden=true;}
async function createStarterStory(){
  const title=$("setupStoryTitle").value.trim()||"Untitled Vesper Story",personaName=$("setupPersonaName").value.trim();
  const characterNames=[$("setupCharacterOne").value.trim(),$("setupCharacterTwo").value.trim()].filter(Boolean);
  if(!personaName||!characterNames.length)return;
  const now=new Date().toISOString(),storyId=makeId("story"),chatId=makeId("chat"),personaId=makeId("persona");
  const blackthorn=title==="The Blackthorn Prophecy"&&personaName==="Amanda"&&characterNames.includes("Aedan Blackthorn")&&characterNames.includes("Aeron Blackthorn");
  const persona={id:personaId,name:personaName,storyId,profile:blackthorn?{age:24,adult:true,species:"immortal witch-wolf hybrid",history:"Severely abused and deliberately diminished by her family; kept isolated except for required appearances. Her father has forced suppressants on her for years to lock down both wolf and witch, muting supernatural healing and her side of the mate bond.",family:"Her full-blooded half-sister is the favored daughter and widely expected to become Luna.",supernaturalForm:"A spectral ghost-pale wolf with white/silver mane-like fur and red-and-silver witch-light emanating from her.",healing:"Suppression prevents normal immortal healing. As the fated bond strengthens, Amanda's own returning supernatural power progressively heals old scars.",prophecy:"Full suppression breaks only when the prophecy is fulfilled through her first intimate union with her fated mates; recognition, love, or kissing alone cannot trigger full release."}:{age:24,adult:true},directives:["Never narrate this persona's dialogue, actions, thoughts, feelings, choices, or reactions.","Abuse history is canon but does not define the persona's entire personality or make her inherently fragile."],createdAt:now,updatedAt:now};
  const profiles={"Aedan Blackthorn":{age:28,adult:true,species:"werewolf",rank:"co-Alpha",personality:"Calm, strategic, observant, disciplined, patient, intelligent, difficult to manipulate. Quiet authority, dry humor, quieter when angry. Protective without infantilizing. Affection through consistency, deliberate touch, practical care, and remembered details.",flaw:"Can over-calculate.",romance:"Amanda is his first romantic and intimate partner. He wants a distinct individual relationship with her as well as the triad bond."},"Aeron Blackthorn":{age:28,adult:true,species:"werewolf",rank:"co-Alpha",personality:"Playful, perceptive, charismatic, affectionate, curious, stubborn, emotionally direct, quick-witted. Tactile and teasing, with hotter jealousy, obvious affection, and a faster temper; sharply focused when serious.",flaw:"Can act from emotional impulse.",romance:"Amanda is his first romantic and intimate partner. He wants a distinct individual relationship with her as well as the triad bond."}};
  const characters=characterNames.map((name,index)=>({id:makeId("character"),name,storyId,profile:blackthorn?(profiles[name]||{age:28,adult:true}):{age:28,adult:true},directives:["Maintain an individual voice, memory, knowledge state, and relationship with the persona.","Never merge identity, memories, actions, dialogue, or milestones with another character.",...(blackthorn?["Aedan and Aeron are equal co-Alphas and lifelong brothers. Neither is subordinate. Their sibling bond is never romantic or sexual.","They share one three-person fated bond with Amanda while each twin also loves and courts Amanda individually. Amanda is never merely 'the twins' mate'."]:[])],castOrder:index,createdAt:now,updatedAt:now}));
  vault.personas.push(persona);vault.characters.push(...characters);
  const story={id:storyId,title,characterIds:characters.map(x=>x.id),primaryCharacterId:characters[0].id,personaId,settings:{model:localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL},createdAt:now,updatedAt:now};
  if(blackthorn){story.premise="Aedan and Aeron Blackthorn are equal co-Alphas who share one fated mate: Amanda. Everyone expects their public mate announcement to name Amanda's favored full-blooded half-sister. The twins already know Amanda is their mate.";story.openingScene={location:"Major formal pack gathering for the co-Alphas' mate and future Luna announcement",facts:["Amanda is present because her family requires the appearance.","The favored half-sister deliberately trips Amanda at the start, causing her to fall.","Aedan and Aeron both directly witness the sister trip Amanda. Never rewrite this as an accident or something either twin missed.","The sister then says: Oh, you should really be more careful. And don't forget to smile. You look sad.","The family has no advance warning that Amanda will be named.","The twins already know Amanda is their mate before the announcement; do not write uncertain mate recognition.","Stop before narrating Amanda's response, reaction, dialogue, thoughts, feelings, or choices."],direction:"Aedan reacts with controlled strategic focus and recognizes evidence of the family dynamic. Aeron reacts hotter and less diplomatically without becoming foolish. The public reveal should land as a genuine shock."};story.prophecy={state:"unfulfilled",unlockTrigger:"first intimate union with her fated mates",earlyUnlockForbidden:true,effects:["forced suppression breaks","witch power fully returns","wolf fully returns","immortal healing resumes"]};}
  vault.stories.push(story);vault.chats.push({id:chatId,storyId,title:"Main Story",createdAt:now,updatedAt:now});
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
  if(blackthorn){
    const model=story.settings?.model||localStorage.getItem("vesper.model"),key=getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY);
    if(model&&key){
      sending=true;$("sendButton").disabled=true;showStatus("Vesper is opening the story…","working");
      try{
        const preferenceLines=vault.preferenceLines?.length?vault.preferenceLines:seedDefaultGreenLines();
        const result=await runTurn({vault,storyId,chatId,model,preferenceLines,storySettings:story.settings||{},opening:true});
        if(result.blocked||!result.validation?.ok||!result.text?.trim()) throw new Error("Opening was blocked by a Vesper hard rule.");
        vault.messages.push({id:makeId("message"),storyId,chatId,role:"assistant",text:result.text,ordinal:0,createdAt:new Date().toISOString(),validation:result.validation,repaired:result.repaired});
        await saveVaultAtomic(db,vault);renderStory(storyId,chatId);showStatus(result.repaired?"Opening repaired before display.":"","notice");
      }catch(error){showStatus(`Story created, but opening generation failed: ${error.message}`,"error");}
      finally{sending=false;$("sendButton").disabled=false;}
    }else showStatus("The Blackthorn Prophecy is ready. Add your OpenRouter key and model in Settings, then begin when ready.","notice");
  }else showStatus("Story created. Cast identities are isolated and ready for canon.","notice");
}
function openSettings(){
  const story=vault.stories.find(s=>s.id===activeStoryId)||vault.stories[0];
  $("apiKey").value=getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY)||"";
  $("modelName").value=story?.settings?.model||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL;
  $("settingsPanel").hidden=false;
}
async function saveSettings(){
  setDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY,$("apiKey").value.trim());
  localStorage.setItem("vesper.model",$("modelName").value.trim());
  const story=vault.stories.find(s=>s.id===activeStoryId);
  if(story){story.settings={...(story.settings||{}),model:$("modelName").value.trim()};await saveVaultAtomic(db,vault);}
  $("settingsPanel").hidden=true;
}
async function sendTurn(event){
  event.preventDefault(); if(sending)return;
  const text=$("messageInput").value.trim(),story=vault.stories.find(s=>s.id===activeStoryId),chat=vault.chats.find(c=>c.id===activeChatId);
  if(!text||!story||!chat)return;
  const runnable=storyIsRunnable(vault,story.id);if(!runnable.ok){showStatus(runnable.reason,"error");return;}
  const model=story.settings?.model||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL;
  if(!model){showStatus("Choose an OpenRouter model in Settings first.","error");return;}
  if(!getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY)){showStatus("Add your OpenRouter API key in Settings first.","error");return;}
  const now=new Date().toISOString(),ordinal=vault.messages.filter(m=>m.chatId===chat.id).length;
  vault.messages.push({id:makeId("message"),storyId:story.id,chatId:chat.id,role:"user",text,ordinal,createdAt:now});
  $("messageInput").value="";await saveVaultAtomic(db,vault);renderStory(story.id,chat.id);
  sending=true;$("sendButton").disabled=true;showStatus("Vesper is writing…","working");
  try{
    const preferenceLines=vault.preferenceLines?.length?vault.preferenceLines:seedDefaultGreenLines();
    const result=await runTurn({vault,storyId:story.id,chatId:chat.id,model,preferenceLines,storySettings:story.settings||{}});
    if(result.blocked||!result.validation?.ok||!result.text?.trim()) throw new Error("Reply was blocked by a Vesper hard rule.");
    vault.messages.push({id:makeId("message"),storyId:story.id,chatId:chat.id,role:"assistant",text:result.text,ordinal:ordinal+1,createdAt:new Date().toISOString(),validation:result.validation,repaired:result.repaired});
    await saveVaultAtomic(db,vault);showStatus(result.repaired?"Reply repaired before display.":"",result.repaired?"notice":"clear");renderStory(story.id,chat.id);
  }catch(error){showStatus(error.message,"error");}
  finally{sending=false;$("sendButton").disabled=false;}
}
function changeStory(e){const storyId=e.target.value,chat=chooseInitialChat(vault,storyId);renderStory(storyId,chat?.id);}
function renderStoryPicker(){const picker=$("storyPicker"),choices=listStoryChoices(vault);picker.innerHTML="";for(const choice of choices){const option=document.createElement("option");option.value=choice.storyId;option.textContent=`${choice.title} — ${choice.characterName} / ${choice.personaName}`;picker.appendChild(option);}if(activeStoryId)picker.value=activeStoryId;picker.hidden=choices.length<2;}
function showStatus(text,type="clear"){$("status").textContent=text;$("status").className=`status ${type}`;$("status").hidden=!text;}
function render(){if(vault.stories.length){const s=vault.stories[0],c=vault.chats.find(x=>x.storyId===s.id);renderStory(s.id,c?.id);}else{$("emptyState").hidden=false;$("chatView").hidden=true;}}
function renderStory(storyId,chatId){activeStoryId=storyId;activeChatId=chatId;renderStoryPicker();const s=vault.stories.find(x=>x.id===storyId);$("emptyState").hidden=true;$("chatView").hidden=false;$("storyTitle").textContent=s?.title||"Untitled";
 const rows=vault.messages.filter(m=>m.storyId===storyId&&(!chatId||m.chatId===chatId));$("messages").innerHTML=rows.map(m=>`<article class="message ${m.role==="user"?"user":"assistant"}"></article>`).join("");[...$("messages").children].forEach((n,i)=>n.textContent=rows[i].text);$("messages").scrollTop=$("messages").scrollHeight;}
boot().catch(error=>{document.body.innerHTML=`<main style="padding:24px;color:#f3ece7;background:#090708;min-height:100vh"><h1>Vesper could not start.</h1><pre></pre></main>`;document.querySelector("pre").textContent=error.stack||error.message;});

import { openVesperDb, loadVault, saveVaultAtomic } from "./storage/vault-store.js";
import { previewImport, prepareImport, commitPreparedImport } from "./migration/import-service.js";
import { makeId } from "./schema.js";
import { runTurn } from "./chat/turn-engine.js";
import { setDeviceSecret, getDeviceSecret, DEVICE_SECRET_NAMES } from "./settings/secret-store.js";
import { seedDefaultGreenLines } from "./rules/preference-lines.js";
import { storyIsRunnable, listStoryChoices, chooseInitialChat } from "./library/story-selection.js";

const $ = id => document.getElementById(id);
let db, vault, preparedImport = null, activeStoryId = null, activeChatId = null, sending = false;

async function boot() {
  db = await openVesperDb(); vault = await loadVault(db); bindUi(); render();
}
function bindUi() {
  $("importButton").onclick=()=>$("importFile").click(); $("importFile").onchange=handleImportFile;
  $("newStoryButton").onclick=createStarterStory; $("composer").onsubmit=sendTurn;
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
async function createStarterStory(){
  const now=new Date().toISOString(),storyId=makeId("story"),chatId=makeId("chat");
  vault.stories.push({id:storyId,title:"New Vesper Story",characterIds:[],personaId:null,settings:{model:""},createdAt:now,updatedAt:now});
  vault.chats.push({id:chatId,storyId,title:"Main Story",createdAt:now,updatedAt:now});vault.updatedAt=now;await saveVaultAtomic(db,vault);renderStory(storyId,chatId);
}
function openSettings(){
  const story=vault.stories.find(s=>s.id===activeStoryId)||vault.stories[0];
  $("apiKey").value=getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY)||"";
  $("modelName").value=story?.settings?.model||localStorage.getItem("vesper.model")||"";
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
  const now=new Date().toISOString(),ordinal=vault.messages.filter(m=>m.chatId===chat.id).length;
  vault.messages.push({id:makeId("message"),storyId:story.id,chatId:chat.id,role:"user",text,ordinal,createdAt:now});
  $("messageInput").value="";await saveVaultAtomic(db,vault);renderStory(story.id,chat.id);
  const model=story.settings?.model||localStorage.getItem("vesper.model");
  if(!model){showStatus("Choose an OpenRouter model in Settings first.","error");return;}
  sending=true;$("sendButton").disabled=true;showStatus("Vesper is writing…","working");
  try{
    const preferenceLines=vault.preferenceLines?.length?vault.preferenceLines:seedDefaultGreenLines();
    const result=await runTurn({vault,storyId:story.id,chatId:chat.id,model,preferenceLines,storySettings:story.settings||{}});
    if(!result.validation.ok) throw new Error("Reply was blocked by a Vesper hard rule.");
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

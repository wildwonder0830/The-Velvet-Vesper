import {assertDirectorStoryOpen,parseDirectorCommand,directorPreferences,updateDirectorPreferences,directorInstruction} from "./chat/director.js";
import {mountChatMenu,bindComposerViewport} from "./ui/chat-menu.js";
import {mountHistoricalMilestones} from './ui/historical-milestones.js';
import {validateCanonicalMilestone} from './milestones/verifier.js';
import {activePersonaId,storyPersonaIds} from './personas/persona-store.js';
import {mountPersonas} from './ui/personas.js';
import {scanMilestoneEvents,confirmMilestoneEvent,milestonePresentation} from './milestones/events.js';
import { messageSpeakerLabel } from "./ui/message-speaker.js";
import { prepareAssistantEdit, originalAssistantText } from "./chat/message-edit.js";
import { createBackupFile, shareBackup, downloadBackupFile, readBackupFile, canShareBackup, isIOSBackupEnvironment } from "./backup/backup-transfer.js";
import { createStoryPhone } from "./ui/story-phone.js";
import { appendPhoneMessage, markPhoneThreadRead } from "./phone/phone-state.js";
import { reconcilePhoneDependencies } from "./phone/phone-context.js";
import { runPhoneTurn } from "./phone/phone-engine.js";
import { createStoryScroller, isMobileStoryLayout } from "./ui/story-scroller.js";
import { prepareVaultRegeneration, completeVaultRegeneration } from "./chat/regeneration.js";
import { mountMilestoneNotifications } from "./ui/milestone-notifications.js";
import { openVesperDb, loadVault, saveVaultAtomic, subscribeVaultSaves } from "./storage/vault-store.js";
import { commitPreparedImport } from "./migration/import-service.js";
import { makeId } from "./schema.js";
const VESPER_APP_VERSION = "1.1.1";
const VESPER_SCHEMA_VERSION = 1;
import { createMemory } from "./memory/memory-manager.js";
import { recordKnowledge } from "./knowledge/ledger.js";
import { createSceneState } from "./scene/scene-state.js";
import { runTurn } from "./chat/turn-engine.js";
import { replaceOpenRouterKey, getDeviceSecret, DEVICE_SECRET_NAMES } from "./settings/secret-store.js";
import { seedDefaultGreenLines } from "./rules/preference-lines.js";
import { storyIsRunnable, listStoryChoices, chooseInitialChat } from "./library/story-selection.js";
import { recordUsage } from "./usage/usage-ledger.js";
import { normalizeIntimacyStyle } from "./settings/intimacy-style.js";
import { modelOptions, validateModelId } from "./settings/model-registry.js";

const $ = id => document.getElementById(id);
const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
let importingBackup=false;
let settingsFormSnapshot="";
let settingsModelSnapshot="",settingsModelFormSnapshot="";
const modelIndependentSignature=()=>JSON.stringify(["temperatureSetting","maxTokensSetting","intimacyPacing","requirePlotAfterSex","cncToggle"].map(id=>{const el=$(id);return el?.type==="checkbox"?el.checked:el?.value;}));
const settingsFormSignature=()=>JSON.stringify(["modelName","temperatureSetting","maxTokensSetting","intimacyPacing","requirePlotAfterSex","cncToggle"].map(id=>{const el=$(id);return el?.type==="checkbox"?el.checked:el?.value;}));
let storyPhone,phoneBusy=false,personasUi,milestoneBaseline=new Map();
async function saveAppVault(database,candidate,options){
 const ids=candidate.messages.filter(m=>milestoneBaseline.get(m.id)!==m.text).map(m=>m.id);
 const next=importingBackup?candidate:scanMilestoneEvents(candidate,ids);
 const saved=await saveVaultAtomic(database,next,{expectedRevision:candidate.storageRevision,...options});
 Object.assign(candidate,saved);Object.defineProperty(candidate,"storageRevision",{value:saved.storageRevision,writable:true,configurable:true,enumerable:false});milestoneBaseline=new Map(saved.messages.map(m=>[m.id,m.text]));return saved;
}
let db, vault, preparedImport = null, activeStoryId = null, activeChatId = null, pendingDeleteStoryId = null, pendingBlockedReview = null, sending = false, retryMessageId = null, retryOpeningStoryId = null, activeGenerationController = null;
const LAST_TAB_KEY="vesper.ui.lastTab";
const LAST_STORY_KEY="vesper.ui.lastStoryId";
const rememberTab=tab=>{try{localStorage.setItem(LAST_TAB_KEY,tab);}catch{}};
const lastTab=()=>{try{return localStorage.getItem(LAST_TAB_KEY)||"library";}catch{return "library";}};
const rememberStory=storyId=>{try{if(storyId)localStorage.setItem(LAST_STORY_KEY,storyId);}catch{}};
const lastStoryId=()=>{try{return localStorage.getItem(LAST_STORY_KEY)||"";}catch{return "";}};
const QUERY_LIMIT=1000;
const USAGE_RESET_TIME_ZONE="America/Los_Angeles";
const USAGE_RESET_HOUR=17;
const usageDateTimeFormatter=new Intl.DateTimeFormat("en-CA",{timeZone:USAGE_RESET_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"});
function usageCycleKey(date=new Date()){
  const parts=Object.fromEntries(usageDateTimeFormatter.formatToParts(date).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  let y=Number(parts.year),m=Number(parts.month),d=Number(parts.day);
  const hour=Number(parts.hour);
  if(!Number.isFinite(y)||!Number.isFinite(m)||!Number.isFinite(d)||!Number.isFinite(hour))return "";
  if(hour<USAGE_RESET_HOUR){
    const prior=new Date(Date.UTC(y,m-1,d)-86400000);
    y=prior.getUTCFullYear();m=prior.getUTCMonth()+1;d=prior.getUTCDate();
  }
  return [y,String(m).padStart(2,"0"),String(d).padStart(2,"0")].join("-");
}
function usageCycleKeyForEntry(entry){const d=new Date(entry.createdAt);return Number.isNaN(d.getTime())?"":usageCycleKey(d);}
function queryCountCurrentCycle(){const cycle=usageCycleKey();return (vault?.usageEntries||[]).filter(e=>usageCycleKeyForEntry(e)===cycle).length;}
function renderQueryMeter(){const el=$("queryCount");if(el)el.textContent=`${queryCountCurrentCycle().toLocaleString()} / ${QUERY_LIMIT.toLocaleString()}`;}
function recordTurnUsage(result,{storyId,chatId,model}){const usages=result?.usage||[];for(const usage of usages){vault.usageEntries.push(recordUsage({storyId,chatId,model,promptTokens:usage?.prompt_tokens||0,completionTokens:usage?.completion_tokens||0,cost:null}));}renderQueryMeter();}

function applyPhoneUsage(entry,usage){
  const tokens=value=>Number.isFinite(value)&&value>=0?value:0;
  entry.promptTokens=tokens(usage?.prompt_tokens);entry.completionTokens=tokens(usage?.completion_tokens);entry.totalTokens=entry.promptTokens+entry.completionTokens;
}
function reconcilePhoneRecords(){
  const clean=reconcilePhoneDependencies(vault);
  for(const story of vault.stories)if(story.phone)story.phone=clean.stories.find(s=>s.id===story.id).phone;
}
async function commitPhoneCandidate(candidate,expectedRevision){
  candidate.updatedAt=new Date().toISOString();
  await saveAppVault(db,candidate,{expectedRevision});
  vault=candidate;renderQueryMeter();storyPhone?.refresh();
}
async function sendPhoneMessage({storyId,threadId,text,action,onSubmitted,isViewed}){
  if(sending||phoneBusy)throw new Error("Wait for the current request to finish.");
  const story=vault.stories.find(s=>s.id===storyId),thread=story?.phone?.threads.find(t=>t.id===threadId);
  if(!thread)throw new Error("Phone thread is unavailable.");
  if(thread.historicalOnly||thread.participantIds.some(id=>!vault.characters.some(c=>c.id===id)))throw new Error("Historical contact archives are read-only; no AI request was made.");
  if(!getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY))throw new Error("Add your OpenRouter API key in Settings first.");
  const model=story.settings?.model||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL;
  phoneBusy=true;
  try{
    let candidate=action==="send"?appendPhoneMessage(vault,storyId,threadId,{senderType:"persona",senderId:activePersonaId(story),text:text.trim()}):structuredClone(vault);
    const entry=recordUsage({storyId,chatId:thread.chatId,model});candidate.usageEntries.push(entry);
    await commitPhoneCandidate(candidate,vault.storageRevision);onSubmitted?.();
    const requestVault=structuredClone(vault),revision=vault.storageRevision;
    // Legacy stories resolve their model without rewriting the stored settings.
    const generationVault=structuredClone(requestVault),generationStory=generationVault.stories.find(s=>s.id===storyId);
    generationStory.settings={...(generationStory.settings||{}),model};
    let result;
    try{result=await runPhoneTurn({vault:generationVault,storyId,threadId,action});}
    catch(error){
      if(error?.phoneUsage){const accounted=structuredClone(requestVault);applyPhoneUsage(accounted.usageEntries.find(e=>e.id===entry.id),error.phoneUsage);await commitPhoneCandidate(accounted,revision);}
      throw error;
    }
    candidate=structuredClone(requestVault);
    for(const message of result.messages)candidate=appendPhoneMessage(candidate,storyId,threadId,message);
    if(isViewed?.())candidate=markPhoneThreadRead(candidate,storyId,threadId);
    const usage=candidate.usageEntries.find(e=>e.id===entry.id);
    applyPhoneUsage(usage,result.usage);
    await commitPhoneCandidate(candidate,revision);
  }finally{phoneBusy=false;storyPhone?.refresh();}
}

function applyVenomousAssistantRole(){
  let changed=false;
  for(const story of vault.stories||[]){
    if(story.title!=="Venomous Devotion"||story.personaBinding)continue;
    const valec=(vault.characters||[]).find(c=>c.storyId===story.id&&c.name==="Valec Thorne");
    if(!valec)continue;
    const persona=(vault.personas||[]).find(p=>p.id===activePersonaId(story));
    if(persona){
      persona.profile={...(persona.profile||{}),work:"Valec Thorne's personal assistant and executive aide inside the elite supernatural command organization. She manages his schedule, communications, files, access, and day-to-day command logistics while concealing that she is a prey-species rabbit shifter.",onlineUsername:"LILBUNNYBBY",onlineHistory:"For months she has had an emotionally intimate and explicitly sexual relationship through an anonymous shifter app as LILBUNNYBBY with a man she knows only as nobunnyonmymenu. She does not know he is Valec Thorne."};
      changed=true;
    }
    const venomousPremise="For months, Amanda and Valec Thorne have maintained an emotionally intimate and explicitly sexual relationship through an anonymous shifter app without knowing each other's real-world identity. Valec is the S-rank black-mamba commander whose personal assistant and executive aide is Amanda; online he is nobunnyonmymenu, while Amanda is LILBUNNYBBY. He affectionately calls his anonymous partner little rabbit/bunny. Amanda secretly is a rabbit shifter and conceals her prey identity at work. Her supposed snake-repellent scent affects Valec like an intense mate-attraction signal.";
    if(story.premise!==venomousPremise){story.premise=venomousPremise;changed=true;}
    const venomousOpening={location:"Valec Thorne's private office inside the elite supernatural command center",facts:["The story begins after months of established anonymous online emotional and sexual history between Amanda and nobunnyonmymenu.","Valec has begun privately suspecting that Amanda may be his anonymous partner, but he does not yet know for certain.","Before calling Amanda into his office from her personal-assistant workstation just outside, Valec schedules a delayed message to his anonymous partner so it will arrive while she is standing in front of him. The message should be innocuous but intimate and recognizable as part of their established private dynamic.","Amanda enters Valec's office while wearing the scent product she believes repels snake shifters. To Valec it is intensely provocative and reinforces his suspicion.","While Valec observes Amanda, the delayed message arrives and her phone audibly dings in her pocket.","The stress/startle plus unstable concealment causes Amanda's rabbit ears to pop out visibly. This is involuntary and may be narrated.","The phone ding and rabbit ears together give Valec decisive confirmation that Amanda is his anonymous little rabbit.","Valec does NOT immediately tell Amanda that he is nobunnyonmymenu. He keeps that knowledge to himself for the moment and reacts with controlled, predatory intelligence rather than blurting out the reveal.","Stop before narrating Amanda's voluntary reaction, dialogue, decision, or attempt to explain."],direction:"Play the opening with strong dramatic irony, scent tension, predator/prey contrast, and Valec's unnerving self-control. Online Valec is warm, attentive, teasing, dominant, and sexually familiar with Amanda; Commander Thorne is controlled, intimidating, observant, and economical. When confirmation lands, let the internal impact be intense while his outward reaction remains restrained. Do not rush the identity reveal beyond the configured beat."};
    if(!story.openingScene){story.openingScene=venomousOpening;changed=true;}
    const hasAmandaHandle=(vault.memoryEntries||[]).some(m=>m.storyId===story.id&&m.data?.key==="amanda-online-identity");
    if(!hasAmandaHandle){
      const chat=(vault.chats||[]).find(c=>c.storyId===story.id);
      if(chat){
        vault.memoryEntries.push(createMemory({storyId:story.id,chatId:chat.id,kind:"canon",text:"Amanda's anonymous shifter-app username is LILBUNNYBBY. Valec knows her only by that handle online before the reveal.",data:{key:"amanda-online-identity"},pinned:true},new Date().toISOString()));
        vault.memoryEntries.push(createMemory({storyId:story.id,chatId:chat.id,kind:"canon",text:"When actual anonymous-app messages appear in story prose, format each sender line as NOBUNNYONMYMENU: message or LILBUNNYBBY: message so the Vesper UI renders it as a text bubble.",data:{key:"app-message-format"},pinned:true},new Date().toISOString()));
        changed=true;
      }
    }
  }
  return changed;
}
function ensurePreferenceLines(){
  if((vault.preferenceLines||[]).length)return false;
  vault.preferenceLines=seedDefaultGreenLines();
  return true;
}
function cncPreferenceLine(){return (vault.preferenceLines||[]).find(line=>(line.tags||[]).includes("cnc"))||null;}
function sexualBoundaryIssues(result){return (result?.validation?.issues||[]).filter(issue=>issue.type==="sexual-red-line");}
function canReviewBlockedReply(result){return Boolean(result?.blocked&&String(result?.blockedText||result?.text||"").trim()&&sexualBoundaryIssues(result).length);}
function closeBlockedReplyReview(){pendingBlockedReview=null;const panel=$("blockedReplyPanel");if(panel)panel.hidden=true;}
function offerBlockedReplyReview({result,onAccept,onReject}){
  if(!canReviewBlockedReply(result))return false;
  const issues=sexualBoundaryIssues(result);
  const terms=[...new Set(issues.map(issue=>issue.term||issue.message||"sexual red line"))];
  pendingBlockedReview={result,onAccept,onReject};
  $("blockedReplyReason").textContent="Vesper flagged: "+terms.join(" · ");
  $("blockedReplyPreview").textContent=String(result.blockedText||result.text||"").trim();
  $("blockedReplyPanel").hidden=false;
  return true;
}
async function acceptBlockedReply(){
  const review=pendingBlockedReview;if(!review)return;
  pendingBlockedReview=null;$("blockedReplyPanel").hidden=true;
  try{await review.onAccept();}catch(error){showStatus(`Could not accept blocked reply: ${error.message}`,"error");}
}
async function rejectBlockedReply(){
  const review=pendingBlockedReview;if(!review)return;
  pendingBlockedReview=null;$("blockedReplyPanel").hidden=true;
  try{await review.onReject();}catch(error){showStatus(`Could not regenerate blocked reply: ${error.message}`,"error");}
}

function vaultHasUserData(v){
  return Boolean((v?.stories||[]).length||(v?.chats||[]).length||(v?.messages||[]).length||(v?.usageEntries||[]).length||(v?.personas||[]).length||(v?.characters||[]).length);
}
async function boot() {
  db = await openVesperDb(); vault = await loadVault(db);milestoneBaseline=new Map(vault.messages.map(m=>[m.id,m.text]));
  const hadUserData=vaultHasUserData(vault);
  const changed=ensurePreferenceLines()||applyVenomousAssistantRole();
  if(changed&&hadUserData)await saveAppVault(db,vault);
  const milestoneNotifications=mountMilestoneNotifications(document,{getContext:()=>({storyId:activeStoryId,chatId:activeChatId}),getVault:()=>vault});
  milestoneNotifications.baseline(vault);
  subscribeVaultSaves(event=>{
    if(event.dbName!==db.name)return;
    if(event.kind==="replace" || importingBackup){milestoneBaseline=new Map(event.vault.messages.map(m=>[m.id,m.text]));milestoneNotifications.baseline(event.vault);}
    else milestoneNotifications.observe(event.vault);
  });
  storyPhone=createStoryPhone({getSnapshot:()=>({vault,revision:vault.storageRevision,storyId:activeStoryId,chatId:activeChatId,storyVisible:!$("chatView").hidden}),commitCandidate:commitPhoneCandidate,sendPhoneMessage,cancelStoryScroll:()=>storyScroller?.cancel(),isBusy:()=>sending||phoneBusy,onError:message=>showStatus("Phone: "+message,"error")});
  personasUi=mountPersonas({host:$("dataList"),getSnapshot:()=>({vault,storyId:activeStoryId}),commit:async candidate=>{await saveAppVault(db,candidate,{expectedRevision:vault.storageRevision});vault=candidate;},isBusy:()=>sending||phoneBusy||importingBackup,onError:message=>showStatus(message,"error")});
  bindUi();
  mountChatMenu({getContext:()=>{const story=vault.stories.find(s=>s.id===activeStoryId);return {storyId:story?.id,preferences:directorPreferences(story),characters:vault.characters.filter(c=>[story?.primaryCharacterId,...(story?.characterIds||[])].includes(c.id))};},onPreferences:async(storyId,preferences)=>{if(sending||phoneBusy||importingBackup)throw new Error("Wait until the current operation finishes.");const candidate=updateDirectorPreferences(vault,storyId,preferences);await saveAppVault(db,candidate,{expectedRevision:vault.storageRevision});vault=candidate;},onTrigger:runDirectorCommand,onError:message=>showStatus(message,"error"),cancelScroll:()=>storyScroller?.cancel()});
  bindComposerViewport({});render();
  if(!hadUserData)showStatus("Vesper loaded an empty local vault. No automatic write was made.","error");
}
function bindUi() {
  $("managePersonasButton").onclick=()=>{$("settingsPanel").hidden=true;showDataView("personas");personasUi.open();};
  $("personasButton").onclick=()=>{showDataView("personas");personasUi.open();};
  const on=(id,event,handler)=>{const el=$(id);if(el)el.addEventListener(event,handler);};
  on("importButton","click",()=>{const input=$("importFile");input.value="";input.click();}); on("importFile","change",handleImportFile); on("relationshipPill","click",showRelationshipStatus); on("libraryNavButton","click",showLibrary); on("storyNavButton","click",showActiveStory); on("memoryNavButton","click",()=>showDataView("memory")); on("milestonesNavButton","click",()=>showDataView("milestones")); on("dataBackButton","click",showActiveStory);
  $("newStoryButton").onclick=openStorySetup;
  // Return belongs to the multiline draft, never to implicit form submission.
  $("composer").onsubmit=event=>event.preventDefault();
  $("sendButton").onclick=event=>{if(event.isTrusted)void sendTurn(event);};
  $("continueButton").onclick=()=>runStoryTool("continue");
  $("elaborateButton").onclick=()=>runStoryTool("elaborate");
  on("myTurnButton","click",generateMyTurnDraft);
  on("oocButton","click",()=>insertCommand("/ooc ")); on("regenLatestButton","click",regenerateLatestReply); on("stopButton","click",stopGeneration); on("scrollBottomButton","click",()=>jumpMessagesToLatest(true)); document.querySelectorAll("#commandChips [data-command]").forEach(button=>button.addEventListener("click",()=>insertCommand(button.dataset.command||"")));
  $("storySetupClose").onclick=closeStorySetup; $("createStoryFromSetup").onclick=createStarterStory; on("setupTemplate","change",applyStoryTemplate);
  $("settingsButton")?.addEventListener("click",openSettings); $("settingsClose")?.addEventListener("click",()=>{$("settingsPanel").hidden=true;});
  $("modelSelector")?.addEventListener("change",()=>{const selected=$("modelSelector").value;if(selected)$("modelName").value=selected;$("customModelRow").hidden=Boolean(selected);$("modelSelectionError").hidden=true;});
  $("saveSettings").onclick=saveSettings; on("backupButton","click",downloadBackup); on("replaceKeyButton","click",beginKeyReplacement); on("testConnectionButton","click",testModelConnection); on("rpQualityTestButton","click",testRpQuality); on("retryButton","click",retryFailedTurn); $("storyPicker").onchange=changeStory; $("deleteStoryClose").onclick=closeDeleteStory; $("deleteStoryCancel").onclick=closeDeleteStory; $("deleteStoryConfirm").onclick=confirmDeleteStory; on("blockedReplyClose","click",closeBlockedReplyReview); on("blockedReplyReject","click",rejectBlockedReply); on("blockedReplyAccept","click",acceptBlockedReply);
}

function backupFilename(){const d=new Date(),stamp=[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")+"_"+[String(d.getHours()).padStart(2,"0"),String(d.getMinutes()).padStart(2,"0")].join("-");return `Vesper_Backup_${stamp}.json`;}
let backupOperation = 0, importRevision = null, rollbackFile = null;
function transferMessage(text) { const content=$("backupTransferContent");content.replaceChildren();const p=document.createElement("p");p.textContent=text;content.append(p);return content; }
function openTransfer(title) { $("backupTransferTitle").textContent=title;$("backupTransferPanel").hidden=false;$("backupTransferClose").onclick=()=>{if(importingBackup)return;backupOperation++;preparedImport=null;rollbackFile=null;$("backupTransferPanel").hidden=true;$("backupTransferContent").replaceChildren();}; }
function transferButton(content,label,id,action) { const button=document.createElement("button");button.type="button";button.className="secondary";button.textContent=label;button.id=id;button.onclick=action;content.append(button);return button; }
function fileActions(content,file,done=()=>{}) {
  if(isIOSBackupEnvironment()){const p=document.createElement("p");p.textContent="On iPhone/iPad, use Download JSON, then save the named .json backup in Files. Share / Save to Files is disabled because iOS may save an empty or incorrectly named file.";content.append(p);}
  if(canShareBackup(file)) transferButton(content,"Share / Save to Files","shareBackup",async()=>{try{if(await shareBackup(file))done();}catch(error){const p=document.createElement("p");p.textContent=`Share failed: ${error?.message||"The operation was interrupted."}. Use Download JSON.`;content.append(p);}});
  transferButton(content,"Download JSON","downloadBackupFile",()=>{downloadBackupFile(file);done();});
}
async function downloadBackup(){
  openTransfer("Export Backup");const token=++backupOperation;transferMessage("Preparing and checking backup…");
  try{await new Promise(resolve=>setTimeout(resolve,0));const snapshot=await loadVault(db),file=createBackupFile(snapshot,backupFilename());if(token!==backupOperation)return;
    const content=transferMessage("Backup ready. Download JSON saves a named backup file using the browser’s download workflow. On supported non-iOS browsers, Share / Save to Files is also available. Export does not change saved data.");fileActions(content,file);
  }catch(error){if(token===backupOperation)transferMessage(`Backup failed: ${error?.message||"The operation was interrupted."}`);}
}
async function handleImportFile(e){
  const file=e.target.files?.[0];if(!file)return;if(sending||phoneBusy||importingBackup){openTransfer("Restore Backup");transferMessage("Finish the current operation before restoring. Nothing was changed.");return;}const token=++backupOperation;preparedImport=null;rollbackFile=null;openTransfer("Restore Backup");
  try{
    const baseline=await loadVault(db);importRevision=baseline.storageRevision;
    const prepared=await readBackupFile(file,text=>{if(token===backupOperation)transferMessage(text);});if(token!==backupOperation)return;
    preparedImport=prepared;if(prepared.preview?.detected?.type==="story-package")$("backupTransferTitle").textContent="Add Story Package";rollbackFile=createBackupFile(baseline,`Vesper_Before_Restore_${Date.now()}.json`);
    const counts=prepared.vault,content=transferMessage(`Validated: ${counts.stories.length} stories, ${counts.chats.length} chats, ${counts.messages.length} messages. ${prepared.importMode==="replace"?`REPLACE: all current vault records (${baseline.stories.length} stories, ${baseline.messages.length} messages) will be replaced by this backup; records absent from it will be removed.`:"MERGE: incoming records will be added; existing records are retained. Conflicting or repeated imports are rejected."} Your device API key is unchanged. Nothing has been imported.`);
    const details=document.createElement("p");
    details.textContent=["personas","characters","memoryEntries","milestones","relationships","sceneStates","knowledgeEntries","loreEntries","preferenceLines","usageEntries"].map(key=>`${key}: ${counts[key]?.length||0}`).join(" · ");
    const phoneThreads=counts.stories.flatMap(story=>story.phone?.threads||[]);
    details.textContent+=` · phone threads: ${phoneThreads.length} · phone messages: ${phoneThreads.reduce((n,thread)=>n+(thread.messages?.length||0),0)}. Story settings and phone history are included.`;
    content.append(details);
    fileActions(content,rollbackFile);
    const label=document.createElement("label"),check=document.createElement("input");check.type="checkbox";check.id="restoreBackupSaved";label.append(check,document.createTextNode(" I saved the rollback JSON to Files and understand the restore effects."));content.append(label);
    const button=transferButton(content,"Confirm Import","confirmImport",confirmImport);button.disabled=true;check.onchange=()=>{button.disabled=!check.checked;};
    transferButton(content,"Cancel","cancelImport",()=>{$("backupTransferClose").click();});
  }catch(error){if(token===backupOperation){preparedImport=null;transferMessage(`Import error: ${error?.message||"The operation was interrupted."} Nothing was changed.`);}}
}
async function confirmImport(){
  if(!preparedImport||!$("restoreBackupSaved")?.checked)return;const prepared=preparedImport;const revision=importRevision;let committed=false;
  importingBackup=true;$("backupTransferClose").disabled=true;transferMessage("Restoring backup atomically… Please keep this app open.");
  try{await new Promise(resolve=>setTimeout(resolve,0));await commitPreparedImport(db,prepared,{expectedRevision:revision});committed=true;preparedImport=null;vault=await loadVault(db);$("importFile").value="";render();transferMessage(prepared.preview?.detected?.type==="story-package"?"Story package added successfully. Existing stories and messages were retained. Keep your rollback backup for recovery.":"Backup restored successfully. Saved stories and messages are ready. Keep your pre-restore backup for recovery.");}
  catch(error){preparedImport=null;transferMessage(committed?`Backup was restored, but refreshing the screen failed: ${error?.message||"The operation was interrupted."} Reload the app to view the saved data.`:`Import failed: ${error?.message||"The operation was interrupted."} The restore transaction did not change your saved data. Select the file again to refresh the preview.`);}
  finally{importingBackup=false;$("backupTransferClose").disabled=false;}
}
function applyStoryTemplate(){
  const template=$("setupTemplate")?.value;
  if(template==="blackthorn"){
    $("setupStoryTitle").value="The Blackthorn Prophecy";$("setupPersonaName").value="Amanda";$("setupCharacterOne").value="Aedan Blackthorn";$("setupCharacterTwo").value="Aeron Blackthorn";
  }else if(template==="venomous-devotion"){
    $("setupStoryTitle").value="Venomous Devotion";$("setupPersonaName").value="Amanda";$("setupCharacterOne").value="Valec Thorne";$("setupCharacterTwo").value="";
  }else if(template==="kitten-test"){
    $("setupStoryTitle").value="Kitten Test";$("setupPersonaName").value="Amanda";$("setupCharacterOne").value="Mochi";$("setupCharacterTwo").value="";
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
  const kittenTest=template==="kitten-test"&&title==="Kitten Test"&&personaName==="Amanda"&&characterNames.includes("Mochi");
  const personaProfile=blackthorn?{age:24,adult:true,species:"immortal witch-wolf hybrid",history:"Severely abused and deliberately diminished by her family; kept isolated except for required appearances. Her father has forced suppressants on her for years to lock down both wolf and witch, muting supernatural healing and her side of the mate bond.",family:"Her full-blooded half-sister is the favored daughter and widely expected to become Luna.",supernaturalForm:"A spectral ghost-pale wolf with white/silver mane-like fur and red-and-silver witch-light emanating from her.",healing:"Suppression prevents normal immortal healing. As the fated bond strengthens, Amanda's own returning supernatural power progressively heals old scars.",prophecy:"Full suppression breaks only when the prophecy is fulfilled through her first intimate union with her fated mates; recognition, love, or kissing alone cannot trigger full release."}:venomous?{age:24,adult:true,species:"rabbit shifter",work:"Valec Thorne's personal assistant and executive aide inside the elite supernatural command organization. She manages his schedule, communications, files, access, and day-to-day command logistics while concealing that she is a prey-species rabbit shifter.",secret:"Her rabbit identity is hidden at work. She uses a scent product she believes repels snake shifters, but to Valec's black-mamba instincts it reads as an intensely provocative mate-attraction signal.",heat:"Her rabbit-shifter heat occurs unusually often and is an established private topic with her anonymous online partner.",onlineUsername:"LILBUNNYBBY",onlineHistory:"For months she has had an emotionally intimate and explicitly sexual relationship through an anonymous shifter app as LILBUNNYBBY with a man she knows only by the username nobunnyonmymenu. She does not know he is Valec Thorne."}:kittenTest?{age:24,adult:true,role:"caretaker of a normal domestic kitten"}:{age:24,adult:true};
  const persona={id:personaId,name:personaName,storyId,profile:personaProfile,directives:["Protect this persona's meaningful agency. Do not choose her voluntary actions, substantive dialogue, thoughts, feelings, intentions, trust, consent, relationship decisions, or consequential choices. Involuntary, unavoidable, mechanically necessary, or explicitly pre-established events involving her may be narrated when they do not imply a voluntary choice.",...(blackthorn?["Abuse history is canon but does not define the persona's entire personality or make her inherently fragile."]:[]),...(venomous?["Amanda is not timid merely because she is a prey-species shifter. Preserve her intelligence, humor, competence, sexuality, and ability to push back."]:[])],createdAt:now,updatedAt:now};
  const profiles={"Aedan Blackthorn":{age:28,adult:true,species:"werewolf",rank:"co-Alpha",personality:"Calm, strategic, observant, disciplined, patient, intelligent, difficult to manipulate. Quiet authority, dry humor, quieter when angry. Protective without infantilizing. Affection through consistency, deliberate touch, practical care, and remembered details.",flaw:"Can over-calculate.",romance:"Amanda is his first romantic and intimate partner. He wants a distinct individual relationship with her as well as the triad bond."},"Aeron Blackthorn":{age:28,adult:true,species:"werewolf",rank:"co-Alpha",personality:"Playful, perceptive, charismatic, affectionate, curious, stubborn, emotionally direct, quick-witted. Tactile and teasing, with hotter jealousy, obvious affection, and a faster temper; sharply focused when serious.",flaw:"Can act from emotional impulse.",romance:"Amanda is his first romantic and intimate partner. He wants a distinct individual relationship with her as well as the triad bond."},"Mochi":{species:"domestic kitten",age:"young kitten",role:"pet",appearance:"Tiny black kitten with oversized ears, bright curious eyes, soft paws, and a little tail that curls when excited.",personality:"Curious, affectionate, mischievous, food-motivated, easily distracted, and brave in the irrational way only kittens can be.",communication:"Mochi cannot speak human language. Vocalizations are limited to natural kitten sounds such as meow, mew, mrrp, prrt, trill, purr, hiss, and chirps. Never translate those sounds into English dialogue or give Mochi a humanlike internal monologue.",behavior:"Communicate emotion through normal feline body language: ears, tail, paws, posture, kneading, purring, blinking, rubbing, climbing, batting, loafing, hiding, zoomies, and naps. Mochi is a real cat, not a shifter or humanoid."},"Valec Thorne":{age:38,adult:true,species:"black mamba shifter",rank:"S-rank commander",appearance:"Very tall, broad, heavily muscled, thick through the chest and shoulders, powerful rather than lean. Dark hair, severe handsome features, dark green-to-near-black eyes, expensive immaculate clothing, unnerving predator stillness.",personality:"Hyper-observant, strategic, frighteningly patient, highly intelligent, dryly funny, controlled and economical in public. He rarely raises his voice because he expects to be obeyed the first time.",romance:"For months he has been emotionally and sexually involved with an anonymous woman on a shifter app under his username nobunnyonmymenu. He calls her little rabbit/bunny, knows her heat patterns and private needs, and is already deeply attached before learning she is Amanda.",jealousy:"Possessive and territorial. Harmless flirting earns cold watchfulness; deliberate boundary crossing, threats, predatory intimidation, or exploitation of Amanda's prey status can provoke targeted physical violence. He is not randomly brutal and does not become stupid when jealous.",sexualForm:"All sexual activity remains between adult humanoid forms with human/humanoid anatomy. Snake instincts may color scent, possessiveness, tracking, stillness, and predatory attention but never introduce animal mating anatomy or mechanics."}};
  const characters=characterNames.map((name,index)=>({id:makeId("character"),name,storyId,profile:(blackthorn||venomous||kittenTest)?(profiles[name]||{age:28,adult:true}):{age:28,adult:true},directives:["Maintain an individual voice, memory, knowledge state, and relationship with the persona.","Never merge identity, memories, actions, dialogue, or milestones with another character.",...(blackthorn?["Aedan and Aeron are equal co-Alphas and lifelong brothers. Neither is subordinate. Their sibling bond is never romantic or sexual.","They share one three-person fated bond with Amanda while each twin also loves and courts Amanda individually. Amanda is never merely 'the twins' mate'."]:[]),...(kittenTest?["Mochi is a real domestic kitten, not a person, shifter, familiar, or magical creature.","Mochi must NEVER use human-language dialogue. Any vocal reply must be limited to natural cat sounds such as meow, mew, mrrp, prrt, trill, purr, hiss, or chirps.","Do not translate Mochi's sounds into English and do not write humanlike internal monologue for Mochi.","Use ordinary feline actions and body language to communicate emotion."]:[]),...(venomous?["Valec should initiate, investigate, pursue, command professionally, flirt, scent, crowd, protect, and become jealous according to character without choosing Amanda's voluntary response for her.","Valec's online identity is nobunnyonmymenu. Amanda's online identity is LILBUNNYBBY. Before the reveal, he knows LILBUNNYBBY intimately but does not know with certainty that she is Amanda until the opening confirmation beat.","When writing actual anonymous-app messages, put each message on its own line beginning with the sender handle in ALL CAPS followed by a colon: NOBUNNYONMYMENU: or LILBUNNYBBY:. This lets the UI render it as a text bubble."]:[])],castOrder:index,createdAt:now,updatedAt:now}));
  vault.personas.push(persona);vault.characters.push(...characters);
  const story={id:storyId,title,characterIds:characters.map(x=>x.id),primaryCharacterId:characters[0].id,personaId,settings:{model:localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL},createdAt:now,updatedAt:now};
  if(blackthorn){story.premise="Aedan and Aeron Blackthorn are equal co-Alphas who share one fated mate: Amanda. Everyone expects their public mate announcement to name Amanda's favored full-blooded half-sister. The twins already know Amanda is their mate.";story.openingScene={location:"Major formal pack gathering for the co-Alphas' mate and future Luna announcement",facts:["Amanda is present because her family requires the appearance.","The favored half-sister deliberately trips Amanda at the start, causing her to fall.","Aedan and Aeron both directly witness the sister trip Amanda. Never rewrite this as an accident or something either twin missed.","The sister then says: Oh, you should really be more careful. And don't forget to smile. You look sad.","The family has no advance warning that Amanda will be named.","The twins already know Amanda is their mate before the announcement; do not write uncertain mate recognition.","Stop before narrating Amanda's response, reaction, dialogue, thoughts, feelings, or choices."],direction:"Aedan reacts with controlled strategic focus and recognizes evidence of the family dynamic. Aeron reacts hotter and less diplomatically without becoming foolish. The public reveal should land as a genuine shock."};story.prophecy={state:"unfulfilled",unlockTrigger:"first intimate union with her fated mates",earlyUnlockForbidden:true,effects:["forced suppression breaks","witch power fully returns","wolf fully returns","immortal healing resumes"]};}
  if(kittenTest){
    story.premise="Amanda has a normal domestic kitten named Mochi. This story exists as a non-human character fidelity test.";
    story.openingScene={location:"Amanda's living room",facts:["Mochi is a normal domestic kitten and Amanda's pet.","Mochi notices Amanda nearby and approaches in ordinary kitten fashion.","Mochi may vocalize, but only with natural cat sounds such as meow, mew, mrrp, prrt, trill, purr, hiss, or chirps.","Mochi must not speak English, use translated dialogue, or have a humanlike internal monologue.","End after Mochi gives Amanda a clear little kitten interaction to respond to."],direction:"Keep this scene simple and domestic. This is a behavior test for non-human character fidelity."};
  }
  if(venomous){
    story.premise="For months, Amanda and Valec Thorne have maintained an emotionally intimate and explicitly sexual relationship through an anonymous shifter app without knowing each other's real-world identity. Valec is the S-rank black-mamba commander whose personal assistant and executive aide is Amanda; online he is nobunnyonmymenu, while Amanda is LILBUNNYBBY. He affectionately calls his anonymous partner little rabbit/bunny. Amanda secretly is a rabbit shifter and conceals her prey identity at work. Her supposed snake-repellent scent affects Valec like an intense mate-attraction signal.";
    story.openingScene={location:"Valec Thorne's private office inside the elite supernatural command center",facts:["The story begins after months of established anonymous online emotional and sexual history between Amanda and nobunnyonmymenu.","Valec has begun privately suspecting that Amanda may be his anonymous partner, but he does not yet know for certain.","Before calling Amanda into his office from her personal-assistant workstation just outside, Valec schedules a delayed message to his anonymous partner so it will arrive while she is standing in front of him. The message should be innocuous but intimate and recognizable as part of their established private dynamic.","Amanda enters Valec's office while wearing the scent product she believes repels snake shifters. To Valec it is intensely provocative and reinforces his suspicion.","While Valec observes Amanda, the delayed message arrives and her phone audibly dings in her pocket.","The stress/startle plus unstable concealment causes Amanda's rabbit ears to pop out visibly. This is involuntary and may be narrated.","The phone ding and rabbit ears together give Valec decisive confirmation that Amanda is his anonymous little rabbit.","Valec does NOT immediately tell Amanda that he is nobunnyonmymenu. He keeps that knowledge to himself for the moment and reacts with controlled, predatory intelligence rather than blurting out the reveal.","Stop before narrating Amanda's voluntary reaction, dialogue, decision, or attempt to explain."],direction:"Play the opening with strong dramatic irony, scent tension, predator/prey contrast, and Valec's unnerving self-control. Online Valec is warm, attentive, teasing, dominant, and sexually familiar with Amanda; Commander Thorne is controlled, intimidating, observant, and economical. When confirmation lands, let the internal impact be intense while his outward reaction remains restrained. Do not rush the identity reveal beyond the configured beat."};
  }
  vault.stories.push(story);vault.chats.push({id:chatId,storyId,title:"Main Story",createdAt:now,updatedAt:now});
  if(venomous){
    const valec=characters.find(x=>x.name==="Valec Thorne");
    const pinnedCanon=[
      ["online-history","Amanda and Valec have months of established anonymous online emotional and sexual history before page one."],
      ["online-identity","Valec's anonymous shifter-app username is nobunnyonmymenu. Amanda does not know Commander Valec Thorne is nobunnyonmymenu at the start."],["amanda-online-identity","Amanda's anonymous shifter-app username is LILBUNNYBBY. Valec knows his anonymous partner by that handle before he confirms she is Amanda."],["app-message-format","When actual anonymous-app messages appear in story prose, format each sender line as NOBUNNYONMYMENU: message or LILBUNNYBBY: message so the Vesper UI renders it as a text bubble."],
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
  vault.updatedAt=now;await saveAppVault(db,vault);closeStorySetup();renderStory(storyId,chatId);
  if(blackthorn||venomous||kittenTest){
    await generateOpeningForStory(story,chatId);
  }else showStatus("Story created. Cast identities are isolated and ready for canon.","notice");
}
const VESPER_HARD_LIMITS=["Anal sex or anal penetration","Breath play","Hard choking or strangulation","Suffocation or intentional oxygen restriction","Eroticized loss of consciousness from airway or blood-flow restriction","Electrical stimulation / e-stim","Sexual content involving animals or bestiality","Extreme or torture pain","Crying as an erotic goal, kink, or escalation target","Urine","Feces / scat","Overstimulation","Canine reproductive anatomy, knotting, tie, or bulbus-glandis","Canine genital locking or literal animal mating mechanics","Werewolf/shifter sexual anatomy","Double penetration"];
function renderHardLimits(){const list=$("hardLimitsList");if(!list)return;list.replaceChildren(...VESPER_HARD_LIMITS.map(text=>{const row=document.createElement("div");row.className="hard-limit-item";row.textContent=text;return row;}));}
function renderKeyStatus(){const hasKey=Boolean(getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY));$("apiKeyStatus").textContent=hasKey?"•••••••• stored securely on this device":"No API key stored on this device";$("replaceKeyButton").textContent=hasKey?"Replace API Key":"Add API Key";}
function beginKeyReplacement(){const row=$("apiKeyReplaceRow"),input=$("apiKey");row.hidden=false;input.value="";input.focus({preventScroll:true});}
async function probeOpenRouter(prompt){const draft=$("apiKey").value.trim(),key=draft||getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY),model=$("modelName").value.trim();if(model!==settingsModelSnapshot.trim()){const validation=validateModelId(model);if(!validation.ok)throw new Error(validation.error);}if(!key)throw new Error("No OpenRouter API key is loaded.");if(!model)throw new Error("No model is selected.");const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model,messages:[{role:"user",content:prompt}],temperature:0,max_tokens:32})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data?.error?.message||`OpenRouter request failed (${response.status}).`);const usage=data?.usage||{};vault.usageEntries.push(recordUsage({storyId:activeStoryId,chatId:activeChatId,model,promptTokens:usage.prompt_tokens||0,completionTokens:usage.completion_tokens||0,cost:null}));await saveAppVault(db,vault);renderQueryMeter();return data;}
async function testModelConnection(){const out=$("connectionTestStatus");out.textContent="Testing…";try{await probeOpenRouter("Reply with exactly: VESPER CONNECTED");out.textContent="✓ Connection successful.";}catch(error){out.textContent=`Connection failed: ${error.message}`;}}
async function testRpQuality(){const out=$("connectionTestStatus");out.textContent="Running RP quality test…";try{const data=await probeOpenRouter("In one short sentence, write atmospheric gothic roleplay prose about a candlelit hall. No sexual content.");const sample=data?.choices?.[0]?.message?.content?.trim();out.textContent=sample?`RP test: ${sample}`:"RP test connected, but returned no text.";}catch(error){out.textContent=`RP test failed: ${error.message}`;}}
function openSettings(){
  const story=(vault?.stories||[]).find(s=>s.id===activeStoryId)||(vault?.stories||[])[0]||null;
  const settings=story?.settings||{};
  $("assignedPersonaName").textContent=vault.personas.find(p=>p.id===activePersonaId(story))?.name||"No protagonist assigned";
  const setValue=(id,value)=>{const el=$(id);if(el)el.value=value;};
  const setChecked=(id,value)=>{const el=$(id);if(el)el.checked=Boolean(value);};
  const setText=(id,value)=>{const el=$(id);if(el)el.textContent=String(value);};
  const setHidden=(id,value)=>{const el=$(id);if(el)el.hidden=Boolean(value);};
  setValue("apiKey","");setHidden("apiKeyReplaceRow",true);renderKeyStatus();
  setValue("modelName",story?.settings?.model||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL);
  const modelSelector=$("modelSelector");
  if(modelSelector){
    modelSelector.replaceChildren(...modelOptions().map(entry=>new Option(entry.name,entry.id)),new Option("Custom model ID",""));
    modelSelector.value=[...modelSelector.options].some(option=>option.value===$("modelName").value)?$("modelName").value:"";
    $("customModelRow").hidden=Boolean(modelSelector.value);
  }
  setHidden("modelSelectionError",true);
  setValue("temperatureSetting",settings.temperature??0.9);
  setValue("maxTokensSetting",settings.maxTokens??1200);
  setValue("intimacyPacing",settings.intimacyPacing||"balanced");
  setValue("intimacyStyle",normalizeIntimacyStyle(settings.intimacyStyle));
  setChecked("requirePlotAfterSex",settings.requirePlotAfterSex);
  const cncLine=cncPreferenceLine();
  setChecked("cncToggle",Boolean(cncLine&&settings.enabledPreferenceLineIds?.includes(cncLine.id)));
  settingsFormSnapshot=settingsFormSignature();
  settingsModelSnapshot=$("modelName")?.value||"";
  settingsModelFormSnapshot=modelIndependentSignature();
  setText("appVersionLabel",VESPER_APP_VERSION);
  setText("schemaVersionLabel",VESPER_SCHEMA_VERSION);
  setText("vaultStoryCount",(vault?.stories||[]).length);
  setText("vaultMessageCount",(vault?.messages||[]).length);
  renderHardLimits();
  setText("connectionTestStatus","");
  const panel=$("settingsPanel");if(panel)panel.hidden=false;
}
async function saveSettings(){
  const apiKeyEl=$("apiKey"),replaceRow=$("apiKeyReplaceRow"),modelEl=$("modelName");
  const enteredKey=apiKeyEl?.value?.trim()||"";
  const styleStory=(vault?.stories||[]).find(s=>s.id===activeStoryId)||(vault?.stories||[])[0]||null;
  const intimacyStyle=normalizeIntimacyStyle($("intimacyStyle")?.value);
  const modelChanged=(modelEl?.value||"").trim()!==settingsModelSnapshot.trim();
  const selectedModel=modelChanged?validateModelId(modelEl?.value):{ok:true,id:settingsModelSnapshot.trim()};
  if(!selectedModel.ok){$("modelSelectionError").textContent=selectedModel.error;$("modelSelectionError").hidden=false;return;}
  $("modelSelectionError").hidden=true;
  if(styleStory&&modelChanged&&!enteredKey&&modelIndependentSignature()===settingsModelFormSnapshot){
    const previous=styleStory.settings;
    styleStory.settings={...(previous||{}),model:selectedModel.id,...(intimacyStyle!==normalizeIntimacyStyle(previous?.intimacyStyle)?{intimacyStyle}:{})};
    try{await saveAppVault(db,vault);}catch(error){if(previous===undefined)delete styleStory.settings;else styleStory.settings=previous;$("modelSelectionError").textContent=error.message;$("modelSelectionError").hidden=false;return;}
    $("settingsPanel").hidden=true;
    return;
  }
  if(styleStory&&intimacyStyle!==normalizeIntimacyStyle(styleStory.settings?.intimacyStyle)&&!enteredKey&&settingsFormSignature()===settingsFormSnapshot){
    const previous=styleStory.settings;
    styleStory.settings={...(previous||{}),intimacyStyle};
    try{await saveAppVault(db,vault);}catch(error){if(previous===undefined)delete styleStory.settings;else styleStory.settings=previous;throw error;}
    $("settingsPanel").hidden=true;
    return;
  }
  if(replaceRow&&!replaceRow.hidden&&enteredKey) replaceOpenRouterKey(enteredKey);
  if(apiKeyEl)apiKeyEl.value="";if(replaceRow)replaceRow.hidden=true;renderKeyStatus();
  const modelValue=modelEl?.value?.trim()||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL;
  localStorage.setItem("vesper.model",modelValue);
  const story=(vault?.stories||[]).find(s=>s.id===activeStoryId);
  if(story){
    const cncLine=cncPreferenceLine(),enabledIds=new Set(story.settings?.enabledPreferenceLineIds||[]);
    if(cncLine){if($("cncToggle")?.checked)enabledIds.add(cncLine.id);else enabledIds.delete(cncLine.id);}
    story.settings={...(story.settings||{}),model:modelValue,temperature:Number($("temperatureSetting")?.value)||0.9,maxTokens:Number($("maxTokensSetting")?.value)||1200,intimacyPacing:$("intimacyPacing")?.value||"balanced",...(intimacyStyle!==normalizeIntimacyStyle(story.settings?.intimacyStyle)?{intimacyStyle}:{}),requirePlotAfterSex:Boolean($("requirePlotAfterSex")?.checked),enabledPreferenceLineIds:[...enabledIds]};
    await saveAppVault(db,vault);
  }
  $("settingsPanel").hidden=true;
}
async function runStoryTool(kind){
  if(sending)return;
  const prompts={
    continue:"[OOC: Continue directly from the exact point where the previous response stopped. If it ended mid-sentence, complete that sentence first. Do not repeat or summarize prior prose. Continue the scene naturally and stop on a complete narrative beat.]",
    elaborate:"[OOC: Elaborate the immediately preceding assistant response with richer sensory detail, character-specific behavior, dialogue, and atmosphere while preserving every established event and fact. Do not advance past its endpoint more than necessary.]"
  };
  const instruction=prompts[kind];if(!instruction)return;
  const story=vault.stories.find(s=>s.id===activeStoryId),chat=vault.chats.find(c=>c.id===activeChatId);if(!story||!chat)return;
  await generateToolReply({story,chat,instruction,label:kind==="continue"?"Continuing…":"Elaborating…"});
}
async function generateToolReply({story,chat,instruction,label,director=false}){
  if(sending||phoneBusy||importingBackup||$("assistantEditPanel"))return;
  const model=story.settings?.model||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL;
  if(!model){showStatus("Choose an OpenRouter model in Settings first.","error");return;}
  if(!getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY)){showStatus("Add your OpenRouter API key in Settings first.","error");return;}
  sending=true;setGenerationUi(true);activeGenerationController=new AbortController();showStatus(label,"working");
  try{
    const preferenceLines=vault.preferenceLines?.length?vault.preferenceLines:seedDefaultGreenLines();
    const result=await runTurn({vault,storyId:story.id,chatId:chat.id,model,preferenceLines,storySettings:story.settings||{},oocInstruction:instruction,director,temperature:story.settings?.temperature??0.9,maxTokens:story.settings?.maxTokens??1200,signal:activeGenerationController.signal});
    recordTurnUsage(result,{storyId:story.id,chatId:chat.id,model});await saveAppVault(db,vault);
    if(director&&result.issueTypes?.includes("director-meta"))throw new Error("Director returned story-ending commentary instead of continuing. No reply was added. Retry only if you choose to.");
    if(result.blocked||result.validation?.needsRepair||!result.validation?.ok||!result.text?.trim()){const ordinal=nextMessageOrdinal(chat.id);if(offerBlockedReplyReview({result,onAccept:async()=>{vault.messages.push({id:makeId("message"),storyId:story.id,chatId:chat.id,role:"assistant",text:String(result.blockedText||result.text||"").trim(),ordinal,createdAt:new Date().toISOString(),validation:result.validation,repaired:result.repaired,userApprovedBoundaryOverride:true,boundaryOverrideIssues:sexualBoundaryIssues(result)});await saveAppVault(db,vault);renderStory(story.id,chat.id,"message");showStatus("Blocked reply accepted by you.","notice");},onReject:async()=>generateToolReply({story,chat,instruction,label,director})})){showStatus("Reply held for your boundary review.","notice");return;}throw new Error("Vesper couldn\'t produce a usable reply.");}
    const ordinal=nextMessageOrdinal(chat.id);
    vault.messages.push({id:makeId("message"),storyId:story.id,chatId:chat.id,role:"assistant",text:result.text,ordinal,createdAt:new Date().toISOString(),validation:result.validation,repaired:result.repaired});
    await saveAppVault(db,vault);renderStory(story.id,chat.id,"message");showStatus("","clear");
  }catch(error){showStatus(error?.name==="AbortError"?"Generation stopped.":`Generation failed: ${error.message}`,"error");}
  finally{sending=false;activeGenerationController=null;setGenerationUi(false);}
}
async function runDirectorCommand(command,expectedStoryId=activeStoryId,onReady=()=>{}){
  if(sending||phoneBusy||importingBackup||$("assistantEditPanel"))throw new Error("Wait until the current operation finishes.");
  if(expectedStoryId!==activeStoryId)throw new Error("The active story changed. Reopen the menu before triggering Director.");
  const action=parseDirectorCommand(command);if(!action)return false;
  const story=vault.stories.find(s=>s.id===activeStoryId),chat=vault.chats.find(c=>c.id===activeChatId&&c.storyId===activeStoryId);if(!story||!chat)throw new Error("Select a story and conversation first.");
  const runnable=storyIsRunnable(vault,story.id);if(!runnable.ok)throw new Error(runnable.reason);
  if(!getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY))throw new Error("Add your OpenRouter API key in Settings first.");
  assertDirectorStoryOpen(story);
  onReady();await generateToolReply({story,chat,instruction:directorInstruction(action,directorPreferences(story)),label:"Directing the scene…",director:true});return true;
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
    const instruction=`[OOC TOOL — MY TURN: Draft ${vault.personas.find(p=>p.id===activePersonaId(story))?.name||"the protagonist"}'s next possible roleplay turn for the user to review and edit. Write ONLY ${vault.personas.find(p=>p.id===activePersonaId(story))?.name||"the protagonist"}'s proposed turn, in her established voice and consistent with current canon and scene context. Do not write any other character's dialogue, actions, thoughts, or reactions. Do not advance the scene beyond ${vault.personas.find(p=>p.id===activePersonaId(story))?.name||"the protagonist"}'s proposed response. This is a draft only and must not be treated as sent canon until the user submits it.]`;
    const result=await runTurn({vault,storyId:story.id,chatId:chat.id,model,preferenceLines,storySettings:story.settings||{},oocInstruction:instruction,personaDraft:true,temperature:story.settings?.temperature??0.9,maxTokens:story.settings?.maxTokens??1200,signal:activeGenerationController.signal});
    recordTurnUsage(result,{storyId:story.id,chatId:chat.id,model});await saveAppVault(db,vault);
    if(result.blocked||!result.validation?.ok||!result.text?.trim())throw new Error("Vesper couldn't produce a usable draft.");
    if(activeStoryId!==story.id||activeChatId!==chat.id||input.value!==prior){showStatus("Draft request finished. Your current draft was preserved.","notice");return;}
    input.value=result.text.trim();
    input.focus({preventScroll:true});
    input.setSelectionRange(input.value.length,input.value.length);
    showStatus("Draft ready. Edit anything you want, then Send when it feels like you.","notice");
  }catch(error){
    showStatus(error?.name==="AbortError"?"Drafting stopped.":`Draft failed: ${error.message}`,"error");
  }finally{
    sending=false;activeGenerationController=null;setGenerationUi(false);
  }
}
function nextMessageOrdinal(chatId){const values=vault.messages.filter(m=>m.chatId===chatId).map(m=>Number(m.ordinal)).filter(Number.isFinite);return (values.length?Math.max(...values):-1)+1;}
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
async function generateOpeningForStory(story,chatId){
  if(sending||!story?.openingScene)return;
  const model=story.settings?.model||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL;
  const key=getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY);
  if(!model||!key){
    retryOpeningStoryId=story.id;
    showRetry(true,"Generate Opening");
    showStatus(story.title+" is ready. Add your OpenRouter key/model if needed, then tap Generate Opening.","notice");
    return;
  }
  const already=vault.messages.some(m=>m.storyId===story.id&&m.chatId===chatId);
  if(already){retryOpeningStoryId=null;showRetry(false);return;}
  sending=true;setGenerationUi(true);showRetry(false);activeGenerationController=new AbortController();showStatus("Vesper is opening the story…","working");
  try{
    const preferenceLines=vault.preferenceLines?.length?vault.preferenceLines:seedDefaultGreenLines();
    const result=await runTurn({vault,storyId:story.id,chatId,model,preferenceLines,storySettings:story.settings||{},opening:true,maxTokens:3000,repairAttempts:4,signal:activeGenerationController.signal});
    recordTurnUsage(result,{storyId:story.id,chatId,model});await saveAppVault(db,vault);
    if(result.blocked||result.validation?.needsRepair||!result.validation?.ok||!result.text?.trim()){
      const why=(result.issueTypes||result.validation?.issues?.map(x=>x.type)||[]).join(", ");
      if(offerBlockedReplyReview({result,onAccept:async()=>{vault.messages.push({id:makeId("message"),storyId:story.id,chatId,role:"assistant",text:String(result.blockedText||result.text||"").trim(),ordinal:0,createdAt:new Date().toISOString(),validation:result.validation,repaired:result.repaired,userApprovedBoundaryOverride:true,boundaryOverrideIssues:sexualBoundaryIssues(result)});retryOpeningStoryId=null;await saveAppVault(db,vault);renderStory(story.id,chatId,"message");showStatus("Blocked opener accepted by you.","notice");},onReject:async()=>generateOpeningForStory(story,chatId)})){retryOpeningStoryId=story.id;showStatus("Opening held for your boundary review.","notice");return;}
      throw new Error(why?`Vesper rejected the opener: ${why}.`:"Vesper returned no usable opener.");
    }
    vault.messages.push({id:makeId("message"),storyId:story.id,chatId,role:"assistant",text:result.text,ordinal:0,createdAt:new Date().toISOString(),validation:result.validation,repaired:result.repaired});
    retryOpeningStoryId=null;
    await saveAppVault(db,vault);
    renderStory(story.id,chatId,"message");
    showStatus(result.repaired?"Opening repaired before display.":"","notice");
  }catch(error){
    retryOpeningStoryId=story.id;
    showRetry(true,"Generate Opening");
    showStatus(`Opening generation failed: ${error.message}`,"error");
  }finally{
    sending=false;activeGenerationController=null;setGenerationUi(false);
  }
}

async function regenerateLatestReply(){if(sending)return;const latest=[...vault.messages].filter(m=>m.chatId===activeChatId&&m.role==="assistant").sort((a,b)=>(b.ordinal??0)-(a.ordinal??0))[0];if(!latest){showStatus("There is no Vesper reply to regenerate yet.","notice");return;}await regenerateAssistantMessage(latest);}
async function retryFailedTurn(){
  if(sending)return;
  if(retryOpeningStoryId){
    const story=vault.stories.find(s=>s.id===retryOpeningStoryId);
    const chat=vault.chats.find(c=>c.storyId===retryOpeningStoryId);
    if(!story||!chat){retryOpeningStoryId=null;showRetry(false);return;}
    await generateOpeningForStory(story,chat.id);
    return;
  }
  if(!retryMessageId)return;
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
    recordTurnUsage(result,{storyId:story.id,chatId:chat.id,model});await saveAppVault(db,vault);
    if(result.blocked||!result.validation?.ok||!result.text?.trim()){const why=(result.issueTypes||result.validation?.issues?.map(x=>x.type)||[]).join(", ");const ordinal=nextMessageOrdinal(chat.id);if(offerBlockedReplyReview({result,onAccept:async()=>{vault.messages.push({id:makeId("message"),storyId:story.id,chatId:chat.id,role:"assistant",text:String(result.blockedText||result.text||"").trim(),ordinal,createdAt:new Date().toISOString(),validation:result.validation,repaired:result.repaired,userApprovedBoundaryOverride:true,boundaryOverrideIssues:sexualBoundaryIssues(result)});retryMessageId=null;await saveAppVault(db,vault);renderStory(story.id,chat.id,"message");showStatus("Blocked reply accepted by you.","notice");},onReject:async()=>{retryMessageId=message.id;await generateReplyForMessage({message,story,chat});}})){retryMessageId=message.id;showStatus("Reply held for your boundary review.","notice");return;}throw new Error(why?`Vesper rejected the reply: ${why}.`:"Vesper couldn\'t produce a valid reply.");}
    const ordinal=nextMessageOrdinal(chat.id);
    vault.messages.push({id:makeId("message"),storyId:story.id,chatId:chat.id,role:"assistant",text:result.text,ordinal,createdAt:new Date().toISOString(),validation:result.validation,repaired:result.repaired});
    retryMessageId=null;await saveAppVault(db,vault);sending=false;activeGenerationController=null;setGenerationUi(false);showStatus(result.repaired?"Reply repaired before display.":"",result.repaired?"notice":"clear");renderStory(story.id,chat.id,"message");const composer=$("messageInput");composer.hidden=false;if(!isMobileStoryLayout())composer.focus({preventScroll:true});
  }catch(error){retryMessageId=message.id;showStatus(`Generation failed: ${error.message}`,"error");showRetry(true);}
  finally{sending=false;activeGenerationController=null;$("sendButton").disabled=false;$("sendButton").hidden=false;$("stopButton").hidden=true;$("writingState").hidden=true;}
}
async function sendTurn(event){
  event.preventDefault(); if(sending||phoneBusy||importingBackup||$("assistantEditPanel"))return;
  const composerDraft=$("messageInput").value;
  const text=composerDraft.trim(),story=vault.stories.find(s=>s.id===activeStoryId),chat=vault.chats.find(c=>c.id===activeChatId);
  if(!text||!story||!chat)return;
  try{const action=parseDirectorCommand(text);if(action){await runDirectorCommand(text,story.id,()=>{if($("messageInput").value===composerDraft)$("messageInput").value="";});return;}}
  catch(error){showStatus(error.message,"error");return;}
  const commandMatch=text.match(/^\/(ooc|continue|elaborate)\b\s*([\s\S]*)$/i);
  if(commandMatch){
    $("messageInput").value="";
    const name=commandMatch[1].toLowerCase(),args=commandMatch[2].trim();
    if(name==="continue"||name==="elaborate"){await runStoryTool(name);return;}
    if(name==="ooc"){
      if(!args){showStatus("Add an instruction after /ooc.","notice");return;}
      await generateToolReply({story,chat,instruction:`[OOC: ${args}]`,label:"Applying OOC instruction…"});return;
    }
  }
  const runnable=storyIsRunnable(vault,story.id);if(!runnable.ok){showStatus(runnable.reason,"error");return;}
  const model=story.settings?.model||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL;
  if(!model){showStatus("Choose an OpenRouter model in Settings first.","error");return;}
  if(!getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY)){showStatus("Add your OpenRouter API key in Settings first.","error");return;}
  const now=new Date().toISOString(),ordinal=nextMessageOrdinal(chat.id);
  const userMessage={id:makeId("message"),storyId:story.id,chatId:chat.id,role:"user",personaId:activePersonaId(story),text,ordinal,createdAt:now};
  // Lock synchronously before the first await. Save a candidate so an abort or
  // stale conflict cannot leave an unsaved message in the in-memory vault.
  const candidate=structuredClone(vault);candidate.messages.push(userMessage);
  sending=true;setGenerationUi(true);
  try{
    await saveAppVault(db,candidate,{expectedRevision:vault.storageRevision});vault=candidate;
    if($("messageInput").value===composerDraft)$("messageInput").value="";
    if(isMobileStoryLayout())$("messageInput").blur();renderStory(story.id,chat.id,"message");if(!isMobileStoryLayout())$("messageInput").focus({preventScroll:true});
    retryMessageId=userMessage.id;
    await generateReplyForMessage({message:userMessage,story,chat});
  }catch(error){showStatus(`Could not save your message: ${error.message}. Your draft was not submitted.`,"error");}
  finally{sending=false;setGenerationUi(false);}
}
function changeStory(e){const storyId=e.target.value,chat=chooseInitialChat(vault,storyId);renderStory(storyId,chat?.id);}
function renderStoryPicker(){const picker=$("storyPicker"),choices=listStoryChoices(vault);picker.innerHTML="";for(const choice of choices){const option=document.createElement("option");option.value=choice.storyId;option.textContent=`${choice.title} — ${choice.characterName} / ${choice.personaName}`;picker.appendChild(option);}if(activeStoryId)picker.value=activeStoryId;picker.hidden=choices.length<2;}
function showRelationshipStatus(){const storyId=activeStoryId;if(!storyId){showStatus("Open a story first.","notice");return;}const rows=(vault.relationships||[]).filter(r=>r.storyId===storyId);if(!rows.length){showStatus("No structured relationship state has been recorded for this story yet.","notice");return;}const summary=rows.map(r=>[r.stage,...(r.labels||[])].filter(Boolean).join(" · ")).join(" | ");showStatus(summary||"Relationship state is recorded.","notice");}
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
  vault.personas=vault.personas.filter(x=>!(x.storyId===storyId||storyPersonaIds(story).includes(x.id))||vault.stories.some(s=>s.id!==storyId&&storyPersonaIds(s).includes(x.id)));
  const charIds=new Set([story.primaryCharacterId,...(story.characterIds||[])].filter(Boolean));
  vault.characters=vault.characters.filter(x=>x.storyId!==storyId&&!charIds.has(x.id));
  vault.stories=vault.stories.filter(x=>x.id!==storyId);reconcilePhoneRecords();vault.updatedAt=new Date().toISOString();
  if(activeStoryId===storyId){activeStoryId=null;activeChatId=null;}
  await saveAppVault(db,vault);closeDeleteStory();showLibrary();
}
function showLibrary(){
  storyPhone?.close();
  storyScroller?.cancel();document.querySelector(".app-shell").classList.remove("story-open");
  rememberTab("library");renderQueryMeter();
  $("dataView").hidden=true;$("chatView").hidden=true;$("emptyState").hidden=false;storyPhone?.refresh();
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
  storyPhone?.close();
  storyScroller?.cancel();document.querySelector(".app-shell").classList.remove("story-open");
  rememberTab(kind);
  $("emptyState").hidden=true;$("chatView").hidden=true;$("dataView").hidden=false;storyPhone?.refresh();
  const isMemory=kind==="memory",storyId=activeStoryId;
  $("dataEyebrow").textContent=storyId?(vault.stories.find(s=>s.id===storyId)?.title||"ACTIVE STORY"):"VESPER";
  $("dataTitle").textContent=isMemory?"Memory":"Milestones";
  const rows=(isMemory?vault.memoryEntries:vault.milestones).filter(x=>!storyId||!x.storyId||x.storyId===storyId);
  const list=$("dataList");list.replaceChildren();
  if(!isMemory&&storyId)mountHistoricalMilestones(list,{getSnapshot:()=>({vault,storyId}),isBusy:()=>sending||phoneBusy||importingBackup,commit:async(next,expectedRevision)=>{await saveAppVault(db,next,{expectedRevision});vault=next;},onDone:count=>{showDataView("milestones");const notice=document.createElement("p");notice.setAttribute("role","status");notice.textContent=`${count} historical milestones recorded. Story messages were preserved.`;$("dataList").prepend(notice);},onError:message=>showStatus(message,"error")});
  if(!rows.length){const empty=document.createElement("div");empty.className="data-empty";empty.textContent=isMemory?"No memory entries for this story yet.":"No milestones for this story yet.";list.append(empty);}
  for(const row of rows){const card=document.createElement("article");card.className="data-card";const title=document.createElement("strong"),body=document.createElement("div");title.textContent=isMemory?(row.kind||"Memory"):(row.title||row.name||row.kind||"Milestone");body.textContent=row.text||row.evidence||row.description||row.label||JSON.stringify(row.data||row.value||"");if(!isMemory){const names=(row.participants||row.participantIds||[]).map(id=>vault.characters.find(c=>c.id===id)?.name).filter(Boolean);title.textContent+=(names.length?" · "+names.join(" · "):"")+(row.status==="candidate"?" — Needs confirmation":"");}card.append(title,body);if(!isMemory&&row.status!=="candidate"&&!validateCanonicalMilestone(row,vault).ok){const warning=document.createElement("p");warning.textContent="Historical record — currently not canonical. Evidence may have changed or needs verification.";card.append(warning);}if(!isMemory&&row.status==="candidate"){const confirmButton=document.createElement("button");confirmButton.type="button";confirmButton.className="ghost";confirmButton.textContent="Confirm completed milestone";confirmButton.onclick=async()=>{try{if(sending||phoneBusy)throw new Error("Wait until the current operation finishes.");const candidate=confirmMilestoneEvent(vault,row.id);await saveAppVault(db,candidate,{expectedRevision:vault.storageRevision});vault=candidate;showDataView("milestones");}catch(e){showStatus(e.message,"error");}};card.append(confirmButton);const reject=document.createElement("button");reject.type="button";reject.className="ghost";reject.textContent="Not earned";reject.onclick=async()=>{try{if(sending||phoneBusy)return;const candidate=structuredClone(vault);candidate.milestones.find(m=>m.id===row.id).status="rejected";await saveAppVault(db,candidate,{expectedRevision:vault.storageRevision});vault=candidate;showDataView("milestones");}catch(e){showStatus(e.message,"error");}};card.append(reject);}list.append(card);}
  ["libraryNavButton","storyNavButton","memoryNavButton","milestonesNavButton"].forEach(id=>$(id).classList.remove("active"));
  $(isMemory?"memoryNavButton":"milestonesNavButton").classList.add("active");
}
function showActiveStory(){rememberTab("story");if(activeStoryId){renderStory(activeStoryId,activeChatId);return;}const s=vault.stories[0];if(s){const c=chooseInitialChat(vault,s.id);renderStory(s.id,c?.id);}else showLibrary();}
function render(){
  const tab=lastTab();
  if(tab==="library"){showLibrary();return;}
  if(!vault.stories.length){showLibrary();return;}
  const preferredId=lastStoryId();
  const s=vault.stories.find(x=>x.id===preferredId)||vault.stories[0];
  const c=chooseInitialChat(vault,s.id);
  activeStoryId=s.id;activeChatId=c?.id||null;
  if(tab==="memory"){showDataView("memory");return;}
  if(tab==="milestones"){showDataView("milestones");return;}
  renderStory(s.id,c?.id);
}
function isOpeningMessage(message){
  const firstAssistant=vault.messages.filter(m=>m.chatId===message.chatId&&m.role==="assistant").sort((a,b)=>(a.ordinal??0)-(b.ordinal??0))[0];
  return firstAssistant?.id===message.id;
}
function editAssistantMessage(message,targetNode){
  if($("assistantEditPanel"))return;
  if(sending||phoneBusy){showStatus("Wait for the current request to finish before editing.","notice");return;}
  storyScroller?.cancel();
  const baseline=structuredClone(vault),revision=vault.storageRevision;
  const panel=document.createElement("section");panel.className="modal-backdrop";panel.id="assistantEditPanel";
  const card=document.createElement("div");card.className="settings-card";card.setAttribute("role","dialog");card.setAttribute("aria-modal","true");card.setAttribute("aria-labelledby","assistantEditTitle");
  const title=document.createElement("h2");title.id="assistantEditTitle";title.textContent="Edit Vesper’s reply";
  const label=document.createElement("label");label.textContent="Reply text";const field=document.createElement("textarea");field.id="assistantEditText";field.value=String(message.text||"");label.append(field);
  const note=document.createElement("p");note.textContent="Your saved correction takes precedence in this conversation. Stale source-linked context will be withheld, not rewritten.";
  const original=document.createElement("button");original.id="assistantEditOriginal";original.type="button";original.className="secondary";original.textContent="Load original version";original.hidden=originalAssistantText(message)===null;original.onclick=()=>{field.value=originalAssistantText(message);field.focus({preventScroll:true});};
  const error=document.createElement("p");error.id="assistantEditError";error.setAttribute("role","alert");
  const save=document.createElement("button");save.id="assistantEditSave";save.type="button";save.className="primary";save.textContent="Save changes";
  const cancel=document.createElement("button");cancel.id="assistantEditCancel";cancel.type="button";cancel.className="secondary";cancel.textContent="Cancel";
  const viewport=window.visualViewport;
  const resize=()=>{if(!viewport)return;panel.style.top=`${viewport.offsetTop}px`;panel.style.bottom="auto";panel.style.height=`${viewport.height}px`;card.style.maxHeight=`${Math.max(120,viewport.height-36)}px`;field.style.height=`${Math.max(120,viewport.height*.4)}px`;};
  const dispose=()=>{viewport?.removeEventListener("resize",resize);viewport?.removeEventListener("scroll",resize);panel.remove();};
  viewport?.addEventListener("resize",resize);viewport?.addEventListener("scroll",resize);resize();
  let saving=false,committed=false;const close=()=>{if(saving)return;dispose();};cancel.onclick=close;
  panel.onkeydown=e=>{if(e.key==="Escape"){e.preventDefault();close();}if(e.key==="Tab"){const elements=[field,...(original.hidden?[]:[original]),save,cancel],first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
  save.onclick=async()=>{if(saving)return;if(sending||phoneBusy){error.textContent="Wait for the current request to finish.";return;}try{
    const next=prepareAssistantEdit(baseline,{messageId:message.id,storyId:message.storyId,chatId:message.chatId,text:field.value});if(!next){close();return;}
    saving=true;save.disabled=true;cancel.disabled=true;original.disabled=true;
    await saveAppVault(db,next,{expectedRevision:revision});committed=true;vault=next;dispose();if(targetNode?.isConnected)renderMessage(targetNode,next.messages.find(m=>m.id===message.id));showStatus("Correction saved as authoritative for this conversation. Stale derived context is withheld; stored memories and milestones were not rewritten.","notice");
  }catch(e){if(committed)showStatus("The edit was saved, but refreshing the view failed. Reload Vesper to see it.","error");else error.textContent=e?.message||"Could not save this edit. Saved data was not changed.";}finally{saving=false;save.disabled=false;cancel.disabled=false;original.disabled=false;}};
  card.append(title,note,label,original,error,save,cancel);panel.append(card);document.body.append(panel);field.focus({preventScroll:true});
}
async function editUserMessage(message){
  if(sending){showStatus("Wait for Vesper to finish writing before editing.","notice");return;}
  const next=window.prompt("Edit your post",String(message.text||""));
  if(next===null)return;
  const text=next.trim();if(!text||text===String(message.text||"").trim())return;
  message.text=text;message.editedAt=new Date().toISOString();vault.updatedAt=message.editedAt;
  await saveAppVault(db,vault);renderStory(message.storyId,message.chatId);showStatus("Post edited. Vesper will use the corrected version from now on.","notice");
}
async function deleteMessageBranch(message){
  if(sending){showStatus("Wait for Vesper to finish writing before deleting a post.","notice");return;}
  const targetOrdinal=Number(message.ordinal);
  const doomed=vault.messages.filter(m=>m.chatId===message.chatId&&(Number.isFinite(targetOrdinal)?Number(m.ordinal)>=targetOrdinal:m.id===message.id));
  if(!doomed.length)return;
  const laterCount=Math.max(0,doomed.length-1);
  const prompt=laterCount
    ? `Delete this post and the ${laterCount} later post${laterCount===1?"":"s"} that depend on it?`
    : "Delete this post from the story?";
  if(!window.confirm(prompt))return;
  const doomedIds=new Set(doomed.map(m=>m.id));
  vault.messages=vault.messages.filter(m=>!doomedIds.has(m.id));
  vault.memoryEntries=(vault.memoryEntries||[]).filter(entry=>!(entry.sourceMessageIds||[]).some(id=>doomedIds.has(id)));
  vault.milestones=(vault.milestones||[]).filter(entry=>!entry.sourceMessageId||!doomedIds.has(entry.sourceMessageId));
  vault.knowledgeEntries=(vault.knowledgeEntries||[]).filter(entry=>!entry.sourceMessageId||!doomedIds.has(entry.sourceMessageId));
  vault.statEvents=(vault.statEvents||[]).filter(entry=>!entry.sourceMessageId||!doomedIds.has(entry.sourceMessageId));
  reconcilePhoneRecords();
  retryMessageId=null;retryOpeningStoryId=null;vault.updatedAt=new Date().toISOString();
  await saveAppVault(db,vault);
  renderStory(message.storyId,message.chatId);
  showStatus("Post removed. Vesper no longer sees that deleted branch in chat context.","notice");
}

async function regenerateAssistantMessage(message){
  if(sending)return;
  const story=vault.stories.find(s=>s.id===message.storyId),chat=vault.chats.find(c=>c.id===message.chatId);if(!story||!chat)return;
  const later=vault.messages.filter(m=>m.chatId===message.chatId&&(Number(m.ordinal)||0)>(Number(message.ordinal)||0));
  if(later.length&&!window.confirm("Regenerate this reply and remove the later messages in this chat only if the replacement succeeds?"))return;
  const model=story.settings?.model||localStorage.getItem("vesper.model")||DEFAULT_OPENROUTER_MODEL;
  if(!model){showStatus("Choose an OpenRouter model in Settings first.","error");return;}
  if(!getDeviceSecret(DEVICE_SECRET_NAMES.OPENROUTER_API_KEY)){showStatus("Add your OpenRouter API key in Settings first.","error");return;}
  let plan;
  try{plan=prepareVaultRegeneration(vault,message.id);}catch(error){showStatus(`Regeneration could not start: ${error.message}`,"error");return;}
  const targetOrdinal=plan.ordinal,tempVault=plan.vault;
  const opening=isOpeningMessage(message);
  if(!opening&&!tempVault.messages.some(m=>m.chatId===chat.id&&m.role==="user")){showStatus("There is no user post to regenerate from.","error");return;}
  sending=true;setGenerationUi(true);activeGenerationController=new AbortController();showStatus(opening?"Regenerating opening…":"Regenerating reply…","working");
  try{
    const preferenceLines=vault.preferenceLines?.length?vault.preferenceLines:seedDefaultGreenLines();
    const result=await runTurn({vault:tempVault,storyId:story.id,chatId:chat.id,model,preferenceLines,storySettings:story.settings||{},opening,temperature:story.settings?.temperature??0.9,maxTokens:opening?3000:(story.settings?.maxTokens??1200),repairAttempts:opening?4:2,signal:activeGenerationController.signal});
    if(result.blocked||result.validation?.needsRepair||!result.validation?.ok||!result.text?.trim())throw new Error("Vesper couldn't produce a valid replacement.");
    const usageEntries=(result.usage||[]).map(usage=>recordUsage({storyId:story.id,chatId:chat.id,model,promptTokens:usage?.prompt_tokens||0,completionTokens:usage?.completion_tokens||0,cost:null}));
    const candidate=completeVaultRegeneration(plan,{id:makeId("message"),storyId:story.id,chatId:chat.id,role:"assistant",text:result.text,ordinal:targetOrdinal,createdAt:new Date().toISOString(),validation:result.validation,repaired:result.repaired},usageEntries);
    vault=await saveAppVault(db,candidate,{expectedRevision:plan.expectedRevision});renderStory(story.id,chat.id,"message");showStatus("Reply regenerated.","notice");
  }catch(error){
    const text=error?.code==="VESPER_VAULT_CONFLICT"?`Regeneration was not saved. ${error.message}`:error?.name==="AbortError"?"Regeneration stopped. Original messages kept.":`Regeneration failed: ${error?.message||"The vault save was aborted."} Original messages kept.`;
    showStatus(text,"error");
  }finally{sending=false;activeGenerationController=null;setGenerationUi(false);}
}
function appendStoryText(node,text){
  const quotePattern=/(["“][^"”\n]+["”])/g;
  const textLinePattern=/^([A-Z][A-Z0-9_]{1,31}):\s*(.+)$/;
  for(const paragraph of String(text||"").split(/\n+/)){
    if(!paragraph.trim())continue;
    const textMatch=paragraph.trim().match(textLinePattern);
    if(textMatch){
      const bubble=document.createElement("div");bubble.className="in-story-text-bubble";
      const sender=document.createElement("small");sender.className="in-story-text-sender";sender.textContent=textMatch[1];
      const body=document.createElement("div");body.className="in-story-text-body";body.textContent=textMatch[2];
      bubble.append(sender,body);node.append(bubble);continue;
    }
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
}
function renderMessage(node,message){
  node.replaceChildren();
  const speaker=document.createElement("small");speaker.className="message-speaker";speaker.textContent=messageSpeakerLabel(vault,message);node.append(speaker);
  const text=String(message.text||"");
  appendStoryText(node,text);
  if(message.role==="user"){
    const controls=document.createElement("div");controls.className="message-controls";
    const edit=document.createElement("button");edit.type="button";edit.className="message-edit";edit.textContent="Edit";edit.setAttribute("aria-label","Edit this post");edit.onclick=()=>editUserMessage(message);controls.append(edit);const del=document.createElement("button");del.type="button";del.className="message-edit";del.textContent="Delete";del.setAttribute("aria-label","Delete this post and later dependent posts");del.onclick=()=>deleteMessageBranch(message);controls.append(del);
    if(message.editedAt){const tag=document.createElement("small");tag.className="edited-tag";tag.textContent="edited";controls.append(tag);}
    node.append(controls);return;
  }
  const controls=document.createElement("div");controls.className="message-controls assistant-controls";const edit=document.createElement("button");edit.type="button";edit.className="message-edit";edit.textContent="Edit";edit.setAttribute("aria-label","Edit this reply");edit.onclick=()=>editAssistantMessage(message,node);controls.append(edit);if(message.editedAt){const tag=document.createElement("small");tag.className="edited-tag";tag.textContent="edited";controls.append(tag);}const regen=document.createElement("button");regen.type="button";regen.className="message-edit";regen.textContent="Regenerate";regen.onclick=()=>regenerateAssistantMessage(message);controls.append(regen);const del=document.createElement("button");del.type="button";del.className="message-edit";del.textContent="Delete";del.setAttribute("aria-label","Delete this post and later dependent posts");del.onclick=()=>deleteMessageBranch(message);controls.append(del);node.append(controls);
}
let storyScroller;
function bindMessageScroller(){
  if(!storyScroller)storyScroller=createStoryScroller({scroller:$("messages"),button:$("scrollBottomButton"),shell:document.querySelector(".app-shell")});
}
function jumpMessagesToLatest(smooth=false){bindMessageScroller();storyScroller.position({smooth});}
function renderStory(storyId,chatId,scrollIntent="bottom"){if(activeStoryId!==storyId||activeChatId!==chatId)storyPhone?.close();const shell=document.querySelector(".app-shell");shell.classList.add("story-open");rememberTab("story");rememberStory(storyId);renderQueryMeter();if(!sending)setGenerationUi(false);activeStoryId=storyId;activeChatId=chatId;$("dataView").hidden=true;$("storyNavButton").classList.add("active");$("libraryNavButton").classList.remove("active");$("memoryNavButton").classList.remove("active");$("milestonesNavButton").classList.remove("active");$("milestonesNavButton").textContent="Milestones"+(vault.milestones.some(m=>m.storyId===storyId&&m.status==="candidate")?" •":"");renderStoryPicker();const s=vault.stories.find(x=>x.id===storyId);$("emptyState").hidden=true;$("chatView").hidden=false;storyPhone?.refresh();$("storyTitle").textContent=s?.title||"Untitled";
 const rows=vault.messages.filter(m=>m.storyId===storyId&&(!chatId||m.chatId===chatId)&&!(m.role==="user"&&/^\s*\/continue\s*$/i.test(String(m.text||"")))).sort((x,y)=>{const xo=Number(x.ordinal),yo=Number(y.ordinal);if(Number.isFinite(xo)&&Number.isFinite(yo)&&xo!==yo)return xo-yo;return String(x.createdAt||"").localeCompare(String(y.createdAt||""));});$("messages").innerHTML=rows.map(m=>`<article class="message ${m.role==="user"?"user":"assistant"}"></article>`).join("");[...$("messages").children].forEach((n,i)=>renderMessage(n,rows[i]));const latest=rows.at(-1);if(!sending&&!rows.length&&s?.openingScene){retryMessageId=null;retryOpeningStoryId=s.id;showRetry(true,"Generate Opening");showStatus("This story has no opener yet.","notice");}else if(!sending&&latest?.role==="user"){retryOpeningStoryId=null;retryMessageId=latest.id;showRetry(true,"Generate Missing Reply");showStatus("Your last turn has no Vesper reply yet.","notice");}else if(!sending){if(retryOpeningStoryId===storyId)retryOpeningStoryId=null;showRetry(false);}bindMessageScroller();storyScroller.position({target:scrollIntent==="message"?$("messages").lastElementChild:null});}
boot().catch(error=>{document.body.innerHTML=`<main style="padding:24px;color:#f3ece7;background:#090708;min-height:100vh"><h1>Vesper could not start.</h1><pre></pre></main>`;document.querySelector("pre").textContent=error.stack||error.message;});

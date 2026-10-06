import { openVesperDb, loadVault, saveVaultAtomic } from "./storage/vault-store.js";
import { previewImport, prepareImport, commitPreparedImport } from "./migration/import-service.js";
import { makeId } from "./schema.js";

const $ = id => document.getElementById(id);
let db;
let vault;
let preparedImport = null;

async function boot() {
  db = await openVesperDb();
  vault = await loadVault(db);
  bindUi();
  render();
}

function bindUi() {
  $("importButton").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", handleImportFile);
  $("newStoryButton").addEventListener("click", createStarterStory);
  $("composer").addEventListener("submit", addLocalTurn);
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const source = JSON.parse(await file.text());
    const preview = previewImport(source);
    preparedImport = prepareImport(source);
    const counts = preview.counts || preparedImport.preview?.counts || {};
    $("importPreview").hidden = false;
    $("importPreview").innerHTML = `
      <strong>Import preview</strong>
      <p>${Object.entries(counts).map(([k,v]) => `${k}: ${v}`).join(" · ")}</p>
      <p>No existing Vesper data changes until you confirm.</p>
      <button class="primary" id="confirmImport">Confirm Import</button>`;
    $("confirmImport").addEventListener("click", confirmImport);
  } catch (error) {
    $("importPreview").hidden = false;
    $("importPreview").textContent = `Import error: ${error.message}`;
  }
}

async function confirmImport() {
  if (!preparedImport) return;
  await commitPreparedImport(db, preparedImport);
  vault = await loadVault(db);
  preparedImport = null;
  render();
}

async function createStarterStory() {
  const now = new Date().toISOString();
  const storyId = makeId("story");
  const chatId = makeId("chat");
  vault.stories.push({ id: storyId, title: "New Vesper Story", characterIds: [], personaId: null, createdAt: now, updatedAt: now });
  vault.chats.push({ id: chatId, storyId, title: "Main Story", createdAt: now, updatedAt: now });
  vault.updatedAt = now;
  await saveVaultAtomic(db, vault);
  renderStory(storyId, chatId);
}

async function addLocalTurn(event) {
  event.preventDefault();
  const text = $("messageInput").value.trim();
  if (!text) return;
  const story = vault.stories[0];
  const chat = vault.chats.find(c => c.storyId === story?.id);
  if (!story || !chat) return;
  vault.messages.push({
    id: makeId("message"), storyId: story.id, chatId: chat.id, role: "user", text,
    ordinal: vault.messages.filter(m => m.chatId === chat.id).length, createdAt: new Date().toISOString()
  });
  $("messageInput").value = "";
  await saveVaultAtomic(db, vault);
  renderStory(story.id, chat.id);
}

function render() {
  if (vault.stories.length) {
    const story = vault.stories[0];
    const chat = vault.chats.find(c => c.storyId === story.id);
    renderStory(story.id, chat?.id);
  } else {
    $("emptyState").hidden = false;
    $("chatView").hidden = true;
  }
}

function renderStory(storyId, chatId) {
  const story = vault.stories.find(s => s.id === storyId);
  $("emptyState").hidden = true;
  $("chatView").hidden = false;
  $("storyTitle").textContent = story?.title || "Untitled";
  const rows = vault.messages.filter(m => m.storyId === storyId && (!chatId || m.chatId === chatId));
  $("messages").innerHTML = rows.map(m => `<article class="message ${m.role === "user" ? "user" : "assistant"}"></article>`).join("");
  [...$("messages").children].forEach((node,index) => node.textContent = rows[index].text);
  $("messages").scrollTop = $("messages").scrollHeight;
}

boot().catch(error => {
  document.body.innerHTML = `<main style="padding:24px;color:#f3ece7;background:#090708;min-height:100vh"><h1>Vesper could not start.</h1><pre></pre></main>`;
  document.querySelector("pre").textContent = error.stack || error.message;
});

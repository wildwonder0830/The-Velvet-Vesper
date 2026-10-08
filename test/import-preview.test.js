import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { emptyVault } from "../src/schema.js";
import { previewImport, prepareImport } from "../src/migration/import-service.js";

// Isolate the real file handler from browser startup and IndexedDB. This DOM
// double rejects HTML parsing so untrusted labels must remain ordinary text.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.textContent = ""; }
  set innerHTML(_) { throw new Error("Import preview must not parse HTML."); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}

test("import preview treats malicious backup property names as literal text", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("async function handleImportFile("), source.indexOf("async function confirmImport("));
  const preview = new Element("div");
  const confirmImport = () => {};
  const baseline=emptyVault();
  const context = vm.createContext({
    backupOperation:0,preparedImport:null,rollbackFile:null,importRevision:0,sending:false,phoneBusy:false,importingBackup:false,db:{},
    loadVault:async()=>baseline, readBackupFile:async file=>prepareImport(JSON.parse(await file.text())), createBackupFile:()=>({}),
    openTransfer:()=>{preview.hidden=false;},transferMessage:text=>{preview.textContent=text;return preview;},fileActions:()=>{},
    transferButton:(content,label,id,action)=>{const b=new Element('button');b.textContent=label;b.id=id;b.onclick=action;content.children.push(b);return b;},
    confirmImport,$:()=>preview,
    document: { createElement: tag => {const e=new Element(tag);e.append=(...c)=>e.children.push(...c);return e;},createTextNode:text=>({textContent:text}) }
  });
  vm.runInContext(handler, context);
  const backup = emptyVault();
  const payload = '<img src=x onerror="localStorage.getItem(\'vesper.secret.openrouter-api-key\')">';
  backup[payload] = [];
  await context.handleImportFile({ target: { files: [{ text: async () => JSON.stringify(backup) }] } });
  assert.equal(preview.hidden, false);
  assert.ok(preview.textContent.includes('Validated:'));
  assert.ok(!preview.textContent.includes(payload));
  assert.equal(preview.children.find(c=>c.id==='confirmImport').onclick,confirmImport);
  assert.equal(preview.children.find(c=>c.id==='confirmImport').disabled,true);
});

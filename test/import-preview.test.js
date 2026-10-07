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
  replaceChildren(...children) { this.children = children; }
}

test("import preview treats malicious backup property names as literal text", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("async function handleImportFile("), source.indexOf("async function confirmImport("));
  const preview = new Element("div");
  const confirmImport = () => {};
  const context = vm.createContext({
    previewImport, prepareImport, confirmImport,
    $: id => id === "importPreview" ? preview : preview.children.find(child => child.id === id),
    document: { createElement: tag => new Element(tag) }
  });
  vm.runInContext(handler, context);
  const backup = emptyVault();
  const payload = '<img src=x onerror="localStorage.getItem(\'vesper.secret.openrouter-api-key\')">';
  backup[payload] = [];
  await context.handleImportFile({ target: { files: [{ text: async () => JSON.stringify(backup) }] } });
  assert.equal(preview.hidden, false);
  assert.equal(preview.children.length, 4, preview.textContent);
  assert.equal(preview.children[0].textContent, "Import preview");
  assert.ok(preview.children[1].textContent.includes(`${payload}: 0`));
  assert.equal(preview.children[2].textContent, "No existing Vesper data changes until you confirm.");
  const button = preview.children[3];
  assert.equal(button.id, "confirmImport");
  assert.equal(button.textContent, "Confirm Import");
  assert.equal(button.onclick, confirmImport);
});

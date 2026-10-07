import test from "node:test";
import assert from "node:assert/strict";
import { emptyVault } from "../src/schema.js";
import { prepareImport, previewImport, commitPreparedImport } from "../src/migration/import-service.js";
import { serializePortableBackup, parseVesperBackup } from "../src/backup/vesper-backup.js";

function vesper() {
  const v = emptyVault();
  v.personas.push({id:"p",name:"Persona"});
  v.characters.push({id:"x",name:"Character"});
  v.stories.push({id:"s",title:"Story",personaId:"p",characterIds:["x"],primaryCharacterId:"x"});
  v.chats.push({id:"c",storyId:"s"});
  v.messages.push({id:"m",storyId:"s",chatId:"c",role:"user",text:"Hello",ordinal:0});
  return v;
}
function noctis() {
  return {version:"0.7",personas:[{id:"p",name:"Persona"}],characters:[{id:"x",name:"Character",chats:[{id:"c",activePersonaId:"p",messages:[{id:"m",role:"assistant",text:"Hello"}],milestones:[],scene:{}}]}]};
}

test("valid Vesper exports and supported Noctis imports remain compatible", () => {
  const v = vesper();
  assert.deepEqual(parseVesperBackup(serializePortableBackup(v)).stories, v.stories);
  assert.equal(prepareImport(v).importMode, "replace");
  assert.equal(prepareImport(emptyVault()).vault.stories.length, 0);
  const migrated = prepareImport(noctis());
  assert.equal(migrated.importMode, "merge");
  assert.equal(migrated.vault.messages.length, 1);
  assert.equal(prepareImport(migrated.vault).importMode, "replace");
});

const invalidVesper = [
  ["missing collection", v => { delete v.messages; }],
  ["malformed collection", v => { v.stories = {}; }],
  ["null record", v => { v.messages = [null]; }],
  ["missing record ID", v => { delete v.messages[0].id; }],
  ["duplicate ID", v => { v.messages.push({...v.messages[0]}); }],
  ["missing persona", v => { v.stories[0].personaId = "missing"; }],
  ["missing character", v => { v.stories[0].characterIds = ["missing"]; }],
  ["orphan chat", v => { v.chats[0].storyId = "missing"; }],
  ["orphan message", v => { v.messages[0].chatId = "missing"; }],
  ["wrong message story", v => { v.stories.push({id:"other",title:"Other"}); v.messages[0].storyId = "other"; }],
  ["invalid message text", v => { v.messages[0].text = {}; }],
  ["missing character name", v => { delete v.characters[0].name; }],
  ["missing memory kind", v => { v.memoryEntries.push({id:"mem",storyId:"s",text:"Canon"}); }],
  ["invalid settings", v => { v.stories[0].settings = []; }],
  ["invalid settings ID list", v => { v.stories[0].settings = {enabledPreferenceLineIds:{}}; }],
  ["invalid participants", v => { v.relationships.push({id:"r",storyId:"s",participantIds:{}}); }],
  ["unsupported schema", v => { v.schemaVersion = 99; }],
  ["unsupported backup schema", v => { v.backupSchema = 99; }],
  ["invalid nested source references", v => { v.memoryEntries.push({id:"mem",storyId:"s",kind:"canon",sourceMessageIds:"m"}); }],
  ["dangling source reference", v => { v.memoryEntries.push({id:"mem",storyId:"s",kind:"canon",sourceMessageIds:["missing"]}); }],
  ["invalid numeric usage", v => { v.usageEntries.push({id:"u",model:"model",promptTokens:-1}); }]
];
for (const [name, corrupt] of invalidVesper) {
  test(`Vesper import rejects ${name} without accessing storage`, async () => {
    const v = vesper(); corrupt(v);
    assert.equal(previewImport(v).valid, false);
    assert.throws(() => prepareImport(v), /backup|invalid|unsupported|missing|must/i);
    let accesses = 0;
    const db = {transaction(){ accesses++; throw new Error("Storage must not be accessed"); }};
    await assert.rejects(commitPreparedImport(db, {vault:v,importMode:"replace"}), /backup|invalid|unsupported|missing|must/i);
    assert.equal(accesses, 0);
  });
}

const invalidNoctis = [
  ["null character", s => { s.characters = [null]; }],
  ["malformed chats", s => { s.characters[0].chats = {}; }],
  ["null message", s => { s.characters[0].chats[0].messages = [null]; }],
  ["missing messages", s => { delete s.characters[0].chats[0].messages; }],
  ["malformed message text", s => { s.characters[0].chats[0].messages[0].text = {}; }],
  ["malformed cast", s => { s.characters[0].castMembers = {}; }],
  ["malformed lore", s => { s.characters[0].lore = [null]; }],
  ["missing persona reference", s => { s.characters[0].chats[0].activePersonaId = "missing"; }],
  ["duplicate persona ID", s => { s.personas.push({...s.personas[0]}); }],
  ["malformed scene", s => { s.characters[0].chats[0].scene = []; }]
];
for (const [name, corrupt] of invalidNoctis) {
  test(`Noctis import rejects ${name} with a readable validation error`, () => {
    const source = noctis(); corrupt(source);
    const preview = previewImport(source);
    assert.equal(preview.valid, false);
    assert.ok(preview.errors.length);
    assert.throws(() => prepareImport(source), /Noctis backup/i);
  });
}

test("corrupted JSON receives a readable backup error", () => {
  assert.throws(() => parseVesperBackup('{"format":'), /backup.*JSON/i);
});

test("primitive and incomplete backup roots are rejected safely", () => {
  for (const source of [null, [], "backup", 1, {}, {version:"0.7"}]) {
    assert.equal(previewImport(source).valid, false);
    assert.throws(() => prepareImport(source), /backup/i);
  }
});

test("invalid merge input is rejected before reading existing data", async () => {
  const v = vesper(); v.chats = null;
  let accessed = false;
  await assert.rejects(commitPreparedImport({transaction(){ accessed=true; }}, {vault:v,importMode:"merge"}));
  assert.equal(accessed, false);
});

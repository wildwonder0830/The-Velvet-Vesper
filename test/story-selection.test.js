import test from "node:test";
import assert from "node:assert/strict";
import { emptyVault } from "../src/schema.js";
import { storyIsRunnable } from "../src/library/story-selection.js";

test("empty story cannot run without persona and character", () => {
  const vault=emptyVault("2026-01-01T00:00:00Z");
  vault.stories.push({id:"s1",personaId:null,characterIds:[]});
  vault.chats.push({id:"c1",storyId:"s1"});
  assert.equal(storyIsRunnable(vault,"s1").ok,false);
});

test("fully assigned story is runnable", () => {
  const vault=emptyVault("2026-01-01T00:00:00Z");
  vault.personas.push({id:"p1"});
  vault.characters.push({id:"x1"});
  vault.stories.push({id:"s1",personaId:"p1",primaryCharacterId:"x1",characterIds:["x1"]});
  vault.chats.push({id:"c1",storyId:"s1"});
  assert.equal(storyIsRunnable(vault,"s1").ok,true);
});

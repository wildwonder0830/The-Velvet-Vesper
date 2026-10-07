import test from "node:test";
import assert from "node:assert/strict";

test("the turn engine and its startup dependencies can be imported", async () => {
  const engine = await import("../src/chat/turn-engine.js");
  assert.equal(typeof engine.runTurn, "function");
});

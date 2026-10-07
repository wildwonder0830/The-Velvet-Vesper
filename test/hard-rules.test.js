import test from "node:test";import assert from "node:assert/strict";
import {applyHardRuleSanitizers,findHardRuleViolations} from "../src/rules/hard-rules.js";
import {validateModelOutput} from "../src/validation/output-gate.js";
test("forbidden nickname is sanitized regardless of case",()=>{assert.equal(applyHardRuleSanitizers("MANDY and mandy"),"Amanda and Amanda");});
test("forbidden nickname blocks model output",()=>{assert.equal(validateModelOutput({text:"Hello, Mandy."}).ok,false);});
test("mate bond reset requests repair",()=>{const r=validateModelOutput({text:"Do you love me?",continuity:{mateBond:true}});assert.equal(r.needsRepair,true);});

test("My Turn rejects meta acknowledgements",()=>{const r=validateModelOutput({text:"Understood. The previous response concluded cleanly. Ready for the next turn whenever you are.",personaDraft:true});assert.equal(r.needsRepair,true);assert.equal(r.issues.some(x=>x.type==="persona-draft-meta"),true);});

test("assistant cannot invent Amanda private notes",()=>{const r=validateModelOutput({text:"He scrolled to the next note.\n\n*2. Want him to know I chose him.*",priorUserText:"He read the notes she had written."});assert.equal(r.ok,false);assert.equal(r.issues.some(x=>x.type==="persona-private-authorship"),true);});

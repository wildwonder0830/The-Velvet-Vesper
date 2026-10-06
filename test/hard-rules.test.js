import test from "node:test";import assert from "node:assert/strict";
import {applyHardRuleSanitizers,findHardRuleViolations} from "../src/rules/hard-rules.js";
import {validateModelOutput} from "../src/validation/output-gate.js";
test("forbidden nickname is sanitized regardless of case",()=>{assert.equal(applyHardRuleSanitizers("MANDY and mandy"),"Amanda and Amanda");});
test("forbidden nickname blocks model output",()=>{assert.equal(validateModelOutput({text:"Hello, Mandy."}).ok,false);});
test("mate bond reset requests repair",()=>{const r=validateModelOutput({text:"Do you love me?",continuity:{mateBond:true}});assert.equal(r.needsRepair,true);});

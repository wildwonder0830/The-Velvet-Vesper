import { findHardRuleViolations } from "../rules/hard-rules.js";

const USER_AGENCY_PATTERNS = [
  /\bAmanda\s+(?:said|says|asked|asks|thought|thinks|felt|feels|decided|decides|realized|realizes)\b/i,
  /\bAmanda\s+(?:nodded|smiled|laughed|kissed|touched|moved|walked|reached|pulled|pushed|turned)\b/i
];

const PASSIVE_HANDOFF_PATTERNS = [
  /\byour move\b/i,
  /\bwait(?:s|ing)? for (?:her|Amanda) to (?:respond|react|decide|speak|act)\b/i
];

export function validateModelOutput({ text, continuity = {}, forbiddenTerms = [] }) {
  const issues = [];
  for (const violation of findHardRuleViolations(text)) issues.push({ type: "hard-rule", severity: "block", ...violation });

  for (const term of forbiddenTerms) {
    if (term && String(text).toLowerCase().includes(String(term).toLowerCase())) {
      issues.push({ type: "forbidden-term", severity: "block", term });
    }
  }

  for (const pattern of USER_AGENCY_PATTERNS) {
    if (pattern.test(text)) issues.push({ type: "user-agency", severity: "repair", message: "Model narrated Amanda's side." });
  }
  for (const pattern of PASSIVE_HANDOFF_PATTERNS) {
    if (pattern.test(text)) issues.push({ type: "passive-handoff", severity: "repair", message: "Model defaulted to passive waiting/hand-off." });
  }

  if (continuity.mateBond && /\b(?:first kiss|do you love me|does she love him|are we together)\b/i.test(text)) {
    issues.push({ type: "continuity-reset", severity: "repair", message: "Output conflicts with established mate-bond state." });
  }

  return {
    ok: !issues.some(issue => issue.severity === "block"),
    needsRepair: issues.some(issue => issue.severity === "repair"),
    issues
  };
}

export function buildRepairInstruction(result, { opening = false } = {}) {
  if (!result?.issues?.length) return "";
  const reasons = result.issues.map(issue => `- ${issue.message || issue.term || issue.type}`).join("\n");
  return `Rewrite the response without changing the intended story beat. Correct these violations:\n${reasons}\nDo not narrate the user-controlled persona's actions, dialogue, thoughts, feelings, or choices. Preserve established canon and relationship state.${opening ? " For an opening turn, do not use passive handoff language; simply end on the configured completed opening beat without narrating Amanda." : ""}`;
}

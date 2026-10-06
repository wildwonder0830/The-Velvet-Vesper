import { findHardRuleViolations } from "../rules/hard-rules.js";

const USER_AGENCY_PATTERNS = [
  // Catch clear NEW voluntary/consequential actions. Do not flag simple references
  // to dialogue, feelings, or realizations because those may be restating facts the
  // user just established in her own turn.
  /\bAmanda\s+(?:kissed|touch(?:ed|es)|reached\s+for|took|takes|accepted|accepts|agreed|agrees|followed|follows|chose|chooses|decided|decides|nodded|nods|stepped\s+(?:toward|closer)|walked\s+(?:toward|with)|gave\s+him|gave\s+them|handed\s+(?:him|them))\b/i
];

const PASSIVE_HANDOFF_PATTERNS = [
  /\byour move\b/i,
  /\bwait(?:s|ing)? for (?:her|Amanda) to (?:respond|react|decide|speak|act)\b/i
];

export function validateModelOutput({ text, continuity = {}, forbiddenTerms = [], opening = false, personaDraft = false, priorUserText = "" }) {
  const issues = [];
  if (!String(text || "").trim()) {
    issues.push({
      type: "empty-output",
      severity: "repair",
      message: "Model returned no visible reply text. Produce the requested roleplay prose in the assistant message content."
    });
  }
  for (const violation of findHardRuleViolations(text)) issues.push({ type: "hard-rule", severity: "block", ...violation });

  for (const term of forbiddenTerms) {
    if (term && String(text).toLowerCase().includes(String(term).toLowerCase())) {
      issues.push({ type: "forbidden-term", severity: "block", term });
    }
  }

  if (!personaDraft) {
    for (const pattern of USER_AGENCY_PATTERNS) {
      const outputMatch = text.match(pattern)?.[0]?.replace(/\s+/g, " ").trim().toLowerCase();
      const userEstablished = outputMatch && priorUserText.replace(/\s+/g, " ").toLowerCase().includes(outputMatch);
      if (outputMatch && !userEstablished) issues.push({ type: "user-agency", severity: "repair", message: "Model supplied a voluntary or consequential choice for Amanda." });
    }
  }
  if (!opening && !personaDraft) {
    for (const pattern of PASSIVE_HANDOFF_PATTERNS) {
      if (pattern.test(text)) issues.push({ type: "passive-handoff", severity: "repair", message: "Model defaulted to passive waiting/hand-off." });
    }
  }
  if (personaDraft && /\b(?:understood|previous response|future responses|ready for the next turn|whenever you are|i(?:\'| a)?m ready)\b/i.test(String(text))) {
    issues.push({ type: "persona-draft-meta", severity: "repair", message: "My Turn returned meta/instructional chatter instead of Amanda\'s draft." });
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

export function buildRepairInstruction(result, { opening = false, personaDraft = false } = {}) {
  if (!result?.issues?.length) return "";
  const reasons = result.issues.map(issue => `- ${issue.message || issue.term || issue.type}`).join("\n");
  const agencyRule=personaDraft
    ? "This is a MY TURN draft: write only Amanda's proposed turn and do not write model-controlled characters' dialogue, actions, thoughts, or reactions."
    : "Do not supply the user-controlled persona's voluntary actions, substantive dialogue, thoughts, feelings, intentions, trust, consent, or consequential choices. Involuntary, unavoidable, mechanically necessary, or explicitly pre-established events may be narrated.";
  return `Rewrite the response without changing the intended story beat. Correct these violations:\n${reasons}\n${agencyRule} Preserve established canon and relationship state.${opening ? " For an opening turn, do not use passive handoff language; simply end on the configured completed opening beat without narrating Amanda." : ""}`;
}

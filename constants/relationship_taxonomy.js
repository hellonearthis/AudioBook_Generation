"use strict";

// =========================================================================
// SHARED RELATIONSHIP TAXONOMY — SINGLE SOURCE OF TRUTH
// =========================================================================
// WHAT: The canonical relation_type / relation_tone / status / power_dynamic /
//       transition enums used across Cast Discovery (Pass 1), Relationship
//       Delta detection (Pass 2.5), Directorial Orchestration (Pass 3), and
//       the Laya QC Pipeline's relationship-evidence gate.
// WHY: These enums used to be hardcoded as literal strings independently in
//      four different files and had already drifted three different ways:
//        - cast_discovery.txt        10 values (current)
//        - relationship_delta.txt    10 values (current)
//        - directorial_orchestration.txt   6 values (missing 4)
//        - laya_qc_pipeline.js       5 values, incl. "adversarial" which
//                                    doesn't exist anywhere else anymore
//      Every consumer should import from here and interpolate it into its
//      prompt text or validation logic, instead of retyping the list, so a
//      future addition or rename only has to happen in one place.

const RELATION_TYPES = [
  "family",
  "romantic",
  "friendship",
  "professional",
  "acquaintance",
  "mentor_student",
  "service",
  "allied",
  "stranger",
  "unknown"
];

const RELATION_TONES = [
  "warm",
  "neutral",
  "tense",
  "competitive",
  "hostile",
  "unknown"
];

const STATUSES = [
  "current",
  "former",
  "estranged",
  "developing"
];

const POWER_DYNAMICS = [
  "equal",
  "a_over_b",
  "b_over_a",
  "unknown"
];

const TRANSITIONS = [
  "instant",
  "gradual"
];

// WHAT: Formats an enum list as a pipe-delimited schema value, e.g. "a | b | c".
// WHY: This is the format used inside JSON schema example blocks in prompts,
//      where the value itself documents the allowed options to the model.
function format_enum_as_pipe_list(enum_values_list) {
  return enum_values_list.join(" | ");
}

// WHAT: Formats an enum list as a JSON-style bracketed string array, e.g. ["a", "b", "c"].
// WHY: This is the format used in prose "CONSTRAINED ENUM" rule blocks in prompts.
//      Spaced manually (rather than via JSON.stringify) to match the original
//      hand-written prompt formatting exactly.
function format_enum_as_bracket_list(enum_values_list) {
  return `[${enum_values_list.map((value) => `"${value}"`).join(", ")}]`;
}

module.exports = {
  RELATION_TYPES,
  RELATION_TONES,
  STATUSES,
  POWER_DYNAMICS,
  TRANSITIONS,
  format_enum_as_pipe_list,
  format_enum_as_bracket_list
};

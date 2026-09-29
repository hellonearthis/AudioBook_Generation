"use strict";

// =========================================================================
// PASS 2.5: RELATIONSHIP TIMELINE STATE ENGINE & AuK-08 EMOTION MAPPER
// =========================================================================
// WHAT: Manages chronological relationship state timelines between character pairs,
//       resolves active interpersonal dynamics at any given segment index,
//       and normalizes emotion labels onto the AuK-08 post-production palette
//       with explicit routing for whispers.
// WHY: Pass 3 directorial staging requires full relational context (e.g. Josh and Maren
//      have been estranged since segment 214) rather than just an isolated 3-sentence
//      window. Without persistent timeline states, models suffer from cross-chapter amnesia.

// WHAT: Constrained emotion palette supported natively by the AuK-08 Emotion Morphing model.
// WHY: Ensures extracted emotions map 1-to-1 with AuK workflow conditioning without fallback failures.
const AUK_08_CANONICAL_EMOTION_PALETTE_LIST = [
  "calm",
  "happy",
  "sad",
  "angry",
  "fearful",
  "surprised",
  "disgusted",
  "excited",
  "neutral"
];

// WHAT: Import single source of truth relationship taxonomy constants.
// WHY: Ensures all passes share an identical 10-type structural taxonomy, 6 tones, 4 statuses, and 4 power dynamics.
const {
  RELATION_TYPES,
  RELATION_TONES,
  STATUSES,
  POWER_DYNAMICS,
  TRANSITIONS
} = require("../constants/relationship_taxonomy");

// Aliases for backwards compatibility
const CANONICAL_RELATIONSHIP_TYPES_LIST = RELATION_TYPES;
const CANONICAL_RELATIONSHIP_TONES_LIST = RELATION_TONES;
const CANONICAL_RELATIONSHIP_STATUSES_LIST = STATUSES;
const CANONICAL_RELATIONSHIP_POWER_DYNAMICS_LIST = POWER_DYNAMICS;

// -------------------------------------------------------------------------
// RELATIONSHIP TIMELINE LOOKUP & DELTA MERGING
// -------------------------------------------------------------------------

// WHAT: Generating standard lowercase snake_case pair identifier for two characters.
// WHY: Keeps pair IDs consistent regardless of which character is passed first (e.g. josh_maren).
function generate_canonical_relationship_pair_identifier(first_character_name, second_character_name) {
  const normalized_first_name = (first_character_name || "").toLowerCase().replace(/[\s-]+/g, "_").trim();
  const normalized_second_name = (second_character_name || "").toLowerCase().replace(/[\s-]+/g, "_").trim();
  return [normalized_first_name, normalized_second_name].sort().join("_");
}

// WHAT: Resolving the active relationship state between two characters at a specific segment index.
// WHY: Directorial Pass 3 needs the exact interpersonal standing (warm, tense, hostile) in effect at this line.
function resolve_active_relationship_state_at_segment({
  relationships_list = [],
  first_character_name,
  second_character_name,
  current_segment_index_number = 0
}) {
  if (!first_character_name || !second_character_name) {
    return {
      pair_id: null,
      relation_type: "unknown",
      relation_tone: "neutral",
      status: "current",
      power_dynamic: "equal",
      trigger: null
    };
  }

  const normalized_first_name = first_character_name.toLowerCase().trim();
  const normalized_second_name = second_character_name.toLowerCase().trim();

  // WHAT: Searching for an existing relationship record matching this character pair.
  // WHY: Checks bidirectional combinations (A with B or B with A).
  const matched_relationship_record = relationships_list.find((relationship_candidate) => {
    const candidate_character_a = (relationship_candidate.a || relationship_candidate.char_a || "").toLowerCase().trim();
    const candidate_character_b = (relationship_candidate.b || relationship_candidate.char_b || "").toLowerCase().trim();

    return (
      (candidate_character_a === normalized_first_name && candidate_character_b === normalized_second_name) ||
      (candidate_character_a === normalized_second_name && candidate_character_b === normalized_first_name)
    );
  });

  if (!matched_relationship_record) {
    return {
      pair_id: generate_canonical_relationship_pair_identifier(first_character_name, second_character_name),
      relation_type: "stranger",
      relation_tone: "neutral",
      status: "current",
      power_dynamic: "equal",
      trigger: null
    };
  }

  // WHAT: Checking if the record uses modern chronological states timeline or legacy flat fields.
  // WHY: Backwards compatibility allows projects created under older schemas to function seamlessly.
  const states_timeline_list = Array.isArray(matched_relationship_record.states)
    ? matched_relationship_record.states
    : [
        {
          from_segment: 0,
          relation_type: matched_relationship_record.relation_type || "unknown",
          relation_tone: matched_relationship_record.relation_tone || "neutral",
          status: matched_relationship_record.status || "current",
          power_dynamic: matched_relationship_record.power_dynamic || "equal",
          trigger: null
        }
      ];

  // WHAT: Sorting states chronologically by starting segment boundary.
  // WHY: Guarantees that iterative state searches evaluate historical transitions in sequence.
  const sorted_states_list = [...states_timeline_list].sort((first_state_entry, second_state_entry) => {
    const first_segment_index = Number.isInteger(first_state_entry.from_segment)
      ? first_state_entry.from_segment
      : (first_state_entry.from?.segment || 0);
    const second_segment_index = Number.isInteger(second_state_entry.from_segment)
      ? second_state_entry.from_segment
      : (second_state_entry.from?.segment || 0);
    return first_segment_index - second_segment_index;
  });

  // WHAT: Selecting the latest state that took effect on or before the current segment.
  // WHY: If Josh discovers the forged will at line 214, lines 214+ inherit 'tense', while line 50 stays 'warm'.
  let active_resolved_state_record = sorted_states_list[0];
  for (let state_counter = 0; state_counter < sorted_states_list.length; state_counter++) {
    const candidate_state_record = sorted_states_list[state_counter];
    const candidate_segment_boundary = Number.isInteger(candidate_state_record.from_segment)
      ? candidate_state_record.from_segment
      : (candidate_state_record.from?.segment || 0);

    if (candidate_segment_boundary <= current_segment_index_number) {
      active_resolved_state_record = candidate_state_record;
    } else {
      break;
    }
  }

  return {
    pair_id: matched_relationship_record.id || generate_canonical_relationship_pair_identifier(first_character_name, second_character_name),
    relation_type: active_resolved_state_record.relation_type || "unknown",
    relation_tone: active_resolved_state_record.relation_tone || "neutral",
    status: active_resolved_state_record.status || "current",
    power_dynamic: active_resolved_state_record.power_dynamic || "equal",
    trigger: active_resolved_state_record.trigger || null,
    evidence: active_resolved_state_record.evidence || []
  };
}

// WHAT: Merging newly identified relationship transitions into the persistent relationships database.
// WHY: Preserves historically identified milestone transitions while appending new discoveries from Pass 2.5.
function merge_relationship_state_deltas({
  existing_relationships_list = [],
  incoming_relationship_changes_list = []
}) {
  const updated_relationships_list = [...existing_relationships_list];

  for (let change_counter = 0; change_counter < incoming_relationship_changes_list.length; change_counter++) {
    const incoming_change_record = incoming_relationship_changes_list[change_counter];
    const character_a_name = (incoming_change_record.a || "").trim();
    const character_b_name = (incoming_change_record.b || "").trim();

    if (!character_a_name || !character_b_name) {
      continue;
    }

    const pair_identifier = incoming_change_record.id || generate_canonical_relationship_pair_identifier(character_a_name, character_b_name);
    let existing_relationship_entry = updated_relationships_list.find((relationship_candidate) => {
      const candidate_id = relationship_candidate.id || generate_canonical_relationship_pair_identifier(relationship_candidate.a, relationship_candidate.b);
      return candidate_id === pair_identifier;
    });

    const new_state_object = {
      from_segment: Number.isInteger(incoming_change_record.from_segment) ? incoming_change_record.from_segment : 0,
      relation_type: incoming_change_record.relation_type || "unknown",
      relation_tone: incoming_change_record.relation_tone || "neutral",
      status: incoming_change_record.status || "current",
      power_dynamic: incoming_change_record.power_dynamic || "equal",
      trigger: incoming_change_record.trigger || null,
      evidence: Array.isArray(incoming_change_record.evidence) ? incoming_change_record.evidence : []
    };

    if (existing_relationship_entry) {
      if (!Array.isArray(existing_relationship_entry.states)) {
        existing_relationship_entry.states = [
          {
            from_segment: 0,
            relation_type: existing_relationship_entry.relation_type || "unknown",
            relation_tone: existing_relationship_entry.relation_tone || "neutral",
            status: existing_relationship_entry.status || "current",
            power_dynamic: existing_relationship_entry.power_dynamic || "equal",
            trigger: null
          }
        ];
      }

      // Check if a state already exists for this exact segment boundary
      const existing_state_index = existing_relationship_entry.states.findIndex(
        (state_candidate) => (state_candidate.from_segment || 0) === new_state_object.from_segment
      );

      if (existing_state_index >= 0) {
        existing_relationship_entry.states[existing_state_index] = {
          ...existing_relationship_entry.states[existing_state_index],
          ...new_state_object
        };
      } else {
        existing_relationship_entry.states.push(new_state_object);
      }

      // Sort states chronologically
      existing_relationship_entry.states.sort((first_state, second_state) => (first_state.from_segment || 0) - (second_state.from_segment || 0));
    } else {
      updated_relationships_list.push({
        id: pair_identifier,
        a: character_a_name,
        b: character_b_name,
        states: [new_state_object]
      });
    }
  }

  return updated_relationships_list;
}

// -------------------------------------------------------------------------
// AuK-08 EMOTION MAPPING & EXPLICIT WHISPER ROUTING
// -------------------------------------------------------------------------

// WHAT: Mapping arbitrary natural language emotion descriptors onto the AuK-08 emotion enum.
// WHY: AuK-08 post-production emotion morphing only accepts its exact 8 canonical labels.
//      Any detected whisper is explicitly tagged for the AuK-12 whisper conversion workflow.
function map_emotion_to_auk08_palette(raw_emotion_string_descriptor, delivery_direction_string_descriptor = "") {
  const combined_search_text = `${raw_emotion_string_descriptor || ""} ${delivery_direction_string_descriptor || ""}`.toLowerCase();

  // WHAT: Explicit whisper routing check.
  // WHY: Whispers require specialized acoustic conversion (AuK-12) rather than general pitch/tempo shifts.
  const is_explicit_whisper_detected =
    combined_search_text.includes("whisper") ||
    combined_search_text.includes("hushed") ||
    combined_search_text.includes("under breath") ||
    combined_search_text.includes("murmur");

  let canonical_auk_emotion_label = "calm";
  let detected_intensity_score = 0.7;

  if (combined_search_text.includes("angry") || combined_search_text.includes("furious") || combined_search_text.includes("snarl") || combined_search_text.includes("rage")) {
    canonical_auk_emotion_label = "angry";
    detected_intensity_score = 0.85;
  } else if (combined_search_text.includes("sad") || combined_search_text.includes("sorrow") || combined_search_text.includes("grief") || combined_search_text.includes("melanchol")) {
    canonical_auk_emotion_label = "sad";
    detected_intensity_score = 0.80;
  } else if (combined_search_text.includes("fear") || combined_search_text.includes("terror") || combined_search_text.includes("panic") || combined_search_text.includes("afraid") || combined_search_text.includes("trembl")) {
    canonical_auk_emotion_label = "fearful";
    detected_intensity_score = 0.85;
  } else if (combined_search_text.includes("excit") || combined_search_text.includes("eager") || combined_search_text.includes("enthusias")) {
    canonical_auk_emotion_label = "excited";
    detected_intensity_score = 0.80;
  } else if (combined_search_text.includes("happ") || combined_search_text.includes("joy") || combined_search_text.includes("warmth") || combined_search_text.includes("laugh")) {
    canonical_auk_emotion_label = "happy";
    detected_intensity_score = 0.75;
  } else if (combined_search_text.includes("surpris") || combined_search_text.includes("shock") || combined_search_text.includes("startl")) {
    canonical_auk_emotion_label = "surprised";
    detected_intensity_score = 0.75;
  } else if (combined_search_text.includes("disgust") || combined_search_text.includes("sneer") || combined_search_text.includes("bitter")) {
    canonical_auk_emotion_label = "disgusted";
    detected_intensity_score = 0.75;
  } else if (combined_search_text.includes("neutral")) {
    canonical_auk_emotion_label = "neutral";
    detected_intensity_score = 0.50;
  }

  return {
    auk08_emotion: canonical_auk_emotion_label,
    intensity: detected_intensity_score,
    is_whisper: is_explicit_whisper_detected,
    workflow_route: is_explicit_whisper_detected ? "auk_whisper" : "auk_emotion"
  };
}

// WHAT: Formatting active pair relationships into a clean, compact text block for Pass 3 prompts.
// WHY: Keeps the prompt payload small and avoids blowing local LLM context limits with irrelevant history.
function format_active_relationships_summary_for_prompt(active_scene_characters_list, relationships_list, segment_index_number) {
  if (!active_scene_characters_list || active_scene_characters_list.length < 2) {
    return "No multi-character pairs in this scene.";
  }

  const summarized_pair_lines_list = [];
  for (let first_indexer = 0; first_indexer < active_scene_characters_list.length; first_indexer++) {
    for (let second_indexer = first_indexer + 1; second_indexer < active_scene_characters_list.length; second_indexer++) {
      const first_character = active_scene_characters_list[first_indexer];
      const second_character = active_scene_characters_list[second_indexer];

      const active_state = resolve_active_relationship_state_at_segment({
        relationships_list,
        first_character_name: first_character.name || first_character.id,
        second_character_name: second_character.name || second_character.id,
        current_segment_index_number: segment_index_number
      });

      let summary_line = `• ${first_character.name || first_character.id} & ${second_character.name || second_character.id}: ${active_state.relation_type} (${active_state.relation_tone}, ${active_state.status})`;
      if (active_state.trigger) {
        summary_line += ` [Since: ${active_state.trigger}]`;
      }
      summarized_pair_lines_list.push(summary_line);
    }
  }

  return summarized_pair_lines_list.length > 0 ? summarized_pair_lines_list.join("\n") : "No established relationship history.";
}

module.exports = {
  resolve_active_relationship_state_at_segment,
  merge_relationship_state_deltas,
  map_emotion_to_auk08_palette,
  format_active_relationships_summary_for_prompt,
  generate_canonical_relationship_pair_identifier,
  AUK_08_CANONICAL_EMOTION_PALETTE_LIST,
  CANONICAL_RELATIONSHIP_TYPES_LIST,
  CANONICAL_RELATIONSHIP_TONES_LIST,
  CANONICAL_RELATIONSHIP_STATUSES_LIST,
  CANONICAL_RELATIONSHIP_POWER_DYNAMICS_LIST,
  RELATION_TYPES,
  RELATION_TONES,
  STATUSES,
  POWER_DYNAMICS,
  TRANSITIONS
};

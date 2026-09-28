"use strict";

// =========================================================================
// TWO-STAGE MULTI-MODEL SPEAKER ATTRIBUTION ENGINE
// =========================================================================
// WHAT: Second pass attribution engine that resolves WHO spoke each dialogue span.
//       1. Cheap deterministic rules (monologue continuation, dialogue tags).
//       2. Multi-model classifier quiz (Laya & CLM pick from scene cast with
//          forward & reversed option order to eliminate position bias).
//       3. Soft heuristics (vocative penalty, 2-person A/B alternation bonus).
//       4. Confidence scoring, candidate distributions, and optional LLM escalation.
//       5. Direct review queue sorting by uncertainty (lowest confidence first).
// WHY: Splitting span detection from speaker selection stops ambiguous dialogue
//      from silently defaulting to "Narrator". Only character IDs or "unknown" are
//      permitted, ensuring every uncertain line is explicitly flagged for review.

const crypto_library = require("crypto");

// WHAT: Constant designating an unresolvable or ambiguous speaker.
// WHY: Known dialogue spans must NEVER default to "narrator"; if uncertain, they are marked unknown.
const UNKNOWN_SPEAKER_IDENTIFIER = "unknown";

// WHAT: Engine configuration thresholds and window bounds.
// WHY: Tunes the balance between high-confidence automatic acceptance and safe review-queue escalation.
const DEFAULT_ATTRIBUTION_CONFIGURATION_OPTIONS = {
  paragraphs_of_context_before_target: 3,     // Paragraphs before target line to capture tags and setup
  paragraphs_of_context_after_target: 1,      // Paragraphs after target line to capture following beats
  minimum_score_threshold_for_auto_accept: 0.60, // Minimum top candidate score needed for clean auto-accept
  minimum_runner_up_gap_for_auto_accept: 0.25,   // Margin over runner-up needed to prevent tie ambiguity
  minimum_score_cutoff_before_unknown: 0.35,     // If top candidate is below this, assign unknown
  vocative_listener_penalty_scalar: 0.15,        // "Josh, listen" -> Josh is the listener, penalized as speaker
  alternation_turn_taking_bonus_scalar: 0.10,    // A/B/A/B conversational rhythm bonus
  character_speech_tag_window_character_count: 80 // Search radius around quotation marks for "said Maren"
};

// WHAT: Canonical dialogue attribution speech verbs.
// WHY: Used by regex tag matching to identify dialogue attributions without catching general narrative verbs.
const CANONICAL_SPEECH_VERBS_LIST = [
  "said", "says", "asked", "asks", "replied", "replies", "whispered", "shouted", "muttered",
  "snapped", "answered", "called", "cried", "murmured", "growled", "sighed", "laughed", "added",
  "demanded", "yelled", "told", "continued", "insisted", "stammered", "hissed", "breathed", "snarled"
];
const COMPILED_SPEECH_VERBS_REGEX_SOURCE = CANONICAL_SPEECH_VERBS_LIST.join("|");

// -------------------------------------------------------------------------
// TEXT SANITIZATION & MARKER HELPERS
// -------------------------------------------------------------------------

// WHAT: Escaping special regex characters for literal string matching.
// WHY: Prevents characters with dots, parentheses, or brackets in names from breaking regular expressions.
function escape_regular_expression_pattern_string(literal_input_string) {
  return literal_input_string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// WHAT: Compiling character name and alias tokens into a regex alternation pattern.
// WHY: Allows the engine to match full names, first names, or declared aliases sorted by longest first.
function compile_character_name_regex_source(character_profile_object) {
  const all_name_variants_list = [
    character_profile_object.name,
    ...(character_profile_object.aliases || [])
  ]
    .filter(Boolean)
    .map(escape_regular_expression_pattern_string)
    .sort((first_candidate, second_candidate) => second_candidate.length - first_candidate.length);

  return all_name_variants_list.join("|");
}

// WHAT: Masking quoted dialogue inside a paragraph with whitespace while preserving character offsets.
// WHY: Ensures tag searches only look for verbs and names in the surrounding prose, not inside quoted dialogue.
function mask_quoted_dialogue_preserving_character_offsets(paragraph_text_string) {
  return paragraph_text_string.replace(/["“][^"“”]*["”]/g, (matching_quoted_substring) => {
    return matching_quoted_substring.replace(/[^\n]/g, " ");
  });
}

// WHAT: Locating the start and end offsets of a dialogue span within a paragraph.
// WHY: Accurately isolates where the quote sits relative to surrounding text and dialogue tags.
function locate_dialogue_span_character_range(paragraph_text_string, dialogue_span_object) {
  const start_character_offset = Number.isInteger(dialogue_span_object.start)
    ? dialogue_span_object.start
    : paragraph_text_string.indexOf(dialogue_span_object.text);

  if (start_character_offset < 0) {
    return null;
  }
  return {
    start: start_character_offset,
    end: start_character_offset + dialogue_span_object.text.length
  };
}

// WHAT: Wrapping the active dialogue span with explicit visual marker delimiters.
// WHY: Prevents local models and classifiers from confusing repeated words across lines in the same scene.
function mark_target_dialogue_span_with_delimiters(paragraph_text_string, dialogue_span_object) {
  const span_character_range = locate_dialogue_span_character_range(paragraph_text_string, dialogue_span_object);
  if (!span_character_range) {
    return paragraph_text_string;
  }
  return (
    paragraph_text_string.slice(0, span_character_range.start) +
    `[[LINE ${dialogue_span_object.id}]]` +
    paragraph_text_string.slice(span_character_range.start, span_character_range.end) +
    `[[/LINE]]` +
    paragraph_text_string.slice(span_character_range.end)
  );
}

// -------------------------------------------------------------------------
// SCENE BOUNDARY & SCENE CAST DETECTION
// -------------------------------------------------------------------------

// WHAT: Pattern detecting scene transitions, chapter headers, and divider lines.
// WHY: Scene state, recent speakers, and candidate cast lists must reset cleanly across scene breaks.
const SCENE_BREAK_DELIMITER_REGEX_PATTERN = /^\s*(\*\s*\*\s*\*|\*{3,}|-{3,}|#{1,3}\s.*|chapter\s+\w+.*)\s*$/i;

// WHAT: Splitting a book's paragraph array into isolated scene boundaries.
// WHY: Processing text scene-by-scene localizes context and prevents character bleed across locations.
function split_paragraphs_into_scene_boundaries(paragraphs_list) {
  const detected_scene_boundaries_list = [];
  let scene_starting_paragraph_index = 0;

  paragraphs_list.forEach((paragraph_item_string, current_paragraph_index) => {
    if (SCENE_BREAK_DELIMITER_REGEX_PATTERN.test(paragraph_item_string)) {
      if (current_paragraph_index > scene_starting_paragraph_index) {
        detected_scene_boundaries_list.push({
          start: scene_starting_paragraph_index,
          end: current_paragraph_index
        });
      }
      scene_starting_paragraph_index = current_paragraph_index + 1;
    }
  });

  if (scene_starting_paragraph_index < paragraphs_list.length) {
    detected_scene_boundaries_list.push({
      start: scene_starting_paragraph_index,
      end: paragraphs_list.length
    });
  }
  return detected_scene_boundaries_list;
}

// WHAT: Identifying which cast members are physically present in a scene.
// WHY: Limits candidate choices for local classifiers, vastly increasing accuracy and preventing hallucination.
function detect_active_scene_cast_members(paragraphs_list, scene_boundary_object, global_characters_list) {
  const full_scene_text_content = paragraphs_list
    .slice(scene_boundary_object.start, scene_boundary_object.end)
    .join("\n");

  const present_cast_members_list = global_characters_list.filter((single_character_profile) => {
    if (single_character_profile.alwaysPresent) {
      return true;
    }
    const character_regex_source = compile_character_name_regex_source(single_character_profile);
    return new RegExp(`\\b(?:${character_regex_source})\\b`, "i").test(full_scene_text_content);
  });

  // WHAT: Fallback to all characters if fewer than two are explicitly named.
  // WHY: Handles pronoun-heavy scenes where two characters interact without repeating their proper names.
  return present_cast_members_list.length >= 2 ? present_cast_members_list : global_characters_list;
}

// WHAT: Tracking conversational state, recent turns, and last speakers within an active scene.
// WHY: Enables two-person alternation hints, monologue continuation, and listener attribution.
class ActiveSceneConversationalState {
  constructor(scene_cast_members_list) {
    this.cast = scene_cast_members_list;
    this.recent_speaker_history_list = [];
    this.last_attributed_speaker_record = null;
  }

  record_attributed_speaker_turn(attribution_result_object, dialogue_span_object) {
    this.recent_speaker_history_list.push(attribution_result_object.speaker);
    if (this.recent_speaker_history_list.length > 6) {
      this.recent_speaker_history_list.shift();
    }
    this.last_attributed_speaker_record = {
      speaker: attribution_result_object.speaker,
      paraIndex: dialogue_span_object.paraIndex
    };
  }
}

// -------------------------------------------------------------------------
// DETERMINISTIC HEURISTIC RULES (FAST & CHEAP)
// -------------------------------------------------------------------------

// WHAT: Checking if a dialogue span is an ongoing monologue spanning multiple paragraphs.
// WHY: In literary prose, when a character continues speaking in a new paragraph, the previous paragraph
//      omits the closing quotation mark, and the new paragraph begins with an opening quotation mark.
function evaluate_multi_paragraph_monologue_continuation(paragraphs_list, target_paragraph_index) {
  if (target_paragraph_index === 0) {
    return false;
  }
  const preceding_paragraph_string = paragraphs_list[target_paragraph_index - 1];
  const opening_curly_quote_count = (preceding_paragraph_string.match(/“/g) || []).length;
  const closing_curly_quote_count = (preceding_paragraph_string.match(/”/g) || []).length;
  const straight_quote_count = (preceding_paragraph_string.match(/"/g) || []).length;

  const quote_was_left_unclosed = opening_curly_quote_count > closing_curly_quote_count || straight_quote_count % 2 === 1;
  return quote_was_left_unclosed && /^\s*["“]/.test(paragraphs_list[target_paragraph_index]);
}

// WHAT: Evaluating immediate dialogue attribution tags (e.g., "said Maren", "Josh muttered").
// WHY: Direct attribution tags in adjacent prose are authoritative and should not waste classifier inferences.
function evaluate_adjacent_dialogue_tag_rule(paragraph_text_string, dialogue_span_object, scene_cast_members_list, options_configuration) {
  const span_character_range = locate_dialogue_span_character_range(paragraph_text_string, dialogue_span_object);
  if (!span_character_range) {
    return null;
  }
  const masked_prose_paragraph = mask_quoted_dialogue_preserving_character_offsets(paragraph_text_string);
  const tag_search_radius_pixels = options_configuration.character_speech_tag_window_character_count;

  // Prose immediately following the quote up to the first sentence boundary
  const prose_after_quote = masked_prose_paragraph
    .slice(span_character_range.end, span_character_range.end + tag_search_radius_pixels)
    .split(/[.!?]/)[0];

  // Prose immediately preceding the quote back to the prior sentence boundary
  const prose_before_quote = masked_prose_paragraph
    .slice(Math.max(0, span_character_range.start - tag_search_radius_pixels), span_character_range.start)
    .split(/[.!?]/)
    .pop();

  const matching_character_hits_set = new Set();
  for (let character_counter = 0; character_counter < scene_cast_members_list.length; character_counter++) {
    const single_character_profile = scene_cast_members_list[character_counter];
    const character_name_pattern_source = compile_character_name_regex_source(single_character_profile);

    // Matches "[Name] [said/asked]" or "[said/asked] [Name]"
    const tag_detection_regex = new RegExp(
      `(?:${character_name_pattern_source})\\W+(?:\\w+ly\\s+)?(?:${COMPILED_SPEECH_VERBS_REGEX_SOURCE})\\b|\\b(?:${COMPILED_SPEECH_VERBS_REGEX_SOURCE})\\W+(?:${character_name_pattern_source})\\b`,
      "i"
    );

    if (tag_detection_regex.test(prose_after_quote) || tag_detection_regex.test(prose_before_quote)) {
      matching_character_hits_set.add(single_character_profile.id);
    }
  }

  // Exactly one character identified in the tag
  return matching_character_hits_set.size === 1 ? [...matching_character_hits_set][0] : null;
}

// WHAT: Detecting vocative direct address inside the spoken line (e.g., "Josh, sit down").
// WHY: When a character's name is spoken inside dialogue, they are almost certainly the LISTENER, not the speaker.
function identify_vocative_listener_character_ids(dialogue_line_text_string, scene_cast_members_list) {
  const detected_vocative_character_ids_set = new Set();
  for (let character_counter = 0; character_counter < scene_cast_members_list.length; character_counter++) {
    const single_character_profile = scene_cast_members_list[character_counter];
    const character_name_pattern_source = compile_character_name_regex_source(single_character_profile);

    // Vocative at opening ("Josh, ...") or at close ("..., Josh.")
    const vocative_address_regex = new RegExp(
      `^\\s*(?:${character_name_pattern_source})\\s*[,!:]|,\\s*(?:${character_name_pattern_source})\\s*[.!?]*\\s*$`,
      "i"
    );

    if (vocative_address_regex.test(dialogue_line_text_string)) {
      detected_vocative_character_ids_set.add(single_character_profile.id);
    }
  }
  return detected_vocative_character_ids_set;
}

// WHAT: Evaluating two-person conversational turn-taking alternation (A -> B -> A -> B).
// WHY: Rapid exchanges across paragraph breaks reliably flip back and forth between two active participants.
function calculate_conversational_alternation_hint(conversational_state_tracker, scene_cast_members_list, is_new_paragraph_flag) {
  if (!is_new_paragraph_flag || conversational_state_tracker.recent_speaker_history_list.length < 2) {
    return null;
  }
  const speaker_history = conversational_state_tracker.recent_speaker_history_list;
  const previous_speaker_turn_a = speaker_history[speaker_history.length - 2];
  const previous_speaker_turn_b = speaker_history[speaker_history.length - 1];

  if (
    previous_speaker_turn_a === previous_speaker_turn_b ||
    previous_speaker_turn_a === UNKNOWN_SPEAKER_IDENTIFIER ||
    previous_speaker_turn_b === UNKNOWN_SPEAKER_IDENTIFIER
  ) {
    return null;
  }

  // If previous turn A is still present in this scene, predict A will speak again
  const is_speaker_a_present = scene_cast_members_list.some((character_item) => character_item.id === previous_speaker_turn_a);
  return is_speaker_a_present ? previous_speaker_turn_a : null;
}

// -------------------------------------------------------------------------
// CLASSIFIER QUIZ QUESTION BUILDER & OPTION SHUFFLING
// -------------------------------------------------------------------------

// WHAT: Constructing a structured question block for classifiers and LLM decision engines.
// WHY: Provides surrounding narrative context with target line delimiters, constraining choices to scene cast + unknown.
function construct_speaker_attribution_question_payload({
  paragraphs_list,
  dialogue_span_object,
  scene_boundary_object,
  scene_cast_members_list,
  options_configuration
}) {
  const start_paragraph_context_index = Math.max(
    scene_boundary_object.start,
    dialogue_span_object.paraIndex - options_configuration.paragraphs_of_context_before_target
  );
  const end_paragraph_context_index = Math.min(
    scene_boundary_object.end,
    dialogue_span_object.paraIndex + options_configuration.paragraphs_of_context_after_target + 1
  );

  const context_lines_list = [];
  for (let paragraph_indexer = start_paragraph_context_index; paragraph_indexer < end_paragraph_context_index; paragraph_indexer++) {
    if (paragraph_indexer === dialogue_span_object.paraIndex) {
      context_lines_list.push(mark_target_dialogue_span_with_delimiters(paragraphs_list[paragraph_indexer], dialogue_span_object));
    } else {
      context_lines_list.push(paragraphs_list[paragraph_indexer]);
    }
  }

  return {
    context: context_lines_list.join("\n\n"),
    question: `Which character speaks the line marked [[LINE ${dialogue_span_object.id}]]?`,
    options: [
      ...scene_cast_members_list.map((single_character_profile) => ({
        id: single_character_profile.id,
        label: single_character_profile.name
      })),
      { id: UNKNOWN_SPEAKER_IDENTIFIER, label: "Cannot tell from the text" }
    ]
  };
}

// WHAT: Normalizing raw classifier scores to a proper probability distribution summing to 1.0.
// WHY: Standardizes score outputs across different classification architectures (e.g. ModernBERT logits vs CLM softmax).
function normalize_candidate_score_distribution(raw_candidate_scores_map, candidate_options_list) {
  const normalized_distribution_map = {};
  let total_score_sum = 0;

  for (let option_counter = 0; option_counter < candidate_options_list.length; option_counter++) {
    const single_option = candidate_options_list[option_counter];
    const extracted_score_value = Math.max(0, Number(raw_candidate_scores_map && raw_candidate_scores_map[single_option.id]) || 0);
    normalized_distribution_map[single_option.id] = extracted_score_value;
    total_score_sum += extracted_score_value;
  }

  for (let option_counter = 0; option_counter < candidate_options_list.length; option_counter++) {
    const single_option = candidate_options_list[option_counter];
    normalized_distribution_map[single_option.id] = total_score_sum === 0
      ? 1 / candidate_options_list.length
      : normalized_distribution_map[single_option.id] / total_score_sum;
  }

  return normalized_distribution_map;
}

// WHAT: Sorting candidate options by their assigned probability score descending.
// WHY: Isolates the top contender and runner-up to evaluate the margin of victory.
function rank_candidate_options_by_score(candidate_scores_map) {
  return Object.entries(candidate_scores_map)
    .map(([candidate_id, candidate_score]) => ({ id: candidate_id, score: candidate_score }))
    .sort((first_candidate, second_candidate) => second_candidate.score - first_candidate.score);
}

// WHAT: Querying an adapter twice with the options order reversed to neutralize position bias.
// WHY: Language models and classifiers exhibit strong primacy bias (favoring the first choice).
//      Flipping option order ensures only predictions that win in both orderings are accepted.
async function query_adapter_with_position_bias_mitigation(classification_adapter_instance, question_payload_object) {
  const option_orderings_list = [
    question_payload_object.options,
    [...question_payload_object.options].reverse()
  ];
  const normalized_run_results_list = [];

  for (let run_counter = 0; run_counter < option_orderings_list.length; run_counter++) {
    const ordered_candidate_options = option_orderings_list[run_counter];
    const adapter_response_payload = await classification_adapter_instance.choose({
      context: question_payload_object.context,
      question: question_payload_object.question,
      options: ordered_candidate_options
    });
    normalized_run_results_list.push(
      normalize_candidate_score_distribution(adapter_response_payload && adapter_response_payload.scores, question_payload_object.options)
    );
  }

  const averaged_candidate_scores_map = {};
  for (let option_counter = 0; option_counter < question_payload_object.options.length; option_counter++) {
    const single_option = question_payload_object.options[option_counter];
    const total_sum_across_runs = normalized_run_results_list.reduce(
      (running_sum, current_run_scores) => running_sum + current_run_scores[single_option.id],
      0
    );
    averaged_candidate_scores_map[single_option.id] = total_sum_across_runs / normalized_run_results_list.length;
  }

  const top_picks_across_runs = normalized_run_results_list.map((run_scores) => rank_candidate_options_by_score(run_scores)[0].id);
  const is_prediction_stable_across_orderings = top_picks_across_runs.every((top_pick) => top_pick === top_picks_across_runs[0]);

  return {
    name: classification_adapter_instance.name,
    scores: averaged_candidate_scores_map,
    top: rank_candidate_options_by_score(averaged_candidate_scores_map)[0].id,
    stable: is_prediction_stable_across_orderings
  };
}

// WHAT: Generating deterministic SHA-1 hash key for caching question queries.
// WHY: Prevents duplicate LLM or classifier executions when re-processing unmodified text sections.
function compute_cache_hash_key(question_payload_object, active_adapters_list) {
  return crypto_library
    .createHash("sha1")
    .update(
      JSON.stringify([
        question_payload_object.context,
        question_payload_object.question,
        question_payload_object.options.map((option_item) => option_item.id),
        active_adapters_list.map((adapter_item) => adapter_item.name)
      ])
    )
    .digest("hex");
}

// -------------------------------------------------------------------------
// RESULT CONSTRUCTOR & SINGLE SPAN ATTRIBUTION PIPELINE
// -------------------------------------------------------------------------

// WHAT: Constructing standard attribution result structure with evidence and listener tracking.
// WHY: Consistent return format guarantees UI cards and review queues have all required diagnostic fields.
function build_attribution_result_object(dialogue_span_object, resolved_speaker_id, supplementary_metadata, conversational_state_tracker) {
  const resolved_listener_id = [...conversational_state_tracker.recent_speaker_history_list]
    .reverse()
    .find((historical_speaker) => historical_speaker !== resolved_speaker_id && historical_speaker !== UNKNOWN_SPEAKER_IDENTIFIER);

  return {
    id: dialogue_span_object.id,
    speaker: resolved_speaker_id,
    listener: resolved_listener_id ? [resolved_listener_id] : [],
    candidates: [],
    evidence: "unknown",
    models: {},
    confidence: 0,
    needs_review: false,
    ...supplementary_metadata
  };
}

// WHAT: Executing the attribution pipeline for a single dialogue span.
// WHY: Cascades through cheap rules, multi-model classifiers, soft heuristics, and optional LLM escalation.
async function resolve_attribution_for_single_dialogue_span({
  paragraphs_list,
  dialogue_span_object,
  scene_boundary_object,
  conversational_state_tracker,
  active_adapters_list,
  optional_llm_fallback_handler,
  execution_cache_map,
  options_configuration
}) {
  const scene_cast_members_list = conversational_state_tracker.cast;
  const current_paragraph_text_string = paragraphs_list[dialogue_span_object.paraIndex];
  const is_new_paragraph_flag =
    !conversational_state_tracker.last_attributed_speaker_record ||
    conversational_state_tracker.last_attributed_speaker_record.paraIndex !== dialogue_span_object.paraIndex;

  // -----------------------------------------------------------------------
  // STEP 1A: Monologue continuation rule
  // -----------------------------------------------------------------------
  if (
    is_new_paragraph_flag &&
    conversational_state_tracker.last_attributed_speaker_record &&
    conversational_state_tracker.last_attributed_speaker_record.paraIndex === dialogue_span_object.paraIndex - 1 &&
    conversational_state_tracker.last_attributed_speaker_record.speaker !== UNKNOWN_SPEAKER_IDENTIFIER &&
    evaluate_multi_paragraph_monologue_continuation(paragraphs_list, dialogue_span_object.paraIndex)
  ) {
    return build_attribution_result_object(
      dialogue_span_object,
      conversational_state_tracker.last_attributed_speaker_record.speaker,
      { evidence: "continuation", confidence: 0.95 },
      conversational_state_tracker
    );
  }

  // -----------------------------------------------------------------------
  // STEP 1B: Adjacent dialogue tag rule
  // -----------------------------------------------------------------------
  const tagged_character_speaker_id = evaluate_adjacent_dialogue_tag_rule(
    current_paragraph_text_string,
    dialogue_span_object,
    scene_cast_members_list,
    options_configuration
  );
  if (tagged_character_speaker_id) {
    return build_attribution_result_object(
      dialogue_span_object,
      tagged_character_speaker_id,
      { evidence: "tag", confidence: 0.95 },
      conversational_state_tracker
    );
  }

  // -----------------------------------------------------------------------
  // STEP 2: Multi-model classifier quiz with position-bias cancellation
  // -----------------------------------------------------------------------
  const question_payload = construct_speaker_attribution_question_payload({
    paragraphs_list,
    dialogue_span_object,
    scene_boundary_object,
    scene_cast_members_list,
    options_configuration
  });

  const cache_lookup_key = compute_cache_hash_key(question_payload, active_adapters_list);
  let per_adapter_evaluation_results_list = execution_cache_map.get(cache_lookup_key);

  if (!per_adapter_evaluation_results_list) {
    per_adapter_evaluation_results_list = [];
    for (let adapter_counter = 0; adapter_counter < active_adapters_list.length; adapter_counter++) {
      const single_adapter = active_adapters_list[adapter_counter];
      try {
        const adapter_result = await query_adapter_with_position_bias_mitigation(single_adapter, question_payload);
        per_adapter_evaluation_results_list.push(adapter_result);
      } catch (adapter_execution_error) {
        console.warn(`[attribution] ${single_adapter.name} failed on span ${dialogue_span_object.id}: ${adapter_execution_error.message}`);
      }
    }
    if (per_adapter_evaluation_results_list.length > 0) {
      execution_cache_map.set(cache_lookup_key, per_adapter_evaluation_results_list);
    }
  }

  // If all classifiers failed, escalate directly to review queue without defaulting to narrator
  if (!per_adapter_evaluation_results_list || per_adapter_evaluation_results_list.length === 0) {
    return build_attribution_result_object(
      dialogue_span_object,
      UNKNOWN_SPEAKER_IDENTIFIER,
      { evidence: "error", needs_review: true },
      conversational_state_tracker
    );
  }

  // -----------------------------------------------------------------------
  // STEP 3: Soft heuristic adjustments (vocative penalty, alternation bonus)
  // -----------------------------------------------------------------------
  const merged_score_distribution_map = {};
  for (let option_counter = 0; option_counter < question_payload.options.length; option_counter++) {
    const single_option = question_payload.options[option_counter];
    const total_sum_across_adapters = per_adapter_evaluation_results_list.reduce(
      (running_total, single_adapter_result) => running_total + single_adapter_result.scores[single_option.id],
      0
    );
    merged_score_distribution_map[single_option.id] = total_sum_across_adapters / per_adapter_evaluation_results_list.length;
  }

  // Vocative penalty: if a character name was directly addressed, they are likely the listener
  const vocative_character_ids = identify_vocative_listener_character_ids(dialogue_span_object.text, scene_cast_members_list);
  vocative_character_ids.forEach((vocative_character_id) => {
    merged_score_distribution_map[vocative_character_id] = Math.max(
      0,
      merged_score_distribution_map[vocative_character_id] - options_configuration.vocative_listener_penalty_scalar
    );
  });

  // Alternation bonus: in A/B conversational exchanges, nudge the expected turn taker
  const alternation_hint_candidate_id = calculate_conversational_alternation_hint(
    conversational_state_tracker,
    scene_cast_members_list,
    is_new_paragraph_flag
  );
  if (alternation_hint_candidate_id && merged_score_distribution_map[alternation_hint_candidate_id] !== undefined) {
    merged_score_distribution_map[alternation_hint_candidate_id] += options_configuration.alternation_turn_taking_bonus_scalar;
  }

  const final_normalized_scores_map = normalize_candidate_score_distribution(
    merged_score_distribution_map,
    question_payload.options
  );

  const ranked_candidates_list = rank_candidate_options_by_score(final_normalized_scores_map);
  const [first_place_candidate, second_place_candidate] = ranked_candidates_list;
  const score_margin_gap_value = first_place_candidate.score - (second_place_candidate ? second_place_candidate.score : 0);

  const do_all_models_agree_on_first_pick = per_adapter_evaluation_results_list.every(
    (single_adapter_eval) => single_adapter_eval.top === per_adapter_evaluation_results_list[0].top
  );
  const are_all_models_stable = per_adapter_evaluation_results_list.every((single_adapter_eval) => single_adapter_eval.stable);

  const model_individual_predictions_map = Object.fromEntries(
    per_adapter_evaluation_results_list.map((single_adapter_eval) => [single_adapter_eval.name, single_adapter_eval.top])
  );
  const formatted_candidate_scores_list = ranked_candidates_list.slice(0, 3).map((candidate_entry) => ({
    id: candidate_entry.id,
    score: Number(candidate_entry.score.toFixed(3))
  }));

  const is_clean_auto_accept =
    do_all_models_agree_on_first_pick &&
    are_all_models_stable &&
    first_place_candidate.id !== UNKNOWN_SPEAKER_IDENTIFIER &&
    first_place_candidate.score >= options_configuration.minimum_score_threshold_for_auto_accept &&
    score_margin_gap_value >= options_configuration.minimum_runner_up_gap_for_auto_accept;

  if (is_clean_auto_accept) {
    return build_attribution_result_object(
      dialogue_span_object,
      first_place_candidate.id,
      {
        evidence: per_adapter_evaluation_results_list.length > 1 ? "classifier_agree" : "classifier",
        candidates: formatted_candidate_scores_list,
        models: model_individual_predictions_map,
        confidence: Number(first_place_candidate.score.toFixed(3)),
        needs_review: false
      },
      conversational_state_tracker
    );
  }

  // -----------------------------------------------------------------------
  // STEP 4: Escalation to constrained LLM fallback
  // -----------------------------------------------------------------------
  if (typeof optional_llm_fallback_handler === "function") {
    try {
      const top_candidate_choices_list = ranked_candidates_list.slice(0, 3).map((candidate_entry) => candidate_entry.id);
      if (!top_candidate_choices_list.includes(UNKNOWN_SPEAKER_IDENTIFIER)) {
        top_candidate_choices_list.push(UNKNOWN_SPEAKER_IDENTIFIER);
      }

      const llm_selected_speaker_id = await optional_llm_fallback_handler({
        context: question_payload.context,
        question: question_payload.question,
        choices: top_candidate_choices_list,
        candidates: formatted_candidate_scores_list
      });

      if (llm_selected_speaker_id && top_candidate_choices_list.includes(llm_selected_speaker_id)) {
        return build_attribution_result_object(
          dialogue_span_object,
          llm_selected_speaker_id,
          {
            evidence: "llm",
            candidates: formatted_candidate_scores_list,
            models: model_individual_predictions_map,
            confidence: Number(first_place_candidate.score.toFixed(3)),
            needs_review: true
          },
          conversational_state_tracker
        );
      }
    } catch (llm_fallback_error) {
      console.warn(`[attribution] LLM fallback failed on span ${dialogue_span_object.id}: ${llm_fallback_error.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // STEP 5: Uncertain fallback to review queue
  // -----------------------------------------------------------------------
  const fallback_best_guess_speaker_id =
    first_place_candidate.id !== UNKNOWN_SPEAKER_IDENTIFIER &&
    first_place_candidate.score >= options_configuration.minimum_score_cutoff_before_unknown
      ? first_place_candidate.id
      : UNKNOWN_SPEAKER_IDENTIFIER;

  return build_attribution_result_object(
    dialogue_span_object,
    fallback_best_guess_speaker_id,
    {
      evidence: "classifier_uncertain",
      candidates: formatted_candidate_scores_list,
      models: model_individual_predictions_map,
      confidence: Number(first_place_candidate.score.toFixed(3)),
      needs_review: true
    },
    conversational_state_tracker
  );
}

// -------------------------------------------------------------------------
// PUBLIC MAIN FUNCTION: ATTRIBUTE SPEAKERS ACROSS CHAPTER
// -------------------------------------------------------------------------

// WHAT: Main execution coordinator iterating across all dialogue spans sequentially.
// WHY: Preserves narrative order so conversational state and turn-taking hints carry forward accurately.
//      Integrates existing reference segments to respect user-locked lines and generate non-destructive diffs.
async function attributeSpeakersAcrossParagraphs({
  paragraphs_list,
  dialogue_spans_list,
  global_characters_list,
  classification_adapters_list,
  optional_llm_fallback_handler = null,
  execution_cache_map = new Map(),
  custom_configuration_options = {},
  progress_update_callback_function = null,
  existing_reference_segments = []
}) {
  const merged_configuration_options = {
    ...DEFAULT_ATTRIBUTION_CONFIGURATION_OPTIONS,
    ...custom_configuration_options
  };

  const detected_scene_boundaries_list = split_paragraphs_into_scene_boundaries(paragraphs_list);
  const results_mapped_by_span_id = new Map();
  let completed_spans_counter = 0;

  for (let scene_counter = 0; scene_counter < detected_scene_boundaries_list.length; scene_counter++) {
    const single_scene_boundary = detected_scene_boundaries_list[scene_counter];
    const spans_in_current_scene = dialogue_spans_list.filter(
      (single_span) => single_span.paraIndex >= single_scene_boundary.start && single_span.paraIndex < single_scene_boundary.end
    );

    if (spans_in_current_scene.length === 0) {
      continue;
    }

    const scene_cast_members = detect_active_scene_cast_members(paragraphs_list, single_scene_boundary, global_characters_list);
    const conversational_state_tracker = new ActiveSceneConversationalState(scene_cast_members);

    for (let span_counter = 0; span_counter < spans_in_current_scene.length; span_counter++) {
      const active_dialogue_span = spans_in_current_scene[span_counter];

      // WHAT: Correlating dialogue span with existing reference segments to detect user locks or diff baselines.
      // WHY: Preserves manual user edits as immutable ground truth and enables comparison against previous AI takes.
      const matching_reference_segment = existing_reference_segments.find((candidate_segment) => {
        if (candidate_segment.id && candidate_segment.id === active_dialogue_span.id) {
          return true;
        }
        if (typeof candidate_segment.text === "string" && typeof active_dialogue_span.text === "string") {
          return candidate_segment.text.trim() === active_dialogue_span.text.trim();
        }
        return false;
      });

      let single_span_attribution_result = null;

      // WHAT: Enforcing user-locked speaker protection.
      // WHY: If a user manually assigned a character voice, that choice must NEVER be overwritten by an AI pass.
      if (matching_reference_segment && matching_reference_segment.is_user_locked && matching_reference_segment.speaker) {
        single_span_attribution_result = build_attribution_result_object(
          active_dialogue_span,
          matching_reference_segment.speaker,
          {
            evidence: "user_locked",
            confidence: 1.0,
            is_user_locked: true,
            needs_review: false
          },
          conversational_state_tracker
        );
      } else {
        single_span_attribution_result = await resolve_attribution_for_single_dialogue_span({
          paragraphs_list,
          dialogue_span_object: active_dialogue_span,
          scene_boundary_object: single_scene_boundary,
          conversational_state_tracker,
          active_adapters_list: classification_adapters_list,
          optional_llm_fallback_handler,
          execution_cache_map,
          options_configuration: merged_configuration_options
        });

        // WHAT: Attaching proposed diff when predicted speaker diverges from existing reference baseline.
        // WHY: Allows non-destructive review in Script Editor without silently clobbering existing assignments.
        if (
          matching_reference_segment &&
          matching_reference_segment.speaker &&
          matching_reference_segment.speaker !== UNKNOWN_SPEAKER_IDENTIFIER &&
          matching_reference_segment.speaker !== single_span_attribution_result.speaker
        ) {
          single_span_attribution_result.proposed_diff = {
            previous_speaker: matching_reference_segment.speaker,
            proposed_speaker: single_span_attribution_result.speaker,
            confidence: single_span_attribution_result.confidence,
            evidence: single_span_attribution_result.evidence,
            models: single_span_attribution_result.models || {}
          };
          single_span_attribution_result.needs_review = true;
        }
      }

      conversational_state_tracker.record_attributed_speaker_turn(single_span_attribution_result, active_dialogue_span);
      results_mapped_by_span_id.set(active_dialogue_span.id, single_span_attribution_result);

      completed_spans_counter++;
      if (typeof progress_update_callback_function === "function") {
        progress_update_callback_function(completed_spans_counter, dialogue_spans_list.length, single_span_attribution_result);
      }
    }
  }

  return dialogue_spans_list.map((single_span) => results_mapped_by_span_id.get(single_span.id));
}

// WHAT: Filtering and sorting lines flagged for review by uncertainty (lowest confidence first).
// WHY: Allows the user to inspect the shakiest attributions first in the Script Editor UI.
function extract_sorted_review_queue_from_results(attribution_results_list) {
  return attribution_results_list
    .filter((single_result) => single_result && single_result.needs_review)
    .sort((first_result, second_result) => first_result.confidence - second_result.confidence);
}

module.exports = {
  attributeSpeakersAcrossParagraphs,
  extract_sorted_review_queue_from_results,
  split_paragraphs_into_scene_boundaries,
  detect_active_scene_cast_members,
  construct_speaker_attribution_question_payload,
  evaluate_adjacent_dialogue_tag_rule,
  evaluate_multi_paragraph_monologue_continuation,
  identify_vocative_listener_character_ids,
  calculate_conversational_alternation_hint,
  UNKNOWN_SPEAKER_IDENTIFIER
};

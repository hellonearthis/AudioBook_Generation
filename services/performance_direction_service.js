// =========================================================================
// PURE FUNCTIONAL PERFORMANCE DIRECTION & SUBTEXT STAGING SERVICE
// =========================================================================
// WHAT: Models subtext (surface displayed emotion vs underlying felt emotion),
//       conversational timing (dramatic pauses, trailing beats, interruptions),
//       acoustic proximity (intimate, conversational, projected), word emphasis,
//       physical states, and human director notes.
// WHY: In audiobook acting, the emotional tension lives underneath and between lines.
//      Separating surface reading from internal subtext, and timing pauses based on
//      dramatic beats rather than flat millisecond delays, turns flat speech into
//      a nuanced theatrical performance.

const {
  resolve_emotional_intensity_band,
  map_intensity_value_to_band_number
} = require("./emotional_arc_service");

/**
 * WHAT: Standard acoustic distance classifications.
 * WHY: Modulates vocal projection, resonance, and breathiness for intimacy or shouts.
 */
const ACOUSTIC_DISTANCE_LEVELS = {
  INTIMATE: "intimate",
  CONVERSATIONAL: "conversational",
  PROJECTED: "projected"
};

/**
 * WHAT: Generates an immutable, fully populated performance direction record.
 * 
 * @param {Readonly<Object>} raw_parameters 
 * @returns {Readonly<Object>} Standardized performance direction record.
 */
function create_dialogue_performance_direction(raw_parameters = {}) {
  const speaking_character = (raw_parameters.speakingCharacterIdentifier || raw_parameters.speaker || "narrator").trim();
  const addressee_character = raw_parameters.addresseeCharacterIdentifier || raw_parameters.addressee || null;
  const distance = raw_parameters.distanceBetweenSpeakerAndListener || raw_parameters.distance || ACOUSTIC_DISTANCE_LEVELS.CONVERSATIONAL;

  // Handle displayed (surface) emotion
  const raw_displayed = raw_parameters.displayedEmotion || {};
  const displayed_emotion_name = (raw_displayed.emotion || raw_parameters.emotion || "neutral").trim().toLowerCase();
  const displayed_band = typeof raw_displayed.intensityBand === "number"
    ? raw_displayed.intensityBand
    : map_intensity_value_to_band_number(raw_parameters.intensity ?? 0.2);

  // Handle felt (underlying) emotion
  const raw_felt = raw_parameters.feltEmotion || {};
  const felt_emotion_name = (raw_felt.emotion || displayed_emotion_name).trim().toLowerCase();
  const felt_band = typeof raw_felt.intensityBand === "number"
    ? raw_felt.intensityBand
    : (typeof raw_parameters.felt_intensity === "number" ? map_intensity_value_to_band_number(raw_parameters.felt_intensity) : displayed_band);

  const expression_mode = raw_parameters.expressionMode || raw_parameters.expression || "balanced";

  const physical_state_tags = Array.isArray(raw_parameters.physicalStateTags)
    ? [...raw_parameters.physicalStateTags]
    : (Array.isArray(raw_parameters.physical_state) ? [...raw_parameters.physical_state] : []);

  const emphasized_words_in_line = Array.isArray(raw_parameters.emphasizedWordsInLine)
    ? [...raw_parameters.emphasizedWordsInLine]
    : (Array.isArray(raw_parameters.emphasis) ? [...raw_parameters.emphasis] : []);

  return {
    speakingCharacterIdentifier: speaking_character,
    addresseeCharacterIdentifier: addressee_character ? addressee_character.trim() : null,
    distanceBetweenSpeakerAndListener: distance,
    displayedEmotion: {
      emotion: displayed_emotion_name,
      intensityBand: displayed_band
    },
    feltEmotion: {
      emotion: felt_emotion_name,
      intensityBand: felt_band
    },
    expressionMode: expression_mode,
    physicalStateTags: Object.freeze(physical_state_tags),
    emphasizedWordsInLine: Object.freeze(emphasized_words_in_line),
    secondsOfSilenceBeforeLine: typeof raw_parameters.secondsOfSilenceBeforeLine === "number"
      ? raw_parameters.secondsOfSilenceBeforeLine
      : null,
    secondsOfSilenceAfterLine: typeof raw_parameters.secondsOfSilenceAfterLine === "number"
      ? raw_parameters.secondsOfSilenceAfterLine
      : null,
    lineIsInterruptedByNextSpeaker: Boolean(raw_parameters.lineIsInterruptedByNextSpeaker || raw_parameters.is_interrupted),
    directorNoteFromHuman: raw_parameters.directorNoteFromHuman || raw_parameters.director_note || null
  };
}

/**
 * WHAT: Compiles an advanced natural language secondary prompt for AuK/Qwen3 Instruct-TTS.
 * WHY: Translates multi-layered performance metadata (surface vs subtext, distance, emphasis,
 *      physical states, and human director notes) into an explicit vocal acting instruction.
 *      Enforces human override precedence and prevents prompt clause bloat.
 * 
 * @param {Readonly<Object>} performance_record 
 * @param {string} dialogue_text 
 * @param {Readonly<{ resolve_human_override?: boolean, compact_mode?: boolean }>} [options]
 * @returns {string} Compiled instruction prompt string.
 */
function compile_advanced_auk_performance_instruction(performance_record, dialogue_text, options = {}) {
  const { resolve_human_override = false } = options;
  const record = create_dialogue_performance_direction(performance_record);
  const prompt_clauses = [];

  // WHAT: Human Director's Note has primary precedence.
  // WHY: If the human director specifically requests a delivery (e.g. "quieter, holding back tears"),
  //      it overrides conflicting automated staging tags when resolve_human_override is true.
  const has_human_override = Boolean(record.directorNoteFromHuman && record.directorNoteFromHuman.trim().length > 0);

  // 1. Addressee and Distance
  if (record.addresseeCharacterIdentifier) {
    if (record.distanceBetweenSpeakerAndListener === ACOUSTIC_DISTANCE_LEVELS.INTIMATE) {
      prompt_clauses.push(`Speaking directly to ${record.addresseeCharacterIdentifier} in close, intimate proximity`);
    } else if (record.distanceBetweenSpeakerAndListener === ACOUSTIC_DISTANCE_LEVELS.PROJECTED) {
      prompt_clauses.push(`Projecting voice across distance to ${record.addresseeCharacterIdentifier}`);
    } else {
      prompt_clauses.push(`Speaking to ${record.addresseeCharacterIdentifier}`);
    }
  } else if (record.distanceBetweenSpeakerAndListener === ACOUSTIC_DISTANCE_LEVELS.INTIMATE) {
    prompt_clauses.push("Close, intimate vocal delivery");
  } else if (record.distanceBetweenSpeakerAndListener === ACOUSTIC_DISTANCE_LEVELS.PROJECTED) {
    prompt_clauses.push("Projected voice, addressing the entire room");
  }

  // 2. Emotion and Subtext (Displayed vs Felt)
  if (!resolve_human_override || !has_human_override) {
    const displayed_info = resolve_emotional_intensity_band(
      record.displayedEmotion.emotion,
      (record.displayedEmotion.intensityBand - 0.5) / 5.0
    );

    const has_subtext_discrepancy = (record.displayedEmotion.emotion !== record.feltEmotion.emotion) ||
                                    (record.displayedEmotion.intensityBand !== record.feltEmotion.intensityBand);

    if (has_subtext_discrepancy) {
      const felt_info = resolve_emotional_intensity_band(
        record.feltEmotion.emotion,
        (record.feltEmotion.intensityBand - 0.5) / 5.0
      );
      prompt_clauses.push(
        `Surface delivery is ${displayed_info.label} (${displayed_info.description}), with underlying suppressed ${felt_info.label} subtext (${felt_info.description})`
      );
    } else {
      prompt_clauses.push(`Delivery is ${displayed_info.label} (${displayed_info.description})`);
    }

    // 3. Expression Mode
    if (record.expressionMode === "suppressed") {
      prompt_clauses.push("tightly held-back, suppressed cadence");
    } else if (record.expressionMode === "released") {
      prompt_clauses.push("open, uninhibited vocal release");
    }
  }

  // 4. Physical State Modifiers
  if (record.physicalStateTags.length > 0) {
    prompt_clauses.push(`Physical state: ${record.physicalStateTags.join(", ")}`);
  }

  // 5. Word-Level Emphasis
  if (record.emphasizedWordsInLine.length > 0) {
    const quoted_words = record.emphasizedWordsInLine.map(w => `'${w}'`).join(" and ");
    prompt_clauses.push(`emphasizing the word(s) ${quoted_words}`);
  }

  // 6. Human Director's Note Override
  if (has_human_override) {
    prompt_clauses.push(`[Director: ${record.directorNoteFromHuman.trim()}]`);
  }

  const combined_cues = prompt_clauses.join(", ");
  const cleaned_text = (dialogue_text || "").trim();

  return `Say the following with the same voice, ${combined_cues}: '${cleaned_text}'`;
}

/**
 * WHAT: Computes a deterministic pseudo-random jitter offset between -percentage and +percentage.
 * WHY: Prevents metronomic mechanical timing across hundreds of book lines while ensuring
 *      that audio timeline assembly remains 100% deterministic and reproducible across runs.
 * 
 * @param {string|number} seed_key 
 * @param {number} jitter_ratio - Default 0.12 (+/- 12%)
 * @returns {number} Multiplier between (1.0 - jitter_ratio) and (1.0 + jitter_ratio).
 */
function compute_deterministic_timing_jitter(seed_key, jitter_ratio = 0.12) {
  const seed_string = String(seed_key || "default_seed");
  let hash_accum = 0;
  for (let idx = 0; idx < seed_string.length; idx++) {
    hash_accum = ((hash_accum << 5) - hash_accum) + seed_string.charCodeAt(idx);
    hash_accum |= 0;
  }
  // Map hash to 0.0 .. 1.0
  const normalized_hash = Math.abs(hash_accum % 1000) / 1000.0;
  // Map to (-jitter_ratio .. +jitter_ratio)
  const jitter_delta = (normalized_hash * 2.0 - 1.0) * jitter_ratio;
  return Number((1.0 + jitter_delta).toFixed(3));
}

/**
 * WHAT: Analyzes dialogue context to automatically derive dramatic pauses and timing.
 * WHY: Distinguishes true cross-speaker interruptions (which cut in with zero or overlap gap)
 *      from self-interrupted trailing thoughts (which leave a lingering silence).
 *      Applies reproducible timing jitter and scene tempo scaling.
 * 
 * @param {Readonly<Object>} current_segment 
 * @param {Readonly<Object>|null} preceding_segment 
 * @param {Readonly<{ scene_tempo?: "fast" | "normal" | "slow", enable_jitter?: boolean }>} [options]
 * @returns {{ readonly seconds_before: number, readonly seconds_after: number, readonly is_interrupted: boolean, readonly is_cross_speaker_interruption: boolean, readonly overlap_seconds: number }}
 */
function derive_dramatic_pause_timing(current_segment, preceding_segment, options = {}) {
  const current_text = (current_segment.text || current_segment.content || "").trim();
  const preceding_text = preceding_segment ? (preceding_segment.text || preceding_segment.content || "").trim() : "";

  const scene_tempo = options.scene_tempo || current_segment.scene_tempo || "normal";
  const tempo_multiplier = scene_tempo === "fast" ? 0.75 : (scene_tempo === "slow" ? 1.25 : 1.0);
  const jitter_factor = options.enable_jitter !== false
    ? compute_deterministic_timing_jitter(current_segment.line_id || current_segment.id || current_text)
    : 1.0;

  // Regex handles plain --, en-dash –, em-dash —, and ellipsis ... or …
  const dash_pattern = /(?:--|—|–)\s*$/;
  const ellipsis_pattern = /(?:\.\.\.|…)\s*$/;

  const preceding_has_dash = dash_pattern.test(preceding_text);
  const current_has_dash = dash_pattern.test(current_text);

  const prev_speaker = preceding_segment ? (preceding_segment.speaker || preceding_segment.character || "").trim().toLowerCase() : "";
  const curr_speaker = (current_segment.speaker || current_segment.character || "").trim().toLowerCase();
  const is_speaker_switch = Boolean(prev_speaker && curr_speaker && prev_speaker !== curr_speaker);

  // WHAT: Distinguish Cross-Speaker Interruption from Self-Interruption / Trailing Thought
  // WHY: If Marcus is cut off by Elena, Elena cuts in immediately (overlap).
  //      If Marcus trails off on his own dash, he leaves an awkward hesitation beat.
  const is_cross_speaker_interruption = preceding_has_dash && is_speaker_switch;
  const is_self_interruption = preceding_has_dash && !is_speaker_switch;

  let base_seconds_before = 0.45;
  let base_seconds_after = 0.45;
  let overlap_seconds = 0.0;

  if (is_cross_speaker_interruption) {
    // Sharp cross-speaker interruption cut
    base_seconds_before = 0.0;
    overlap_seconds = -0.15; // 150ms overlap into cut-off speaker
  } else if (is_self_interruption) {
    // Speaker trails off on their own thought
    base_seconds_before = 0.75;
  } else if (current_segment.feltEmotion && current_segment.displayedEmotion) {
    // High subtext tension creates a pregnant hesitation before speaking
    const tension_gap = Math.abs(current_segment.feltEmotion.intensityBand - current_segment.displayedEmotion.intensityBand);
    if (tension_gap >= 2) {
      base_seconds_before = 0.95;
    }
  }

  // Trailing thought with ellipsis leaves a longer silence
  if (ellipsis_pattern.test(current_text)) {
    base_seconds_after = 0.85;
  }

  const seconds_before = Number((base_seconds_before * tempo_multiplier * (base_seconds_before > 0 ? jitter_factor : 1.0)).toFixed(3));
  const seconds_after = Number((base_seconds_after * tempo_multiplier * jitter_factor).toFixed(3));

  return {
    seconds_before,
    seconds_after,
    is_interrupted: current_has_dash,
    is_cross_speaker_interruption,
    overlap_seconds
  };
}

module.exports = {
  ACOUSTIC_DISTANCE_LEVELS,
  create_dialogue_performance_direction,
  compile_advanced_auk_performance_instruction,
  compute_deterministic_timing_jitter,
  derive_dramatic_pause_timing
};


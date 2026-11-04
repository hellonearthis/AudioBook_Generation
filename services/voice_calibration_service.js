// =========================================================================
// PURE FUNCTIONAL CHARACTER VOICE CALIBRATION & CAPABILITY PROFILING SERVICE
// =========================================================================
// WHAT: Auditions a character's neutral voice clone across emotion x intensity bands,
//       measuring empirical vocal capability, identity similarity limits, and capping
//       downstream staging requests to what the voice can actually achieve cleanly.
// WHY: Voices vary drastically—some clones maintain identity at extreme rage, while others
//      distort at moderate anger. Profiling empirical limits upfront prevents discovering
//      broken, robotic timbre mid-chapter during long book renders.

const path_library = require("path");
const filesystem_library = require("fs");

const {
  map_intensity_value_to_band_number,
  resolve_emotional_intensity_band,
  get_calibrated_drift_threshold
} = require("./emotional_arc_service");

const {
  compute_cosine_similarity,
  verify_cross_character_identity_margin
} = require("./voice_drift_qc_service");

/**
 * WHAT: Standard standardized audition sentences across different lengths and delivery styles.
 * WHY: Fixed text ensures that observed acoustic variations derive purely from delivery
 *      and emotional conditioning rather than phonetic differences.
 */
const CALIBRATION_AUDITION_SENTENCES = {
  short: "We have to leave right now.",
  medium: "The transmission came through the relay, but the coordinates do not make any sense.",
  long: "I spent three years mapping the outer perimeter of the crater, and never once did the perimeter sensors register an anomaly like this.",
  suppressed_tension: "If you ever compromise this crew again, you will answer directly to me.",
  whisper_caution: "Keep your voice down; they are monitoring every frequency on this deck."
};

/**
 * WHAT: Generates a blank, standardized calibration profile schema for a character.
 * 
 * @param {string} character_identifier 
 * @param {string} neutral_reference_clip_path 
 * @param {string} model_version_string 
 * @returns {Readonly<Object>} Initialized calibration profile object.
 */
function initialize_character_calibration_profile(
  character_identifier,
  neutral_reference_clip_path,
  model_version_string = "AuK-08"
) {
  return {
    version: "1.0.0",
    character_identifier: (character_identifier || "character").toLowerCase().replace(/\s+/g, "_"),
    neutral_reference_clip_path: neutral_reference_clip_path || "",
    model_version_used_for_calibration: model_version_string,
    calibrated_at_timestamp: Date.now(),
    calibrated_emotion_bands: {},
    identity_similarity_threshold_by_band: {
      band1: 0.75,
      band2: 0.73,
      band3: 0.70,
      band4: 0.65,
      band5: 0.60
    },
    capped_maximum_band_by_emotion: {},
    acoustic_compensation_rules: {}
  };
}

/**
 * WHAT: Evaluates an individual calibration take against character identity and acoustic targets.
 * WHY: Determines whether this specific emotion and intensity band passed without timbre degradation.
 * 
 * @param {Readonly<{
 *   emotion: string,
 *   band_number: number,
 *   take_embedding_vector: ReadonlyArray<number>,
 *   reference_anchor_vector: ReadonlyArray<number>,
 *   stt_accuracy_percentage?: number,
 *   chars_per_second?: number,
 *   competing_cast_reference_vectors?: Record<string, ReadonlyArray<number>>|ReadonlyArray<{ character_id: string, reference_vector: ReadonlyArray<number> }>,
 *   required_competitor_margin?: number,
 *   render_settings?: Object
 * }>} take_evaluation_payload 
 * @returns {Readonly<Object>} Measured calibration cell record.
 */
function evaluate_calibration_take_cell(take_evaluation_payload) {
  const {
    emotion,
    band_number,
    take_embedding_vector,
    reference_anchor_vector,
    stt_accuracy_percentage = 95.0,
    chars_per_second = 14.5,
    competing_cast_reference_vectors = null,
    required_competitor_margin = 0.05,
    render_settings = {}
  } = take_evaluation_payload;

  const identity_similarity_score = compute_cosine_similarity(
    take_embedding_vector || [],
    reference_anchor_vector || []
  );

  const calibrated_band_threshold = get_calibrated_drift_threshold(band_number);
  const identity_passed = identity_similarity_score >= calibrated_band_threshold;
  const stt_passed = stt_accuracy_percentage >= 85.0;
  const pacing_passed = chars_per_second >= 7.5 && chars_per_second <= 26.0;

  // WHAT: Optional cross-character identity margin check.
  // WHY: Ensures the take is closer to its intended character than to any other cast member.
  let cross_character_result = null;
  let cross_margin_passed = true;
  if (competing_cast_reference_vectors && take_embedding_vector && reference_anchor_vector) {
    cross_character_result = verify_cross_character_identity_margin(
      take_embedding_vector,
      reference_anchor_vector,
      competing_cast_reference_vectors,
      required_competitor_margin
    );
    cross_margin_passed = cross_character_result.passed;
  }

  const passed = identity_passed && stt_passed && pacing_passed && cross_margin_passed;
  const failure_reasons = [];

  if (!identity_passed) {
    failure_reasons.push(`Timbre similarity ${identity_similarity_score} fell below band threshold ${calibrated_band_threshold}`);
  }
  if (!stt_passed) {
    failure_reasons.push(`STT accuracy ${stt_accuracy_percentage}% fell below 85% requirement`);
  }
  if (!pacing_passed) {
    failure_reasons.push(`Pacing anomaly (${chars_per_second} chars/sec)`);
  }
  if (!cross_margin_passed && cross_character_result && cross_character_result.warning_message) {
    failure_reasons.push(cross_character_result.warning_message);
  }

  const band_descriptor = resolve_emotional_intensity_band(emotion, (band_number - 0.5) / 5.0);

  return {
    emotion,
    band: band_number,
    band_label: band_descriptor.label,
    identity_similarity_score,
    calibrated_band_threshold,
    cross_character_result,
    stt_accuracy_percentage,
    chars_per_second,
    passed,
    failure_reasons,
    render_settings
  };
}

/**
 * WHAT: Derives maximum usable intensity band caps for each emotion from calibration grid results.
 * WHY: If Band 4 furious fails the identity threshold, caps the voice at Band 3 to prevent
 *      the staging and queue engines from requesting broken vocal distortion.
 * 
 * @param {Readonly<Record<string, Record<string, Object>>>} calibrated_emotion_grid 
 * @returns {Readonly<{
 *   capped_maximum_band_by_emotion: Record<string, number>,
 *   identity_similarity_threshold_by_band: Record<string, number>
 * }>}
 */
function derive_character_capability_caps(calibrated_emotion_grid) {
  const capped_maximum_band_by_emotion = {};
  const observed_similarities_by_band = { 1: [], 2: [], 3: [], 4: [], 5: [] };

  if (!calibrated_emotion_grid || typeof calibrated_emotion_grid !== "object") {
    return {
      capped_maximum_band_by_emotion: {},
      identity_similarity_threshold_by_band: { band1: 0.75, band2: 0.73, band3: 0.70, band4: 0.65, band5: 0.60 }
    };
  }

  for (const emotion_key of Object.keys(calibrated_emotion_grid)) {
    const bands_record = calibrated_emotion_grid[emotion_key] || {};
    let highest_passing_band = 1;

    for (let band_num = 1; band_num <= 5; band_num++) {
      const cell_data = bands_record[`band_${band_num}`] || bands_record[String(band_num)];
      if (cell_data) {
        if (typeof cell_data.identity_similarity_score === "number") {
          observed_similarities_by_band[band_num].push(cell_data.identity_similarity_score);
        }
        if (cell_data.passed) {
          highest_passing_band = Math.max(highest_passing_band, band_num);
        }
      }
    }

    capped_maximum_band_by_emotion[emotion_key] = highest_passing_band;
  }

  // WHAT: Deriving learned per-band thresholds from observed passing similarities.
  const learned_thresholds = {
    band1: 0.75,
    band2: 0.73,
    band3: 0.70,
    band4: 0.65,
    band5: 0.60
  };

  for (let band_num = 1; band_num <= 5; band_num++) {
    const scores = observed_similarities_by_band[band_num];
    if (scores.length > 0) {
      const average_score = scores.reduce((sum, s) => sum + s, 0) / scores.length;
      // Set learned threshold at 90% of observed average
      learned_thresholds[`band${band_num}`] = Number((average_score * 0.90).toFixed(2));
    }
  }

  return {
    capped_maximum_band_by_emotion,
    identity_similarity_threshold_by_band: learned_thresholds
  };
}

/**
 * WHAT: Pure functional remapper adapting story directorial requests to character limits.
 * WHY: When the story script calls for Band 5 rage, but this voice caps cleanly at Band 3,
 *      remaps the request to Band 3 and adds compensatory acoustic cues (tighter pacing,
 *      deliberate breathing pauses) so the scene payoff works without breaking vocal identity.
 * 
 * @param {Readonly<{
 *   emotion: string,
 *   requested_band?: number,
 *   requested_intensity?: number,
 *   calibration_profile?: Object
 * }>} staging_request 
 * @returns {Readonly<{
 *   effective_emotion: string,
 *   effective_band: number,
 *   effective_intensity: number,
 *   was_capped: boolean,
 *   original_requested_band: number,
 *   compensation_rules: Readonly<Object>
 * }>}
 */
function remap_staging_intensity_for_character(staging_request) {
  const emotion_key = (staging_request.emotion || "neutral").trim().toLowerCase();
  const profile = staging_request.calibration_profile || {};
  const caps_table = profile.capped_maximum_band_by_emotion || {};

  const requested_band = staging_request.requested_band
    ? staging_request.requested_band
    : map_intensity_value_to_band_number(staging_request.requested_intensity ?? 0.3);

  const maximum_permitted_band = caps_table[emotion_key] !== undefined
    ? caps_table[emotion_key]
    : 5; // Default unconstrained

  const was_capped = requested_band > maximum_permitted_band;
  const effective_band = was_capped ? maximum_permitted_band : requested_band;

  // Compute nominal intensity value for effective band
  const effective_intensity = Number(((effective_band - 0.5) / 5.0).toFixed(2));

  // WHAT: Synthesizing compensation rules when intensity is capped.
  // WHY: A character who cannot scream must deliver intensity through cold, tightly clipped pace and breathing.
  const compensation_rules = {};
  if (was_capped) {
    compensation_rules.pacing_speed_ratio = 0.88; // Slower, colder delivery
    compensation_rules.inter_segment_pause_multiplier = 1.35; // Dramatic pauses
    compensation_rules.expression_override = "suppressed";
    compensation_rules.delivery_compensation_note = 
      `Vocal intensity capped at Band ${effective_band} (${resolve_emotional_intensity_band(emotion_key, effective_intensity).label}); compensating with tight, clipped articulation and deliberate pauses.`;
  }

  return {
    effective_emotion: emotion_key,
    effective_band,
    effective_intensity,
    was_capped,
    original_requested_band: requested_band,
    compensation_rules
  };
}

/**
 * WHAT: Resolves file path for a character's calibration profile on disk.
 * 
 * @param {string} workspace_directory_path 
 * @param {string} project_name 
 * @param {string} character_name 
 * @returns {string} Absolute path to profile JSON.
 */
function resolve_character_calibration_profile_path(workspace_directory_path, project_name, character_name) {
  const standardized_character_name = (character_name || "character").toLowerCase().replace(/\s+/g, "_");
  return path_library.join(
    workspace_directory_path,
    project_name,
    "audio",
    "calibration",
    `${standardized_character_name}_calibration_profile.json`
  );
}

/**
 * WHAT: Loads a character's voice calibration profile from disk.
 * 
 * @param {string} workspace_directory_path 
 * @param {string} project_name 
 * @param {string} character_name 
 * @returns {Object|null}
 */
function load_character_calibration_profile(workspace_directory_path, project_name, character_name) {
  const profile_path = resolve_character_calibration_profile_path(workspace_directory_path, project_name, character_name);
  if (!filesystem_library.existsSync(profile_path)) {
    return null;
  }
  try {
    const raw_content = filesystem_library.readFileSync(profile_path, "utf-8");
    return JSON.parse(raw_content);
  } catch (error) {
    console.error("Failed to load character calibration profile:", error);
    return null;
  }
}

/**
 * WHAT: Saves a character's voice calibration profile to disk.
 * 
 * @param {string} workspace_directory_path 
 * @param {string} project_name 
 * @param {string} character_name 
 * @param {Object} profile_payload 
 * @returns {boolean} True if written successfully.
 */
function save_character_calibration_profile(workspace_directory_path, project_name, character_name, profile_payload) {
  try {
    const profile_path = resolve_character_calibration_profile_path(workspace_directory_path, project_name, character_name);
    const parent_dir = path_library.dirname(profile_path);
    if (!filesystem_library.existsSync(parent_dir)) {
      filesystem_library.mkdirSync(parent_dir, { recursive: true });
    }
    filesystem_library.writeFileSync(profile_path, JSON.stringify(profile_payload, null, 2), "utf-8");
    return true;
  } catch (error) {
    console.error("Failed to save character calibration profile:", error);
    return false;
  }
}

/**
 * WHAT: Scans screenplay segments to extract dialogue lines from the manuscript matching a character, emotion, and intensity band.
 * WHY: Auditioning and calibrating a character on the actual book's lines tests real dialogue cadence, vocabulary,
 *      and dramatic phrasing instead of artificial generic sentences.
 * 
 * @param {ReadonlyArray<Object>} screenplay_segments - Script segments from the project.
 * @param {string} character_identifier - Target character name or ID (e.g. "Josh", "Dr. Trent").
 * @param {string} [target_emotion] - Desired emotion filter (e.g. "angry", "fearful", "sad").
 * @param {number} [target_band_number] - Desired intensity band filter (1 to 5).
 * @param {Readonly<{
 *   max_candidates?: number,
 *   min_char_length?: number,
 *   max_char_length?: number,
 *   require_dialogue_only?: boolean
 * }>} [options]
 * @returns {ReadonlyArray<Object>} Array of matching candidate dialogue lines.
 */
function extract_calibration_candidate_lines_from_manuscript(
  screenplay_segments,
  character_identifier,
  target_emotion = null,
  target_band_number = null,
  options = {}
) {
  if (!Array.isArray(screenplay_segments) || screenplay_segments.length === 0) {
    return [];
  }

  const {
    max_candidates = 5,
    min_char_length = 15,
    max_char_length = 350,
    require_dialogue_only = true
  } = options;

  const normalized_target_character = (character_identifier || "").trim().toLowerCase();
  const normalized_target_emotion = target_emotion
    ? (target_emotion || "").trim().toLowerCase()
    : null;

  const candidate_results = [];

  for (let segment_index = 0; segment_index < screenplay_segments.length; segment_index++) {
    const segment = screenplay_segments[segment_index];
    if (!segment) continue;

    if (require_dialogue_only && segment.type && segment.type !== "dialogue") {
      continue;
    }

    const segment_speaker = (segment.speaker || segment.character || "").trim().toLowerCase();
    if (normalized_target_character && segment_speaker !== normalized_target_character) {
      if (!segment_speaker.includes(normalized_target_character) && !normalized_target_character.includes(segment_speaker)) {
        continue;
      }
    }

    const text_content = (segment.text || segment.content || "").trim();
    if (text_content.length < min_char_length || text_content.length > max_char_length) {
      continue;
    }

    const segment_raw_emotion = (
      segment.emotion ||
      segment.primary_emotion ||
      (segment.direction && segment.direction.match(/\b(angry|anger|fear|fearful|sad|sadness|happy|joy|whisper|excited|calm)\b/i)?.[1]) ||
      ""
    ).toLowerCase();

    if (normalized_target_emotion && segment_raw_emotion) {
      if (!segment_raw_emotion.includes(normalized_target_emotion) && !normalized_target_emotion.includes(segment_raw_emotion)) {
        continue;
      }
    }

    let segment_band = segment.intensity_band || segment.band;
    if (typeof segment_band !== "number" && typeof segment.intensity === "number") {
      segment_band = map_intensity_value_to_band_number(segment.intensity);
    }

    if (typeof target_band_number === "number" && typeof segment_band === "number") {
      if (segment_band !== target_band_number) {
        continue;
      }
    }

    candidate_results.push({
      segment_index,
      line_id: segment.id || segment.line_id || `line_${segment_index + 1}`,
      speaker: segment.speaker || segment.character,
      text: text_content,
      emotion: segment_raw_emotion || normalized_target_emotion || "neutral",
      band: segment_band || target_band_number || 1,
      direction: segment.direction || "",
      character_length: text_content.length
    });

    if (candidate_results.length >= max_candidates) {
      break;
    }
  }

  return candidate_results;
}

/**
 * WHAT: Registers IPC handlers for the character voice calibration service.
 * 
 * @param {Object} ipcMain 
 */
function register_voice_calibration_handlers(ipcMain) {
  ipcMain.handle("calibration:get-test-sentences", async () => {
    return { success: true, sentences: CALIBRATION_AUDITION_SENTENCES };
  });

  ipcMain.handle("calibration:extract-book-test-lines", async (ipc_event_context, request_arguments) => {
    const { screenplay_segments, character_identifier, target_emotion, target_band_number, options } = request_arguments || {};
    const lines = extract_calibration_candidate_lines_from_manuscript(
      screenplay_segments,
      character_identifier,
      target_emotion,
      target_band_number,
      options
    );
    return { success: true, candidate_lines: lines };
  });

  ipcMain.handle("calibration:get-profile", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, character_name } = request_arguments;
    const profile = load_character_calibration_profile(workspace_directory_path, project_name, character_name);
    return { success: Boolean(profile), profile };
  });

  ipcMain.handle("calibration:save-profile", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, character_name, profile } = request_arguments;
    const saved = save_character_calibration_profile(workspace_directory_path, project_name, character_name, profile);
    return { success: saved };
  });

  ipcMain.handle("calibration:remap-staging", async (ipc_event_context, request_arguments) => {
    const remapped = remap_staging_intensity_for_character(request_arguments);
    return { success: true, remapped };
  });
}

module.exports = {
  CALIBRATION_AUDITION_SENTENCES,
  initialize_character_calibration_profile,
  evaluate_calibration_take_cell,
  derive_character_capability_caps,
  remap_staging_intensity_for_character,
  extract_calibration_candidate_lines_from_manuscript,
  resolve_character_calibration_profile_path,
  load_character_calibration_profile,
  save_character_calibration_profile,
  register_voice_calibration_handlers
};


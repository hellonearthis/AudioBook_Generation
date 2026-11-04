// =========================================================================
// PURE FUNCTIONAL EMOTIONAL ARC & INTENSITY MODELING SERVICE
// =========================================================================
// WHAT: Models emotional intensity as a dynamic state evolving across lines and scenes,
//       separating emotion type from intensity bands (1-5) and expression axis (suppressed vs released).
// WHY: Deciding emotion per line independently causes abrupt, jarring jumps in vocal acting.
//      Real dramatic performance follows build-ups, sustained tension, and gradual decay.

/**
 * WHAT: Discrete 5-tier intensity taxonomy mapping canonical emotions to specific vocal adjectives.
 * WHY: Speech models (AuK, Qwen3) respond far more reliably to calibrated descriptive bands
 *      than to continuous floating-point sliders.
 */
const EMOTIONAL_INTENSITY_BANDS_TABLE = {
  angry: [
    { band: 1, label: "irritated", description: "mildly annoyed, slight edge in tone" },
    { band: 2, label: "frustrated", description: "visibly displeased, strained patience" },
    { band: 3, label: "angry", description: "firm, stern, unmistakable anger" },
    { band: 4, label: "furious", description: "intense, seething, venomous fury" },
    { band: 5, label: "enraged", description: "explosive, ballistic, trembling with rage" }
  ],
  fearful: [
    { band: 1, label: "uneasy", description: "wary, hesitant, slight caution" },
    { band: 2, label: "anxious", description: "nervous, rapid breathing, unsettled" },
    { band: 3, label: "fearful", description: "scared, defensive, clear tremble" },
    { band: 4, label: "terrified", description: "intense terror, high-tension panic" },
    { band: 5, label: "hysterical", description: "paralyzed with dread, breathless shock" }
  ],
  sad: [
    { band: 1, label: "somber", description: "quiet, wistful, subdued" },
    { band: 2, label: "gloomy", description: "downcast, dejected, heavy cadence" },
    { band: 3, label: "sorrowful", description: "sad, melancholic, cracking voice" },
    { band: 4, label: "heartbroken", description: "grief-stricken, choked with emotion" },
    { band: 5, label: "despairing", description: "anguished, completely broken, weeping" }
  ],
  happy: [
    { band: 1, label: "content", description: "pleased, mild smile, relaxed" },
    { band: 2, label: "cheerful", description: "upbeat, warm, approachable" },
    { band: 3, label: "happy", description: "bright, joyful, noticeable lift" },
    { band: 4, label: "delighted", description: "radiant, laughing, energized" },
    { band: 5, label: "ecstatic", description: "euphoric, triumphant, bubbling over" }
  ],
  surprised: [
    { band: 1, label: "intrigued", description: "curious, caught by surprise" },
    { band: 2, label: "startled", description: "taken aback, sharp intake of air" },
    { band: 3, label: "surprised", description: "wide-eyed, clear astonishment" },
    { band: 4, label: "shocked", description: "stunned, disbelieving, breathless" },
    { band: 5, label: "thunderstruck", description: "dumbfounded, speech momentarily halted" }
  ],
  disgusted: [
    { band: 1, label: "distasteful", description: "mild disapproval, curled lip" },
    { band: 2, label: "scornful", description: "sneering, disdainful" },
    { band: 3, label: "disgusted", description: "revolted, unmistakable aversion" },
    { band: 4, label: "repulsed", description: "deep visceral disgust, shuddering" },
    { band: 5, label: "nauseated", description: "sickened, choking back nausea" }
  ],
  excited: [
    { band: 1, label: "eager", description: "engaged, focused interest" },
    { band: 2, label: "animated", description: "lively, brisk cadence" },
    { band: 3, label: "excited", description: "high-energy, spirited projection" },
    { band: 4, label: "thrilled", description: "exhilarated, electric delivery" },
    { band: 5, label: "fervent", description: "wild enthusiasm, breathless intensity" }
  ],
  calm: [
    { band: 1, label: "steady", description: "even, standard delivery" },
    { band: 2, label: "collected", description: "composed, unhurried" },
    { band: 3, label: "calm", description: "soothing, tranquil, soft pace" },
    { band: 4, label: "serene", description: "deeply peaceful, meditative" },
    { band: 5, label: "tranquil", description: "whisper-soft, utterly still" }
  ],
  neutral: [
    { band: 1, label: "neutral", description: "balanced, natural speech" },
    { band: 2, label: "neutral", description: "clear, balanced narrator prose" },
    { band: 3, label: "matter-of-fact", description: "direct, informative, factual" },
    { band: 4, label: "detached", description: "clinical, emotionally reserved" },
    { band: 5, label: "monotone", description: "flat, completely devoid of inflection" }
  ]
};

/**
 * WHAT: Maps an continuous intensity value (0.0 to 1.0) to an integer band (1 to 5).
 * 
 * @param {number} numeric_intensity_value 
 * @returns {number} Integer band 1, 2, 3, 4, or 5.
 */
function map_intensity_value_to_band_number(numeric_intensity_value) {
  const clamped_value = Math.max(0.0, Math.min(1.0, Number(numeric_intensity_value) || 0.0));
  if (clamped_value <= 0.20) return 1;
  if (clamped_value <= 0.40) return 2;
  if (clamped_value <= 0.65) return 3;
  if (clamped_value <= 0.85) return 4;
  return 5;
}

const EMOTION_SYNONYM_MAPPING = {
  anger: "angry",
  rage: "angry",
  fear: "fearful",
  terror: "fearful",
  sadness: "sad",
  grief: "sad",
  joy: "happy",
  happiness: "happy",
  surprise: "surprised",
  disgust: "disgusted",
  excitement: "excited"
};

/**
 * WHAT: Resolves the emotional intensity band descriptor for an emotion and numeric level.
 * 
 * @param {string} canonical_emotion 
 * @param {number} intensity_value_zero_to_one 
 * @returns {{ readonly band: number, readonly label: string, readonly description: string }}
 */
function resolve_emotional_intensity_band(canonical_emotion, intensity_value_zero_to_one) {
  const raw_key = (canonical_emotion || "neutral").trim().toLowerCase();
  const normalized_emotion_key = EMOTION_SYNONYM_MAPPING[raw_key] || raw_key;
  const bands_list = EMOTIONAL_INTENSITY_BANDS_TABLE[normalized_emotion_key] || EMOTIONAL_INTENSITY_BANDS_TABLE.neutral;
  const band_number = map_intensity_value_to_band_number(intensity_value_zero_to_one);
  const matched_band = bands_list.find(b => b.band === band_number) || bands_list[0];

  return {
    band: matched_band.band,
    label: matched_band.label,
    description: matched_band.description
  };
}

/**
 * WHAT: Updates a character's emotional intensity level across chronological dialogue lines.
 * WHY: Gradually pulls level back toward baseline via decay, while applying line triggers
 *      and capping sudden unnatural jumps between neighboring lines.
 * 
 * @param {Readonly<{
 *   previous_intensity: number,
 *   baseline_intensity: number,
 *   trigger_strength: number,
 *   lines_since_last_trigger?: number,
 *   decay_rate_per_line?: number,
 *   max_adjacent_jump?: number
 * }>} parameters_payload 
 * @returns {number} Updated intensity value bounded strictly between 0.0 and 1.0.
 */
function update_character_emotional_intensity(parameters_payload) {
  const previous_intensity = Math.max(0.0, Math.min(1.0, parameters_payload.previous_intensity ?? 0.2));
  const baseline_intensity = Math.max(0.0, Math.min(1.0, parameters_payload.baseline_intensity ?? 0.2));
  const trigger_strength = parameters_payload.trigger_strength || 0.0;
  const lines_since = Math.max(1, parameters_payload.lines_since_last_trigger || 1);
  const decay_rate = parameters_payload.decay_rate_per_line ?? 0.15;
  const max_jump = parameters_payload.max_adjacent_jump ?? 0.30;

  // WHAT: Pull previous level back toward the baseline based on elapsed lines.
  // WHY: Without decay, a character who got furious remains furious indefinitely.
  const decayed_level = baseline_intensity + (previous_intensity - baseline_intensity) * Math.pow(1 - decay_rate, lines_since);

  // WHAT: Add this line's trigger.
  const raw_new_level = decayed_level + trigger_strength;

  // WHAT: Apply smoothing clamp unless the line's trigger was explicitly explosive (|trigger| >= 0.4).
  let smoothed_level = raw_new_level;
  const effective_max_jump = max_jump * lines_since;
  if (Math.abs(trigger_strength) < 0.40) {
    const jump_delta = raw_new_level - previous_intensity;
    if (jump_delta > effective_max_jump) {
      smoothed_level = previous_intensity + effective_max_jump;
    } else if (jump_delta < -effective_max_jump) {
      smoothed_level = previous_intensity - effective_max_jump;
    }
  }

  return Number(Math.max(0.0, Math.min(1.0, smoothed_level)).toFixed(3));
}

/**
 * WHAT: Resolves baseline emotional intensity from the active interpersonal relationship state.
 * WHY: Hostile or tense relationships establish an elevated initial tension floor.
 * 
 * @param {string} relationship_status - e.g., "hostile", "tense", "estranged", "warm", "allied".
 * @param {string} tone - e.g., "hostile", "tense", "guarded", "warm", "neutral".
 * @returns {number} Baseline intensity between 0.10 and 0.55.
 */
function resolve_relationship_emotional_baseline(relationship_status, tone) {
  const norm_status = (relationship_status || "neutral").toLowerCase();
  const norm_tone = (tone || "neutral").toLowerCase();

  if (norm_status === "hostile" || norm_tone === "hostile") {
    return 0.55;
  }
  if (norm_status === "tense" || norm_tone === "tense" || norm_tone === "guarded") {
    return 0.40;
  }
  if (norm_status === "estranged") {
    return 0.35;
  }
  if (norm_status === "warm" || norm_tone === "warm" || norm_status === "allied") {
    return 0.15;
  }

  return 0.20; // Default calm/neutral baseline
}

/**
 * WHAT: Compiles full natural language instruction for AuK and Qwen3 conditioning.
 * WHY: Combines emotion, intensity band adjective, and expression axis (suppressed vs released)
 *      into an explicit vocal director cue.
 * 
 * @param {Readonly<{
 *   emotion: string,
 *   intensity_value: number,
 *   expression?: "suppressed" | "released" | "balanced",
 *   dialogue_text: string
 * }>} options 
 * @returns {string} Compiled prompt instruction string.
 */
function compile_auk_emotional_instruction(options) {
  const { emotion, intensity_value, expression = "balanced", dialogue_text } = options;
  const band_info = resolve_emotional_intensity_band(emotion, intensity_value);

  let expression_modifier = "";
  if (expression === "suppressed") {
    expression_modifier = "in a tight, suppressed, quiet, and controlled manner";
  } else if (expression === "released") {
    expression_modifier = "in an open, dynamic, outward, and projecting manner";
  } else {
    expression_modifier = "naturally";
  }

  const band_label = band_info.label;
  const band_num = band_info.band;

  return `Say the following with the same voice, ${expression_modifier}, with ${band_label} delivery (intensity ${band_num}/5, ${band_info.description}): '${dialogue_text}'`;
}

/**
 * WHAT: Resolves intensity-calibrated drift thresholds for speaker embedding QC.
 * WHY: Shouts and high-intensity emotional deliveries naturally deform the vocal tract,
 *      causing lower cosine similarity to a neutral reference audio clip.
 * 
 * @param {number} intensity_band - Integer 1 to 5.
 * @returns {number} Calibrated cosine similarity threshold (0.60 to 0.75).
 */
function get_calibrated_drift_threshold(intensity_band) {
  switch (Number(intensity_band)) {
    case 5: return 0.60; // Screams / sobbing: allow lower similarity to neutral anchor
    case 4: return 0.65; // Intense shouting / crying
    case 3: return 0.70; // Pronounced emotion
    case 2: return 0.73; // Moderate emotion
    case 1:
    default: return 0.75; // Mild/neutral baseline
  }
}

module.exports = {
  EMOTIONAL_INTENSITY_BANDS_TABLE,
  map_intensity_value_to_band_number,
  resolve_emotional_intensity_band,
  update_character_emotional_intensity,
  resolve_relationship_emotional_baseline,
  compile_auk_emotional_instruction,
  get_calibrated_drift_threshold
};

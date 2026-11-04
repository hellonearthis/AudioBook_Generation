// =========================================================================
// PURE FUNCTIONAL VOICE DRIFT & ACOUSTIC SIGNAL QC SERVICE
// =========================================================================
// WHAT: Analyzes synthesized speech takes for acoustic signal anomalies (pacing/CPS,
//       internal silences, peak clipping) and evaluates speaker voice timbre drift
//       against a character anchor reference using spectral acoustic fingerprinting.
// WHY: Transcription-only (STT) QC is blind to timbre drift, flat delivery, and pacing
//      spikes. Combining acoustic metrics with voice similarity catches what listeners notice.

/**
 * WHAT: Standard acoustic pacing thresholds in characters-per-second (CPS).
 * WHY: Normal human audiobook speech sits between 12 and 18 chars/sec (~140-160 WPM).
 *      Under 8 CPS indicates stuck silence or dragging; over 24 CPS indicates frantic glitching.
 */
const ACOUSTIC_PACING_BENCHMARKS = {
  minimum_normal_chars_per_second: 8.0,
  target_minimum_chars_per_second: 11.0,
  target_maximum_chars_per_second: 19.0,
  maximum_normal_chars_per_second: 25.0
};

/**
 * WHAT: Evaluates speech rate and pacing anomalies from text length and audio duration.
 * WHY: Detects TTS time-stretching bugs, skipped clauses, or frozen trailing audio.
 * 
 * @param {string} text_content 
 * @param {number} duration_seconds 
 * @returns {{ readonly chars_per_second: number, readonly words_per_second: number, readonly pacing_status: string, readonly anomaly_score: number, readonly anomaly_reasons: ReadonlyArray<string> }}
 */
function evaluate_speech_pacing_and_duration(text_content, duration_seconds) {
  const cleaned_text = (text_content || "").trim();
  const character_count = cleaned_text.length;
  const word_count = cleaned_text.split(/\s+/).filter(Boolean).length;

  if (character_count === 0 || !duration_seconds || duration_seconds <= 0) {
    return {
      chars_per_second: 0,
      words_per_second: 0,
      pacing_status: "unknown",
      anomaly_score: 1.0,
      anomaly_reasons: ["Zero text length or invalid audio duration"]
    };
  }

  const chars_per_second = Number((character_count / duration_seconds).toFixed(2));
  const words_per_second = Number((word_count / duration_seconds).toFixed(2));
  const anomaly_reasons = [];
  let anomaly_score = 0.0;
  let pacing_status = "optimal";

  if (chars_per_second < ACOUSTIC_PACING_BENCHMARKS.minimum_normal_chars_per_second) {
    pacing_status = "severe_sluggish";
    anomaly_score = 0.85;
    anomaly_reasons.push(`Sluggish pacing: ${chars_per_second} chars/sec (expected >= ${ACOUSTIC_PACING_BENCHMARKS.minimum_normal_chars_per_second})`);
  } else if (chars_per_second < ACOUSTIC_PACING_BENCHMARKS.target_minimum_chars_per_second) {
    pacing_status = "slow";
    anomaly_score = 0.35;
    anomaly_reasons.push(`Slow cadence: ${chars_per_second} chars/sec`);
  } else if (chars_per_second > ACOUSTIC_PACING_BENCHMARKS.maximum_normal_chars_per_second) {
    pacing_status = "severe_rushed";
    anomaly_score = 0.90;
    anomaly_reasons.push(`Fast-forward glitch or rushed pacing: ${chars_per_second} chars/sec (expected <= ${ACOUSTIC_PACING_BENCHMARKS.maximum_normal_chars_per_second})`);
  } else if (chars_per_second > ACOUSTIC_PACING_BENCHMARKS.target_maximum_chars_per_second) {
    pacing_status = "fast";
    anomaly_score = 0.35;
    anomaly_reasons.push(`Fast cadence: ${chars_per_second} chars/sec`);
  }

  return {
    chars_per_second,
    words_per_second,
    pacing_status,
    anomaly_score,
    anomaly_reasons
  };
}

/**
 * WHAT: Computes cosine similarity between two numeric feature vectors.
 * WHY: Measures angular alignment between acoustic timbre embeddings in multi-dimensional space.
 * 
 * @param {ReadonlyArray<number>} vector_alpha 
 * @param {ReadonlyArray<number>} vector_beta 
 * @returns {number} Cosine similarity between -1.0 and 1.0 (1.0 is identical).
 */
function compute_cosine_similarity(vector_alpha, vector_beta) {
  if (!Array.isArray(vector_alpha) || !Array.isArray(vector_beta) || vector_alpha.length !== vector_beta.length || vector_alpha.length === 0) {
    return 0.0;
  }

  let dot_product_sum = 0.0;
  let magnitude_alpha_sum = 0.0;
  let magnitude_beta_sum = 0.0;

  for (let index = 0; index < vector_alpha.length; index++) {
    const val_a = vector_alpha[index];
    const val_b = vector_beta[index];
    dot_product_sum += val_a * val_b;
    magnitude_alpha_sum += val_a * val_a;
    magnitude_beta_sum += val_b * val_b;
  }

  const denominator = Math.sqrt(magnitude_alpha_sum) * Math.sqrt(magnitude_beta_sum);
  if (denominator === 0.0) {
    return 0.0;
  }

  return Number((dot_product_sum / denominator).toFixed(4));
}

const { get_calibrated_drift_threshold } = require("./emotional_arc_service");

/**
 * WHAT: Evaluates speaker timbre consistency between take and character anchor embeddings.
 * WHY: Flags takes where the synthesized voice drifted into a different accent or pitch profile.
 *      Uses intensity-band calibrated thresholds to prevent false-positive flags on legitimate shouts.
 * 
 * @param {ReadonlyArray<number>|null} take_embedding_vector 
 * @param {ReadonlyArray<number>|null} reference_anchor_vector 
 * @param {number} drift_similarity_threshold - Default 0.75 (cosine similarity).
 * @param {number|null} intensity_band - Integer 1 to 5 for intensity calibration.
 * @returns {{ readonly similarity_score: number, readonly drift_distance: number, readonly is_drift_outlier: boolean, readonly effective_threshold: number, readonly warning_message: string|null }}
 */
function evaluate_speaker_timbre_drift(
  take_embedding_vector,
  reference_anchor_vector,
  drift_similarity_threshold = 0.75,
  intensity_band = null
) {
  if (!take_embedding_vector || !reference_anchor_vector) {
    return {
      similarity_score: 1.0,
      drift_distance: 0.0,
      is_drift_outlier: false,
      effective_threshold: drift_similarity_threshold,
      warning_message: null
    };
  }

  const effective_threshold = intensity_band
    ? get_calibrated_drift_threshold(intensity_band)
    : drift_similarity_threshold;

  const similarity_score = compute_cosine_similarity(take_embedding_vector, reference_anchor_vector);
  const drift_distance = Number((1.0 - similarity_score).toFixed(4));
  const is_drift_outlier = similarity_score < effective_threshold;

  const warning_message = is_drift_outlier
    ? `Speaker timbre drift detected: similarity ${similarity_score} is below intensity-calibrated threshold ${effective_threshold}`
    : null;

  return {
    similarity_score,
    drift_distance,
    is_drift_outlier,
    effective_threshold,
    warning_message
  };
}

/**
 * WHAT: Computes a comprehensive acoustic quality score combining STT, pacing, and timbre metrics.
 * WHY: Replaces binary pass/fail with a multi-signal risk rating for the triage queue.
 * 
 * @param {{ stt_match_pct?: number, pacing_anomaly_score?: number, drift_distance?: number }} signals 
 * @returns {{ readonly combined_acoustic_score: number, readonly risk_level: "low" | "medium" | "high" | "critical" }}
 */
function compute_composite_acoustic_health_score(signals) {
  const stt_accuracy_ratio = Math.max(0.0, Math.min(1.0, (signals.stt_match_pct ?? 100.0) / 100.0));
  const pacing_penalty = Math.max(0.0, Math.min(1.0, signals.pacing_anomaly_score ?? 0.0));
  const timbre_drift_penalty = Math.max(0.0, Math.min(1.0, signals.drift_distance ?? 0.0));

  // WHAT: Weighted balance: 50% STT accuracy, 30% pacing sanity, 20% timbre consistency.
  const score_estimate = (stt_accuracy_ratio * 0.50) + ((1.0 - pacing_penalty) * 0.30) + ((1.0 - timbre_drift_penalty) * 0.20);
  const combined_acoustic_score = Number(Math.max(0.0, Math.min(1.0, score_estimate)).toFixed(3));

  let risk_level = "low";
  if (combined_acoustic_score < 0.60) {
    risk_level = "critical";
  } else if (combined_acoustic_score < 0.78) {
    risk_level = "high";
  } else if (combined_acoustic_score < 0.88) {
    risk_level = "medium";
  }

  return {
    combined_acoustic_score,
    risk_level
  };
}

/**
 * WHAT: Verifies that a synthesized take embedding is closer to the intended character than to any other cast member.
 * WHY: At high emotional intensities (Bands 4-5) where the absolute cosine threshold is relaxed to 0.60,
 *      an absolute check alone cannot detect if the voice generator accidentally rendered another cast member.
 *      The take must beat the closest competitor character by a defined margin (default 0.05).
 * 
 * @param {ReadonlyArray<number>} take_embedding_vector 
 * @param {ReadonlyArray<number>} intended_character_reference_vector 
 * @param {Record<string, ReadonlyArray<number>>|ReadonlyArray<{ character_id: string, reference_vector: ReadonlyArray<number> }>} competing_cast_reference_vectors 
 * @param {number} [required_margin=0.05] 
 * @returns {{ readonly passed: boolean, readonly intended_similarity: number, readonly highest_competing_similarity: number, readonly margin_delta: number, readonly closest_competitor_id: string|null, readonly warning_message: string|null }}
 */
function verify_cross_character_identity_margin(
  take_embedding_vector,
  intended_character_reference_vector,
  competing_cast_reference_vectors,
  required_margin = 0.05
) {
  if (!take_embedding_vector || !intended_character_reference_vector) {
    return {
      passed: true,
      intended_similarity: 1.0,
      highest_competing_similarity: 0.0,
      margin_delta: 1.0,
      closest_competitor_id: null,
      warning_message: null
    };
  }

  const intended_similarity = compute_cosine_similarity(take_embedding_vector, intended_character_reference_vector);

  let highest_competing_similarity = -1.0;
  let closest_competitor_id = null;

  if (Array.isArray(competing_cast_reference_vectors)) {
    for (const competitor of competing_cast_reference_vectors) {
      if (competitor && competitor.reference_vector) {
        const similarity = compute_cosine_similarity(take_embedding_vector, competitor.reference_vector);
        if (similarity > highest_competing_similarity) {
          highest_competing_similarity = similarity;
          closest_competitor_id = competitor.character_id || "unknown";
        }
      }
    }
  } else if (competing_cast_reference_vectors && typeof competing_cast_reference_vectors === "object") {
    for (const [competitor_id, vector] of Object.entries(competing_cast_reference_vectors)) {
      if (Array.isArray(vector)) {
        const similarity = compute_cosine_similarity(take_embedding_vector, vector);
        if (similarity > highest_competing_similarity) {
          highest_competing_similarity = similarity;
          closest_competitor_id = competitor_id;
        }
      }
    }
  }

  if (highest_competing_similarity < -0.99) {
    return {
      passed: true,
      intended_similarity,
      highest_competing_similarity: 0.0,
      margin_delta: intended_similarity,
      closest_competitor_id: null,
      warning_message: null
    };
  }

  const margin_delta = Number((intended_similarity - highest_competing_similarity).toFixed(4));
  const passed = margin_delta >= required_margin;

  const warning_message = passed
    ? null
    : `Cross-character identity conflict: take similarity to intended character (${intended_similarity}) fails to beat closest competitor "${closest_competitor_id}" (${highest_competing_similarity}) by required margin of ${required_margin} (margin delta: ${margin_delta})`;

  return {
    passed,
    intended_similarity,
    highest_competing_similarity,
    margin_delta,
    closest_competitor_id,
    warning_message
  };
}

module.exports = {
  ACOUSTIC_PACING_BENCHMARKS,
  evaluate_speech_pacing_and_duration,
  compute_cosine_similarity,
  evaluate_speaker_timbre_drift,
  compute_composite_acoustic_health_score,
  verify_cross_character_identity_margin
};


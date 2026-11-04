// =========================================================================
// PURE FUNCTIONAL TRIAGE RISK SORTING & "LISTEN BY EXCEPTION" SERVICE
// =========================================================================
// WHAT: Aggregates multi-signal risk metrics (attribution uncertainty, STT word errors,
//       speech rate/pacing anomalies, and timbre drift) to sort screenplay segments
//       by exception so the creator only reviews the top 10% risky lines.
// WHY: Listening through an entire 10-15 hour book causes listener fatigue and missed errors.
//      Risk-sorted triage directs human attention precisely to where automated models struggle.

/**
 * WHAT: Weights assigned to individual error signals in composite risk calculation.
 * WHY: Balances attribution mistakes (wrong speaker), transcription errors (omitted words),
 *      and acoustic defects (sluggish pacing, timbre drift).
 */
const DEFAULT_RISK_WEIGHTS = {
  attribution_uncertainty_weight: 0.35,
  stt_accuracy_deficit_weight: 0.30,
  pacing_anomaly_weight: 0.20,
  timbre_drift_weight: 0.15
};

/**
 * WHAT: Computes a unified risk score (0.0 to 1.0) and generates diagnostic triage reasons.
 * WHY: Explains in plain English why a segment was flagged for manual review.
 * 
 * @param {Readonly<Object>} segment_data 
 * @param {Readonly<Object>} weights 
 * @returns {{ readonly segment_index: number, readonly risk_score: number, readonly risk_tier: "critical" | "high" | "medium" | "low", readonly triage_reasons: ReadonlyArray<string> }}
 */
function compute_segment_risk_score(segment_data, weights = DEFAULT_RISK_WEIGHTS) {
  const segment_index = segment_data.index_position ?? 0;
  const triage_reasons = [];

  // 1. Attribution Uncertainty
  const attribution_confidence = typeof segment_data.confidence === "number" ? segment_data.confidence : 1.0;
  const attribution_uncertainty = Math.max(0.0, Math.min(1.0, 1.0 - attribution_confidence));
  if (attribution_confidence < 0.60) {
    triage_reasons.push(`Low attribution confidence (${(attribution_confidence * 100).toFixed(0)}%)`);
  }
  if (segment_data.speaker === "unknown" || segment_data.speaker === "Unknown") {
    triage_reasons.push("Unresolved speaker identity (marked unknown)");
  }

  // 2. STT Quality Deficit
  const qc_data = segment_data.qc || {};
  const stt_match_percentage = typeof qc_data.match_percentage === "number" ? qc_data.match_percentage : 100.0;
  const stt_deficit = Math.max(0.0, Math.min(1.0, 1.0 - (stt_match_percentage / 100.0)));
  if (stt_match_percentage < 90.0) {
    triage_reasons.push(`STT mismatch (${stt_match_percentage.toFixed(0)}% match against expected text)`);
  }

  // 3. Pacing & Speech Rate Anomaly
  const acoustic_data = segment_data.acoustic || {};
  const pacing_anomaly_score = typeof acoustic_data.anomaly_score === "number" ? acoustic_data.anomaly_score : 0.0;
  if (pacing_anomaly_score > 0.40) {
    const cps_value = acoustic_data.chars_per_second;
    const rate_label = cps_value ? ` (${cps_value} chars/sec)` : "";
    triage_reasons.push(`Pacing anomaly: ${acoustic_data.pacing_status || "irregular"}${rate_label}`);
  }

  // 4. Timbre Drift
  const timbre_data = segment_data.timbre || {};
  const drift_distance = typeof timbre_data.drift_distance === "number" ? timbre_data.drift_distance : 0.0;
  if (drift_distance > 0.25) {
    triage_reasons.push(`Voice timbre drift (${(timbre_data.similarity_score * 100).toFixed(0)}% match to character anchor)`);
  }

  // Composite weighted score
  const raw_risk_score = 
    (attribution_uncertainty * weights.attribution_uncertainty_weight) +
    (stt_deficit * weights.stt_accuracy_deficit_weight) +
    (pacing_anomaly_score * weights.pacing_anomaly_weight) +
    (drift_distance * weights.timbre_drift_weight);

  const risk_score = Number(Math.max(0.0, Math.min(1.0, raw_risk_score)).toFixed(3));

  let risk_tier = "low";
  if (risk_score >= 0.50 || segment_data.speaker === "unknown") {
    risk_tier = "critical";
  } else if (risk_score >= 0.32) {
    risk_tier = "high";
  } else if (risk_score >= 0.15) {
    risk_tier = "medium";
  }

  return {
    segment_index,
    risk_score,
    risk_tier,
    triage_reasons
  };
}

/**
 * WHAT: Sorts a screenplay segment list into a prioritized "Listen by Exception" review queue.
 * WHY: Returns segments in descending order of risk score, allowing creators to inspect
 *      only the top outliers or slice by risk tier.
 * 
 * @param {ReadonlyArray<Object>} screenplay_segments 
 * @param {Readonly<{ top_percentile?: number, minimum_risk_tier?: "critical" | "high" | "medium" | "low" }>} filter_options 
 * @returns {ReadonlyArray<Object>} Sorted and filtered review items with diagnostic metadata.
 */
function build_risk_prioritized_review_queue(screenplay_segments, filter_options = {}) {
  if (!Array.isArray(screenplay_segments) || screenplay_segments.length === 0) {
    return [];
  }

  const scored_items_list = screenplay_segments.map((segment_item) => {
    const risk_assessment = compute_segment_risk_score(segment_item);
    return {
      ...segment_item,
      risk_score: risk_assessment.risk_score,
      risk_tier: risk_assessment.risk_tier,
      triage_reasons: risk_assessment.triage_reasons
    };
  });

  // WHAT: Sort descending by risk score (highest risk first).
  const descending_sorted_items = [...scored_items_list].sort(
    (item_alpha, item_beta) => item_beta.risk_score - item_alpha.risk_score
  );

  let filtered_items = descending_sorted_items;

  // Filter by minimum risk tier if requested
  if (filter_options.minimum_risk_tier) {
    const tier_hierarchy = { critical: 4, high: 3, medium: 2, low: 1 };
    const minimum_tier_rank = tier_hierarchy[filter_options.minimum_risk_tier] || 1;
    filtered_items = filtered_items.filter(
      (item) => (tier_hierarchy[item.risk_tier] || 1) >= minimum_tier_rank
    );
  }

  // Slice top percentile if requested (e.g., top 10%)
  if (typeof filter_options.top_percentile === "number" && filter_options.top_percentile > 0 && filter_options.top_percentile < 100) {
    const slice_count = Math.max(1, Math.ceil((screenplay_segments.length * filter_options.top_percentile) / 100));
    filtered_items = filtered_items.slice(0, slice_count);
  }

  return filtered_items;
}

module.exports = {
  DEFAULT_RISK_WEIGHTS,
  compute_segment_risk_score,
  build_risk_prioritized_review_queue
};


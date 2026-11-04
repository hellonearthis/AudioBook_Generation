// =========================================================================
// PURE FUNCTIONAL PIPELINE TELEMETRY & QC METRICS SERVICE
// =========================================================================
// WHAT: Tracks and calculates production efficiency metrics:
//       1. Review minutes per hour of finished audio.
//       2. Flagged line rate (% of lines sent to triage queue).
//       3. False positive QC rate (% of flags accepted without edits).
//       4. Re-render rate per chapter.
//       5. QC defect root-cause distribution (STT vs timbre vs pacing).
// WHY: Measuring where the pipeline costs human time guides which automated checks
//      to tighten or loosen, replacing subjective guesswork with hard telemetry.

const path_library = require("path");
const filesystem_library = require("fs");

/**
 * WHAT: Computes comprehensive production efficiency metrics from project screenplay and QC logs.
 * 
 * @param {Readonly<{
 *   total_screenplay_segments_count: number,
 *   total_audio_runtime_seconds: number,
 *   flagged_segments_count: number,
 *   human_modified_after_flag_count: number,
 *   human_accepted_without_edit_count: number,
 *   total_takes_generated_count: number,
 *   defect_counts?: {
 *     stt_mismatch?: number,
 *     timbre_drift?: number,
 *     pacing_anomaly?: number,
 *     cross_character_conflict?: number
 *   }
 * }>} telemetry_payload 
 * @returns {Readonly<Object>} Calculated efficiency metrics record.
 */
function calculate_pipeline_telemetry_metrics(telemetry_payload) {
  const {
    total_screenplay_segments_count = 0,
    total_audio_runtime_seconds = 0,
    flagged_segments_count = 0,
    human_modified_after_flag_count = 0,
    human_accepted_without_edit_count = 0,
    total_takes_generated_count = 0,
    defect_counts = {}
  } = telemetry_payload;

  const total_hours = total_audio_runtime_seconds > 0 ? (total_audio_runtime_seconds / 3600.0) : 0.0;

  // WHAT: Review time estimation.
  // WHY: Average editor spends ~1.5 minutes reviewing and playing back a flagged line.
  const estimated_review_minutes_total = Number((flagged_segments_count * 1.5).toFixed(1));
  const review_minutes_per_hour = total_hours > 0
    ? Number((estimated_review_minutes_total / total_hours).toFixed(1))
    : 0.0;

  // WHAT: Flagged line rate.
  const flagged_line_rate_percentage = total_screenplay_segments_count > 0
    ? Number(((flagged_segments_count / total_screenplay_segments_count) * 100.0).toFixed(1))
    : 0.0;

  // WHAT: False positive rate.
  // WHY: If 80% of flagged lines are accepted without edit, the QC checks are too strict.
  const total_audited_flags = human_modified_after_flag_count + human_accepted_without_edit_count;
  const false_positive_qc_rate = total_audited_flags > 0
    ? Number(((human_accepted_without_edit_count / total_audited_flags) * 100.0).toFixed(1))
    : 0.0;

  // WHAT: Re-render rate.
  // WHY: A ratio of 1.15 means 15% of lines had to be re-rendered.
  const re_render_rate_percentage = total_screenplay_segments_count > 0 && total_takes_generated_count > total_screenplay_segments_count
    ? Number((((total_takes_generated_count - total_screenplay_segments_count) / total_screenplay_segments_count) * 100.0).toFixed(1))
    : 0.0;

  const defect_breakdown = {
    stt_mismatch: defect_counts.stt_mismatch || 0,
    timbre_drift: defect_counts.timbre_drift || 0,
    pacing_anomaly: defect_counts.pacing_anomaly || 0,
    cross_character_conflict: defect_counts.cross_character_conflict || 0
  };

  return Object.freeze({
    total_screenplay_segments: total_screenplay_segments_count,
    total_audio_runtime_hours: Number(total_hours.toFixed(2)),
    review_minutes_per_hour,
    estimated_total_review_minutes: estimated_review_minutes_total,
    flagged_line_rate_percentage,
    false_positive_qc_rate,
    re_render_rate_percentage,
    takes_per_segment_ratio: total_screenplay_segments_count > 0 ? Number((total_takes_generated_count / total_screenplay_segments_count).toFixed(2)) : 1.0,
    defect_breakdown: Object.freeze(defect_breakdown),
    calculated_at_timestamp: Date.now()
  });
}

/**
 * WHAT: Resolves path to project telemetry metrics file on disk.
 * 
 * @param {string} workspace_directory_path 
 * @param {string} project_name 
 * @returns {string} Absolute path to telemetry_metrics.json.
 */
function resolve_pipeline_metrics_file_path(workspace_directory_path, project_name) {
  return path_library.join(
    workspace_directory_path,
    project_name,
    "audio",
    "telemetry_metrics.json"
  );
}

/**
 * WHAT: Loads saved pipeline telemetry metrics from disk.
 * 
 * @param {string} workspace_directory_path 
 * @param {string} project_name 
 * @returns {Object|null}
 */
function load_pipeline_metrics(workspace_directory_path, project_name) {
  const metrics_path = resolve_pipeline_metrics_file_path(workspace_directory_path, project_name);
  if (!filesystem_library.existsSync(metrics_path)) {
    return null;
  }
  try {
    const raw_data = filesystem_library.readFileSync(metrics_path, "utf-8");
    return JSON.parse(raw_data);
  } catch (error) {
    console.error("Failed to load pipeline telemetry metrics:", error);
    return null;
  }
}

/**
 * WHAT: Saves pipeline telemetry metrics to disk.
 * 
 * @param {string} workspace_directory_path 
 * @param {string} project_name 
 * @param {Object} metrics_payload 
 * @returns {boolean} True if saved successfully.
 */
function save_pipeline_metrics(workspace_directory_path, project_name, metrics_payload) {
  try {
    const metrics_path = resolve_pipeline_metrics_file_path(workspace_directory_path, project_name);
    const parent_dir = path_library.dirname(metrics_path);
    if (!filesystem_library.existsSync(parent_dir)) {
      filesystem_library.mkdirSync(parent_dir, { recursive: true });
    }
    filesystem_library.writeFileSync(metrics_path, JSON.stringify(metrics_payload, null, 2), "utf-8");
    return true;
  } catch (error) {
    console.error("Failed to save pipeline telemetry metrics:", error);
    return false;
  }
}

module.exports = {
  calculate_pipeline_telemetry_metrics,
  resolve_pipeline_metrics_file_path,
  load_pipeline_metrics,
  save_pipeline_metrics
};


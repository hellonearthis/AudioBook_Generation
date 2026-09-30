"use strict";

// =========================================================================
// LAYA QC PHASED CALIBRATION FITTER (TEMPERATURE SCALING & DATA GATES)
// =========================================================================
// WHAT: Fits 1-parameter temperature scaling scalars per task question type
//       and derives empirical auto-approve / review thresholds from ground-truth data.
// WHY: Deep classifiers often produce uncalibrated over- or under-confident probabilities.
//      Temperature scaling fixes this without altering ranking accuracy.
//      Detects optimizer boundary-pegging as an overfit signal and labels metrics
//      as provisional when sample sizes are below statistical stability (N < 30).

const filesystem_module = require("fs");
const path_module = require("path");

const CALIBRATION_LOG_FILE_PATH = process.argv[2] || path_module.join(__dirname, "..", "benchmarks", "qc_calibration_log.jsonl");
const CALIBRATED_CONFIG_OUTPUT_PATH = path_module.join(__dirname, "..", "benchmarks", "calibrated_qc_config.json");

// WHAT: Optimizer search range constants for temperature fitting.
// WHY: Widened from [0.1, 5.0] to [0.05, 10.0] to accommodate higher variance while detecting boundary pegging.
const CALIBRATION_SEARCH_RANGE_MINIMUM_TEMPERATURE = 0.05;
const CALIBRATION_SEARCH_RANGE_MAXIMUM_TEMPERATURE = 10.0;
const OPTIMIZATION_CONVERGENCE_TOLERANCE = 1e-4;

// WHAT: Statistical sample size thresholds for non-provisional calibration confidence.
// WHY: Fitting 1 parameter on small samples (N < 30) risks severe overfitting (e.g. boundary-pegging to T=0.05),
//      artificially driving ECE and Brier scores to zero. A few dozen human verdicts are required per task.
const MINIMUM_ANNOTATED_RECORDS_FOR_EXECUTION = 5;
const RECOMMENDED_MINIMUM_RELIABLE_SAMPLE_SIZE = 30;

// -------------------------------------------------------------------------
// MATHEMATICAL TRANSFORMATIONS & METRIC CALCULATIONS
// -------------------------------------------------------------------------

// WHAT: Standard logistic sigmoid transformation mapping real logits to [0, 1] probability range.
// WHY: Used to recover scaled probabilities after dividing uncalibrated logits by temperature T.
function compute_standard_logistic_sigmoid(raw_logit_value) {
  return 1 / (1 + Math.exp(-raw_logit_value));
}

// WHAT: Log-odds (logit) transformation mapping probability p in (0, 1) to real-valued logit space.
// WHY: Temperature scaling operates in logit space by scaling: scaled_probability = sigmoid(logit(p) / T).
function compute_bounded_probability_logit(probability_score_value) {
  const clamped_probability_value = Math.max(1e-6, Math.min(1 - 1e-6, probability_score_value));
  return Math.log(clamped_probability_value / (1 - clamped_probability_value));
}

// WHAT: Calculating Expected Calibration Error (ECE) across binned confidence intervals.
// WHY: Measures how closely predicted confidence percentages match actual observed empirical accuracy.
function calculate_binary_expected_calibration_error(predicted_probabilities_list, ground_truth_targets_list, total_calibration_bins_count = 10) {
  if (predicted_probabilities_list.length === 0) {
    return 0;
  }

  const bin_total_samples_tally = new Array(total_calibration_bins_count).fill(0);
  const bin_true_positives_tally = new Array(total_calibration_bins_count).fill(0);
  const bin_accumulated_confidence_sum = new Array(total_calibration_bins_count).fill(0);

  for (let sample_index_counter = 0; sample_index_counter < predicted_probabilities_list.length; sample_index_counter++) {
    const probability_score = Math.max(0, Math.min(1, predicted_probabilities_list[sample_index_counter]));
    const target_ground_truth = ground_truth_targets_list[sample_index_counter];
    const destination_bin_index = Math.min(total_calibration_bins_count - 1, Math.floor(probability_score * total_calibration_bins_count));

    bin_total_samples_tally[destination_bin_index]++;
    bin_accumulated_confidence_sum[destination_bin_index] += probability_score;
    if (target_ground_truth === 1) {
      bin_true_positives_tally[destination_bin_index]++;
    }
  }

  let total_weighted_expected_calibration_error = 0;
  const total_population_samples_count = predicted_probabilities_list.length;

  for (let current_bin_index = 0; current_bin_index < total_calibration_bins_count; current_bin_index++) {
    const samples_in_current_bin = bin_total_samples_tally[current_bin_index];
    if (samples_in_current_bin > 0) {
      const average_predicted_confidence = bin_accumulated_confidence_sum[current_bin_index] / samples_in_current_bin;
      const average_observed_accuracy = bin_true_positives_tally[current_bin_index] / samples_in_current_bin;
      const bin_population_weight = samples_in_current_bin / total_population_samples_count;
      total_weighted_expected_calibration_error += bin_population_weight * Math.abs(average_observed_accuracy - average_predicted_confidence);
    }
  }

  return total_weighted_expected_calibration_error;
}

// WHAT: Calculating Brier Score (Mean Squared Error on predicted probabilities vs binary ground truth).
// WHY: Measures sharpness and calibration simultaneously; strictly proper scoring rule.
function calculate_brier_probability_score(predicted_probabilities_list, ground_truth_targets_list) {
  if (predicted_probabilities_list.length === 0) {
    return 0;
  }
  let accumulated_squared_error_sum = 0;
  for (let sample_index_counter = 0; sample_index_counter < predicted_probabilities_list.length; sample_index_counter++) {
    accumulated_squared_error_sum += Math.pow(predicted_probabilities_list[sample_index_counter] - ground_truth_targets_list[sample_index_counter], 2);
  }
  return accumulated_squared_error_sum / predicted_probabilities_list.length;
}

// WHAT: Binary Negative Log-Likelihood (NLL / Cross-Entropy Loss) for a given candidate temperature.
// WHY: Objective loss function minimized during temperature scaling optimization.
function calculate_binary_negative_log_likelihood(logits_array_list, ground_truth_targets_list, candidate_temperature_scalar) {
  let accumulated_negative_log_likelihood_loss = 0;
  const numerical_stability_epsilon = 1e-12;

  for (let logit_index_counter = 0; logit_index_counter < logits_array_list.length; logit_index_counter++) {
    const raw_logit_value = logits_array_list[logit_index_counter];
    const target_ground_truth = ground_truth_targets_list[logit_index_counter];

    const calibrated_probability = compute_standard_logistic_sigmoid(raw_logit_value / candidate_temperature_scalar);
    const clamped_probability = Math.max(numerical_stability_epsilon, Math.min(1 - numerical_stability_epsilon, calibrated_probability));

    accumulated_negative_log_likelihood_loss -= (
      target_ground_truth * Math.log(clamped_probability) +
      (1 - target_ground_truth) * Math.log(1 - clamped_probability)
    );
  }

  return accumulated_negative_log_likelihood_loss / logits_array_list.length;
}

// -------------------------------------------------------------------------
// TEMPERATURE OPTIMIZER & BOUNDARY OVERFIT DETECTION
// -------------------------------------------------------------------------

// WHAT: 1D Line search optimization (Golden Section Search) to find optimal temperature T minimizing NLL.
// WHY: Convex 1D search guarantees finding the optimal temperature within tolerance without gradient instability.
//      Detects boundary-pegging when the optimal temperature lands on search limits [min, max].
function fit_binary_temperature_scalar_with_boundary_detection(
  logits_array_list,
  ground_truth_targets_list,
  custom_search_boundaries = {}
) {
  const search_range_lower_bound = custom_search_boundaries.lower_bound || CALIBRATION_SEARCH_RANGE_MINIMUM_TEMPERATURE;
  const search_range_upper_bound = custom_search_boundaries.upper_bound || CALIBRATION_SEARCH_RANGE_MAXIMUM_TEMPERATURE;

  const golden_ratio_constant = (1 + Math.sqrt(5)) / 2;
  const golden_section_step_factor = 2 - golden_ratio_constant;

  let search_interval_left = search_range_lower_bound;
  let search_interval_right = search_range_upper_bound;

  let candidate_point_c = search_interval_left + golden_section_step_factor * (search_interval_right - search_interval_left);
  let candidate_point_d = search_interval_right - golden_section_step_factor * (search_interval_right - search_interval_left);

  let loss_at_candidate_point_c = calculate_binary_negative_log_likelihood(logits_array_list, ground_truth_targets_list, candidate_point_c);
  let loss_at_candidate_point_d = calculate_binary_negative_log_likelihood(logits_array_list, ground_truth_targets_list, candidate_point_d);

  while (Math.abs(search_interval_right - search_interval_left) > OPTIMIZATION_CONVERGENCE_TOLERANCE) {
    if (loss_at_candidate_point_c < loss_at_candidate_point_d) {
      search_interval_right = candidate_point_d;
      candidate_point_d = candidate_point_c;
      loss_at_candidate_point_d = loss_at_candidate_point_c;
      candidate_point_c = search_interval_left + golden_section_step_factor * (search_interval_right - search_interval_left);
      loss_at_candidate_point_c = calculate_binary_negative_log_likelihood(logits_array_list, ground_truth_targets_list, candidate_point_c);
    } else {
      search_interval_left = candidate_point_c;
      candidate_point_c = candidate_point_d;
      loss_at_candidate_point_c = loss_at_candidate_point_d;
      candidate_point_d = search_interval_right - golden_section_step_factor * (search_interval_right - search_interval_left);
      loss_at_candidate_point_d = calculate_binary_negative_log_likelihood(logits_array_list, ground_truth_targets_list, candidate_point_d);
    }
  }

  const optimal_fitted_temperature = Number(((search_interval_left + search_interval_right) / 2).toFixed(4));

  // WHAT: Detecting whether the fitted temperature landed on or near the search boundary.
  // WHY: Landing on search boundaries (e.g. 0.05 or 10.0) is a hallmark symptom of optimizer overfitting
  //      to linearly separable small samples, rather than a well-calibrated distribution.
  const boundary_proximity_detection_margin = 0.015;
  const is_lower_boundary_hit = Math.abs(optimal_fitted_temperature - search_range_lower_bound) <= boundary_proximity_detection_margin;
  const is_upper_boundary_hit = Math.abs(optimal_fitted_temperature - search_range_upper_bound) <= boundary_proximity_detection_margin;
  const is_boundary_pegged = is_lower_boundary_hit || is_upper_boundary_hit;

  return {
    fitted_temperature: optimal_fitted_temperature,
    boundary_pegged: is_boundary_pegged,
    pegged_boundary_type: is_lower_boundary_hit ? "lower" : (is_upper_boundary_hit ? "upper" : null),
    search_bounds: [search_range_lower_bound, search_range_upper_bound]
  };
}

// -------------------------------------------------------------------------
// THRESHOLD DERIVATION FROM CALIBRATED DATA
// -------------------------------------------------------------------------

// WHAT: Derives empirical auto-approve and human-review thresholds based on calibrated probabilities.
// WHY: Finds the lowest calibrated confidence threshold where empirical accuracy >= targetAccuracy (e.g. 95%).
function derive_empirical_decision_thresholds_from_data(calibrated_probabilities_list, ground_truth_targets_list, target_accuracy_ratio = 0.95) {
  if (calibrated_probabilities_list.length === 0) {
    return { auto_approve_threshold: 0.90, review_threshold: 0.50 };
  }

  const paired_samples_list = calibrated_probabilities_list.map((single_probability, sample_index) => ({
    probability: single_probability,
    target: ground_truth_targets_list[sample_index]
  }));

  // Sort descending by calibrated probability
  paired_samples_list.sort((first_pair, second_pair) => second_pair.probability - first_pair.probability);

  let best_identified_threshold = 0.90;
  let running_correct_decisions_count = 0;
  let running_evaluated_samples_total = 0;

  for (let sample_index_counter = 0; sample_index_counter < paired_samples_list.length; sample_index_counter++) {
    running_evaluated_samples_total++;
    if (paired_samples_list[sample_index_counter].target === 1) {
      running_correct_decisions_count++;
    }
    const current_empirical_accuracy = running_correct_decisions_count / running_evaluated_samples_total;

    if (current_empirical_accuracy >= target_accuracy_ratio) {
      best_identified_threshold = paired_samples_list[sample_index_counter].probability;
    } else if (running_evaluated_samples_total >= 5) {
      // Accuracy dropped below target
      break;
    }
  }

  const calculated_review_threshold = Number(Math.max(0.40, Math.min(0.60, best_identified_threshold - 0.35)).toFixed(2));
  const calculated_auto_approve_threshold = Number(Math.max(0.70, Math.min(0.98, best_identified_threshold)).toFixed(2));

  return {
    auto_approve_threshold: calculated_auto_approve_threshold,
    review_threshold: calculated_review_threshold
  };
}

// -------------------------------------------------------------------------
// MAIN CALIBRATION ANALYSIS RUNNER
// -------------------------------------------------------------------------

// WHAT: Main execution coordinator reading the append-only JSONL log and computing calibrated QC parameters.
// WHY: Produces benchmarks/calibrated_qc_config.json with explicit provisional labeling and overfit guardrails.
function execute_full_qc_calibration_analysis() {
  console.log("==========================================================================");
  console.log("   LAYA QC PHASED CALIBRATION ENGINE (TEMPERATURE SCALING & DATA GATES)   ");
  console.log("==========================================================================\n");

  if (!filesystem_module.existsSync(CALIBRATION_LOG_FILE_PATH)) {
    console.error(`Log file not found: ${CALIBRATION_LOG_FILE_PATH}`);
    console.log("Run pipeline verification tasks to generate logged decisions first.");
    process.exit(1);
  }

  const raw_log_file_lines = filesystem_module.readFileSync(CALIBRATION_LOG_FILE_PATH, "utf8").split("\n").filter(Boolean);
  const total_recorded_decisions_list = raw_log_file_lines.map((single_line) => JSON.parse(single_line));
  console.log(`Loaded ${total_recorded_decisions_list.length} logged QC records from: ${CALIBRATION_LOG_FILE_PATH}\n`);

  // Filter records with non-null human_verdict (Phase 2 ground truth)
  const annotated_ground_truth_records = total_recorded_decisions_list.filter(
    (single_record) => single_record.human_verdict !== null && single_record.human_verdict !== undefined
  );
  console.log(`Annotated records with human_verdict: ${annotated_ground_truth_records.length} / ${total_recorded_decisions_list.length}`);

  if (annotated_ground_truth_records.length < MINIMUM_ANNOTATED_RECORDS_FOR_EXECUTION) {
    console.warn("\n⚠️ WARNING: Fewer than 5 annotated records found with human_verdict!");
    console.warn("To perform empirical calibration fitting, review logged decisions in the UI.");
    console.warn("Generating provisional report without overriding production config.\n");
  }

  // Group annotated records by question_type
  const records_grouped_by_question_type = {};
  for (let record_index = 0; record_index < annotated_ground_truth_records.length; record_index++) {
    const active_record = annotated_ground_truth_records[record_index];
    const question_type_key = active_record.question_type || "unknown";
    if (!records_grouped_by_question_type[question_type_key]) {
      records_grouped_by_question_type[question_type_key] = [];
    }
    records_grouped_by_question_type[question_type_key].push(active_record);
  }

  const final_calibration_results_by_task = {};

  for (const [task_name_key, task_annotated_records_list] of Object.entries(records_grouped_by_question_type)) {
    console.log(`\n--------------------------------------------------------------------------`);
    console.log(`>>> Analyzing Question Type: ${task_name_key.toUpperCase()} (${task_annotated_records_list.length} labeled samples)`);
    console.log(`--------------------------------------------------------------------------`);

    const is_sample_size_provisional = task_annotated_records_list.length < RECOMMENDED_MINIMUM_RELIABLE_SAMPLE_SIZE;
    if (is_sample_size_provisional) {
      console.warn(`  ⚠️ PROVISIONAL SAMPLE SIZE: N=${task_annotated_records_list.length} is below recommended minimum of ${RECOMMENDED_MINIMUM_RELIABLE_SAMPLE_SIZE}.`);
      console.warn(`     Treating all derived parameters for ${task_name_key} as provisional until a few dozen human verdicts are logged.`);
    }

    if (task_name_key === "speaker_attribution") {
      let agreed_speaker_predictions_count = 0;
      let human_approved_decisions_count = 0;

      for (let record_counter = 0; record_counter < task_annotated_records_list.length; record_counter++) {
        const single_record = task_annotated_records_list[record_counter];
        if (single_record.is_agreement) {
          agreed_speaker_predictions_count++;
        }
        if (single_record.human_verdict === true || single_record.human_verdict === "true") {
          human_approved_decisions_count++;
        }
      }

      console.log(`  Qwen/Laya Agreement Rate: ${(agreed_speaker_predictions_count / task_annotated_records_list.length * 100).toFixed(1)}%`);
      console.log(`  Human Approval Rate:      ${(human_approved_decisions_count / task_annotated_records_list.length * 100).toFixed(1)}%`);

      final_calibration_results_by_task[task_name_key] = {
        status: is_sample_size_provisional ? "provisional" : "calibrated",
        is_provisional: is_sample_size_provisional,
        provisional_warning: is_sample_size_provisional
          ? `Sample count (N=${task_annotated_records_list.length}) is below recommended threshold of ${RECOMMENDED_MINIMUM_RELIABLE_SAMPLE_SIZE}. Agreement and approval rates are provisional.`
          : null,
        sample_count: task_annotated_records_list.length,
        agreement_rate: Number((agreed_speaker_predictions_count / task_annotated_records_list.length).toFixed(3)),
        human_approval_rate: Number((human_approved_decisions_count / task_annotated_records_list.length).toFixed(3)),
        fitted_temperature: 1.0,
        auto_approve_threshold: 0.85,
        review_threshold: 0.50
      };
      continue;
    }

    // Binary verification tasks (character_existence, relationship_evidence, emotion)
    const raw_probability_scores_list = [];
    const logit_values_list = [];
    const target_ground_truth_list = [];

    for (let record_counter = 0; record_counter < task_annotated_records_list.length; record_counter++) {
      const single_record = task_annotated_records_list[record_counter];
      const probability_score = typeof single_record.laya_raw_probability === "number" ? single_record.laya_raw_probability : single_record.raw_noul;

      if (typeof probability_score === "number" && !isNaN(probability_score)) {
        raw_probability_scores_list.push(probability_score);
        logit_values_list.push(compute_bounded_probability_logit(probability_score));
        const target_value = (single_record.human_verdict === true || single_record.human_verdict === 1 || single_record.human_verdict === "true") ? 1 : 0;
        target_ground_truth_list.push(target_value);
      }
    }

    if (raw_probability_scores_list.length === 0) {
      continue;
    }

    const uncalibrated_expected_calibration_error = calculate_binary_expected_calibration_error(raw_probability_scores_list, target_ground_truth_list);
    const uncalibrated_brier_score = calculate_brier_probability_score(raw_probability_scores_list, target_ground_truth_list);

    // Fit temperature with widened search range and boundary detection
    const temperature_fitting_result = fit_binary_temperature_scalar_with_boundary_detection(
      logit_values_list,
      target_ground_truth_list,
      {
        lower_bound: CALIBRATION_SEARCH_RANGE_MINIMUM_TEMPERATURE,
        upper_bound: CALIBRATION_SEARCH_RANGE_MAXIMUM_TEMPERATURE
      }
    );

    if (temperature_fitting_result.boundary_pegged) {
      console.warn(`  ⚠️ OVERFIT SIGNAL: Fitted temperature (T=${temperature_fitting_result.fitted_temperature}) landed on the ${temperature_fitting_result.pegged_boundary_type} search boundary [${temperature_fitting_result.search_bounds.join(", ")}].`);
      console.warn(`     This indicates severe saturation/overfitting on small linearly separable sample size (N=${raw_probability_scores_list.length}) rather than genuine calibration.`);
    }

    const calibrated_probabilities_list = logit_values_list.map((single_logit) => compute_standard_logistic_sigmoid(single_logit / temperature_fitting_result.fitted_temperature));
    const calibrated_expected_calibration_error = calculate_binary_expected_calibration_error(calibrated_probabilities_list, target_ground_truth_list);
    const calibrated_brier_score = calculate_brier_probability_score(calibrated_probabilities_list, target_ground_truth_list);

    const derived_data_thresholds = derive_empirical_decision_thresholds_from_data(calibrated_probabilities_list, target_ground_truth_list, 0.95);

    const is_provisional_task = is_sample_size_provisional || temperature_fitting_result.boundary_pegged;

    const provisional_reasons_list = [];
    if (is_sample_size_provisional) {
      provisional_reasons_list.push(`Sample count (N=${raw_probability_scores_list.length}) is below recommended threshold of ${RECOMMENDED_MINIMUM_RELIABLE_SAMPLE_SIZE}.`);
    }
    if (temperature_fitting_result.boundary_pegged) {
      provisional_reasons_list.push(`Fitted temperature landed on ${temperature_fitting_result.pegged_boundary_type} search boundary (${temperature_fitting_result.fitted_temperature}), indicating severe overfit.`);
    }

    console.log(`  Uncalibrated ECE:         ${(uncalibrated_expected_calibration_error * 100).toFixed(2)}% | Brier Score: ${uncalibrated_brier_score.toFixed(4)}`);
    console.log(`  Fitted Temperature:       T = ${temperature_fitting_result.fitted_temperature}${temperature_fitting_result.boundary_pegged ? " [BOUNDARY PEGGED - OVERFIT]" : ""}`);
    console.log(`  Calibrated ECE:           ${(calibrated_expected_calibration_error * 100).toFixed(2)}% | Brier Score: ${calibrated_brier_score.toFixed(4)}`);
    console.log(`  Data-Derived Auto-Approve: P >= ${derived_data_thresholds.auto_approve_threshold} (Historical accuracy >= 95%)`);
    console.log(`  Data-Derived Review Flag:  P <  ${derived_data_thresholds.review_threshold}`);

    final_calibration_results_by_task[task_name_key] = {
      status: is_provisional_task ? "provisional" : "calibrated",
      is_provisional: is_provisional_task,
      sample_count: raw_probability_scores_list.length,
      boundary_pegged: temperature_fitting_result.boundary_pegged,
      pegged_boundary_type: temperature_fitting_result.pegged_boundary_type,
      search_bounds: temperature_fitting_result.search_bounds,
      provisional_warning: is_provisional_task ? provisional_reasons_list.join(" ") : null,
      uncalibrated_ece: Number(uncalibrated_expected_calibration_error.toFixed(4)),
      uncalibrated_brier: Number(uncalibrated_brier_score.toFixed(4)),
      fitted_temperature: temperature_fitting_result.fitted_temperature,
      calibrated_ece: Number(calibrated_expected_calibration_error.toFixed(4)),
      calibrated_brier: Number(calibrated_brier_score.toFixed(4)),
      auto_approve_threshold: derived_data_thresholds.auto_approve_threshold,
      review_threshold: derived_data_thresholds.review_threshold
    };
  }

  const is_any_task_provisional = Object.values(final_calibration_results_by_task).some(
    (single_task_summary) => single_task_summary.is_provisional
  );

  const output_configuration_payload = {
    updated_at: new Date().toISOString(),
    status: is_any_task_provisional ? "provisional" : "calibrated",
    is_provisional: is_any_task_provisional,
    provisional_disclaimer: is_any_task_provisional
      ? `All calibration metrics in this configuration are provisional until at least ${RECOMMENDED_MINIMUM_RELIABLE_SAMPLE_SIZE} human verdicts per task have been logged without optimizer boundary pegging.`
      : null,
    log_source: path_module.relative(path_module.join(__dirname, ".."), CALIBRATION_LOG_FILE_PATH).replace(/\\/g, "/") || "benchmarks/qc_calibration_log.jsonl",
    tasks: final_calibration_results_by_task
  };

  filesystem_module.writeFileSync(CALIBRATED_CONFIG_OUTPUT_PATH, JSON.stringify(output_configuration_payload, null, 2), "utf8");
  console.log(`\n==========================================================================`);
  console.log(`Phase 5 Config Saved to: ${CALIBRATED_CONFIG_OUTPUT_PATH}`);
  console.log(`Status: ${output_configuration_payload.status.toUpperCase()} (Provisional: ${output_configuration_payload.is_provisional})`);
  console.log(`==========================================================================\n`);
}

execute_full_qc_calibration_analysis();

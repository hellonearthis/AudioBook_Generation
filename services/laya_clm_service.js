// =========================================================================
// LAYA & CLM DECISION ENGINES AND QC CALIBRATION SERVICE
// =========================================================================
// WHAT: Handles sub-25ms ModernBERT dialogue attribution (Laya), contrastive attribution (CLM-8B),
//       cascade escalation, and empirical QC calibration tracking (Gate 2 & 3).
// WHY: Decouples fast non-autoregressive classification and calibration logging from LLM parsing.

const path_library = require("path");
const filesystem_library = require("fs");
const child_process_library = require("child_process");
const http_client_library = require("http");
const { LayaQCPipeline } = require("../laya_qc_pipeline");
const {
  normalize_localhost_url_to_ipv4_address,
  release_comfyui_vram,
  ensure_laya_ready,
  ensure_clm_ready
} = require("./service_health_service");
const {
  attributeSpeakersAcrossParagraphs,
  extract_sorted_review_queue_from_results,
  UNKNOWN_SPEAKER_IDENTIFIER
} = require("./speaker_attribution");
const { map_emotion_to_auk08_palette } = require("./relationship_state_service");

const laya_qc_pipeline_instance = new LayaQCPipeline();

// WHAT: Resolves clean /decide path for Laya ModernBERT server.
function resolve_laya_decide_url(base_url) {
  let clean = (base_url || "http://127.0.0.1:8765").trim().replace(/\/+$/, "");
  if (!clean.endsWith("/decide")) {
    clean = `${clean}/decide`;
  }
  return clean;
}

// WHAT: Resolves clean /v1/systemone path for CLM server.
function resolve_clm_systemone_url(base_url) {
  let clean = (base_url || "http://127.0.0.1:8700").trim().replace(/\/+$/, "");
  if (!clean.endsWith("/v1/systemone")) {
    if (clean.endsWith("/v1")) {
      clean = `${clean}/systemone`;
    } else {
      clean = `${clean}/v1/systemone`;
    }
  }
  return clean;
}

// WHAT: Local helper to dispatch POST requests to Laya or CLM.
// WHY: Centralizes HTTP communication to local decision engine servers with timeout guards and JSON parsing.
function dispatch_fast_json_post(target_endpoint_url_string, request_payload_object) {
  return new Promise((resolve_json_post, reject_json_post) => {
    try {
      const ipv4_safe_endpoint_url = normalize_localhost_url_to_ipv4_address(target_endpoint_url_string);
      const parsed_endpoint_url_object = new URL(ipv4_safe_endpoint_url);
      const serialized_payload_string = JSON.stringify(request_payload_object);

      const http_post_client_request = http_client_library.request({
        hostname: parsed_endpoint_url_object.hostname,
        port: parsed_endpoint_url_object.port,
        path: parsed_endpoint_url_object.pathname,
        method: "POST",
        timeout: 30000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(serialized_payload_string)
        }
      }, (http_post_incoming_response) => {
        let accumulated_response_data_string = "";
        http_post_incoming_response.on("data", (data_chunk_buffer) => {
          accumulated_response_data_string += data_chunk_buffer;
        });
        http_post_incoming_response.on("end", () => {
          try {
            resolve_json_post(JSON.parse(accumulated_response_data_string));
          } catch (json_parsing_exception) {
            reject_json_post(new Error(`Failed to parse response: ${json_parsing_exception.message}`));
          }
        });
      });

      http_post_client_request.on("error", (request_transmission_error) => {
        reject_json_post(request_transmission_error);
      });
      http_post_client_request.setTimeout(30000, () => {
        http_post_client_request.destroy();
        reject_json_post(new Error("Decision engine request timed out after 30s"));
      });
      http_post_client_request.write(serialized_payload_string);
      http_post_client_request.end();
    } catch (unexpected_dispatch_error) {
      reject_json_post(unexpected_dispatch_error);
    }
  });
}

// WHAT: Creates a Laya classifier adapter adhering to the Pass 2 attribution interface.
// WHY: Allows the two-stage attribution engine to query ModernBERT with forward & reverse options.
function create_laya_speaker_attribution_adapter(laya_decide_target_url) {
  return {
    name: "laya",
    async choose({ context, question, options }) {
      const candidate_criteria_map = {};
      options.forEach((single_option) => {
        candidate_criteria_map[single_option.id] = `dialogue spoken by ${single_option.label}`;
      });
      const decide_request_payload = {
        state: {
          quote: context,
          preceding_context: "",
          following_context: "",
          full_paragraph: context
        },
        questions: {
          speaker: {
            type: "choice",
            instructions: question,
            criteria: candidate_criteria_map
          }
        }
      };
      const laya_response = await dispatch_fast_json_post(laya_decide_target_url, decide_request_payload);
      const speaker_answer = (laya_response && laya_response.answers && laya_response.answers.speaker) || {};
      const candidate_scores_map = speaker_answer.scores || {};
      if (Object.keys(candidate_scores_map).length === 0 && speaker_answer.choice) {
        const confidence_value = typeof speaker_answer.confidence === "number" ? speaker_answer.confidence : 0.75;
        const remainder_share = options.length > 1 ? (1.0 - confidence_value) / (options.length - 1) : 0;
        options.forEach((single_option) => {
          candidate_scores_map[single_option.id] = (single_option.id === speaker_answer.choice) ? confidence_value : remainder_share;
        });
      }
      return { scores: candidate_scores_map };
    }
  };
}

// WHAT: Creates a CLM-8B classifier adapter adhering to the Pass 2 attribution interface.
// WHY: Allows contrastive attribution with option flipping and score distributions.
function create_clm_speaker_attribution_adapter(clm_systemone_target_url) {
  return {
    name: "clm",
    async choose({ context, question, options }) {
      const candidate_criteria_map = {};
      options.forEach((single_option) => {
        candidate_criteria_map[single_option.id] = `dialogue spoken by ${single_option.label}`;
      });
      const decide_request_payload = {
        state: {
          quote: context,
          preceding_context: "",
          following_context: "",
          full_paragraph: context
        },
        questions: {
          speaker: {
            type: "choice",
            instructions: question,
            criteria: candidate_criteria_map
          }
        }
      };
      const clm_response = await dispatch_fast_json_post(clm_systemone_target_url, decide_request_payload);
      const speaker_answer = (clm_response && clm_response.answers && clm_response.answers.speaker) || {};
      const candidate_scores_map = speaker_answer.scores || {};
      if (Object.keys(candidate_scores_map).length === 0 && speaker_answer.choice) {
        const confidence_value = typeof speaker_answer.confidence === "number" ? speaker_answer.confidence : 0.75;
        const remainder_share = options.length > 1 ? (1.0 - confidence_value) / (options.length - 1) : 0;
        options.forEach((single_option) => {
          candidate_scores_map[single_option.id] = (single_option.id === speaker_answer.choice) ? confidence_value : remainder_share;
        });
      }
      return { scores: candidate_scores_map };
    }
  };
}

function register_laya_clm_handlers(ipcMain, getDetectUnmarkedSpans) {
  // WHAT: Checks health status of the local Laya Decision Engine (FastAPI on port 8765).
  // WHY: Verifies Laya is running and reports currently loaded classification models.
  ipcMain.handle("ai:laya-status", async (ipc_event_context, request_arguments) => {
    const laya_endpoint_url = (request_arguments && request_arguments.laya_endpoint_url) || "http://127.0.0.1:8765";
    return new Promise((resolve_callback_function) => {
      try {
        const ipv4_safe_url = normalize_localhost_url_to_ipv4_address(laya_endpoint_url);
        const parsed_url = new URL(ipv4_safe_url);
        const health_path = parsed_url.pathname.endsWith("/") ? `${parsed_url.pathname}health` : `${parsed_url.pathname}/health`;

        const health_request = http_client_library.get({
          hostname: parsed_url.hostname,
          port: parsed_url.port || 8765,
          path: health_path,
          timeout: 2000,
          headers: { "Accept": "application/json" }
        }, (native_response) => {
          let accumulated_health_response_data = "";
          native_response.on("data", (data_chunk_buffer) => {
            accumulated_health_response_data += data_chunk_buffer;
          });
          native_response.on("end", () => {
            try {
              const parsed_body = JSON.parse(accumulated_health_response_data);
              resolve_callback_function({
                online: native_response.statusCode === 200,
                statusCode: native_response.statusCode,
                device: parsed_body.device || "unknown",
                loaded_models: parsed_body.loaded_models || []
              });
            } catch {
              resolve_callback_function({ online: native_response.statusCode === 200, statusCode: native_response.statusCode });
            }
          });
        });

        health_request.on("error", () => {
          resolve_callback_function({ online: false, error: "Connection refused" });
        });

        health_request.on("timeout", () => {
          health_request.destroy();
          resolve_callback_function({ online: false, error: "Request timed out" });
        });
      } catch (health_check_exception) {
        resolve_callback_function({ online: false, error: health_check_exception.message });
      }
    });
  });

  // WHAT: Checks health status of the local CLM Decision Engine (FastAPI on port 8700).
  // WHY: Verifies CLM-8B is running and ready for contrastive attribution.
  ipcMain.handle("ai:clm-status", async (ipc_event_context, request_arguments) => {
    const clm_endpoint_url = (request_arguments && request_arguments.clm_endpoint_url) || "http://127.0.0.1:8700";
    return new Promise((resolve_callback_function) => {
      try {
        const ipv4_safe_url = normalize_localhost_url_to_ipv4_address(clm_endpoint_url);
        const parsed_url = new URL(ipv4_safe_url);
        const health_path = parsed_url.pathname.endsWith("/") ? `${parsed_url.pathname}health` : `${parsed_url.pathname}/health`;

        const health_request = http_client_library.get({
          hostname: parsed_url.hostname,
          port: parsed_url.port || 8700,
          path: health_path,
          timeout: 2000,
          headers: { "Accept": "application/json" }
        }, (native_response) => {
          let accumulated_health_response_data = "";
          native_response.on("data", (data_chunk_buffer) => {
            accumulated_health_response_data += data_chunk_buffer;
          });
          native_response.on("end", () => {
            try {
              const parsed_body = JSON.parse(accumulated_health_response_data);
              resolve_callback_function({
                online: native_response.statusCode === 200,
                statusCode: native_response.statusCode,
                embedder: parsed_body.embedder || "unknown",
                status: parsed_body.status || "ok"
              });
            } catch {
              resolve_callback_function({ online: native_response.statusCode === 200, statusCode: native_response.statusCode });
            }
          });
        });

        health_request.on("error", (request_transmission_error) => {
          resolve_callback_function({ online: false, error: request_transmission_error.message || "Connection refused" });
        });

        health_request.on("timeout", () => {
          health_request.destroy();
          resolve_callback_function({ online: false, error: "Request timed out" });
        });
      } catch (health_check_exception) {
        resolve_callback_function({ online: false, error: health_check_exception.message });
      }
    });
  });

  // WHAT: Returns current calibration log stats (logged decision counts, task breakdown).
  // WHAT: Aggregates calibration statistics and ground truth annotations across QC logs.
  // WHY: Displays empirical calibration coverage, provisional flags, and ground truth ratios in the UI.
  ipcMain.handle("ai:get-qc-calibration-stats", async () => {
    const recorded_decision_entries = laya_qc_pipeline_instance.loadLoggedDecisions();
    const task_summary_breakdown = {};
    let accumulated_ground_truth_count = 0;

    for (const logged_decision_record of recorded_decision_entries) {
      const active_task_name = logged_decision_record.question_type || logged_decision_record.task || "unknown";
      if (!task_summary_breakdown[active_task_name]) {
        task_summary_breakdown[active_task_name] = { total: 0, with_ground_truth: 0, agreements: 0 };
      }
      task_summary_breakdown[active_task_name].total++;

      const has_annotated_ground_truth = (
        (logged_decision_record.human_verdict !== null && logged_decision_record.human_verdict !== undefined) ||
        (logged_decision_record.ground_truth !== null && logged_decision_record.ground_truth !== undefined)
      );

      if (has_annotated_ground_truth) {
        task_summary_breakdown[active_task_name].with_ground_truth++;
        accumulated_ground_truth_count++;
      }
      if (logged_decision_record.is_agreement) {
        task_summary_breakdown[active_task_name].agreements++;
      }
    }

    const calibrated_config_file_path = path_library.join(__dirname, "..", "benchmarks", "calibrated_qc_config.json");
    let fitted_profile_settings = null;
    if (filesystem_library.existsSync(calibrated_config_file_path)) {
      try {
        fitted_profile_settings = JSON.parse(filesystem_library.readFileSync(calibrated_config_file_path, "utf8"));
      } catch (file_read_error) {
        // WHAT: Handle transient read error or corrupted file gracefully.
        // WHY: Returns null profile without crashing IPC bridge.
      }
    }

    return {
      total_records: recorded_decision_entries.length,
      annotated_count: accumulated_ground_truth_count,
      tasks: task_summary_breakdown,
      fitted_profile: fitted_profile_settings,
      is_provisional: fitted_profile_settings ? Boolean(fitted_profile_settings.is_provisional) : true,
      provisional_disclaimer: fitted_profile_settings ? fitted_profile_settings.provisional_disclaimer : null
    };
  });

  // WHAT: Runs empirical temperature calibration fitting across accumulated decisions.
  // WHY: Fits temperature scalars to calibrate decision confidence against ground truth and refreshes active pipeline config.
  ipcMain.handle("ai:run-qc-calibration", async () => {
    const fit_script_path = path_library.join(__dirname, "..", "scripts", "fit_calibration.js");
    return new Promise((resolve_calibration_execution) => {
      child_process_library.exec(`node "${fit_script_path}"`, (execution_error, standard_output_text, standard_error_text) => {
        const calibrated_config_file_path = path_library.join(__dirname, "..", "benchmarks", "calibrated_qc_config.json");
        let fitted_profile_settings = null;
        if (filesystem_library.existsSync(calibrated_config_file_path)) {
          try {
            fitted_profile_settings = JSON.parse(filesystem_library.readFileSync(calibrated_config_file_path, "utf8"));
            // WHAT: Dynamically reload active pipeline calibration config in memory.
            // WHY: Ensures subsequent verification calls immediately use the updated temperature parameters.
            laya_qc_pipeline_instance.calibrationConfig = laya_qc_pipeline_instance.loadCalibrationConfig();
          } catch (file_read_error) {
            // WHAT: Fallback on parse failure.
          }
        }
        resolve_calibration_execution({
          success: !execution_error,
          output: standard_output_text,
          error: execution_error ? (standard_error_text || execution_error.message) : null,
          fitted_profile: fitted_profile_settings,
          is_provisional: fitted_profile_settings ? Boolean(fitted_profile_settings.is_provisional) : true,
          provisional_disclaimer: fitted_profile_settings ? fitted_profile_settings.provisional_disclaimer : null
        });
      });
    });
  });

  // WHAT: Records a human verdict on a logged decision record.
  ipcMain.handle("ai:record-human-verdict", async (ipc_event_context, request_arguments) => {
    const { id, verdict, notes } = request_arguments || {};
    if (!id) return { success: false, error: "Record ID required" };
    const updated = laya_qc_pipeline_instance.recordHumanVerdict(id, !!verdict, notes || null);
    return { success: updated, id, verdict: !!verdict };
  });

  // WHAT: Ultra-fast Dialogue Attribution & Emotional Staging via Laya.
  ipcMain.handle("ai:laya-attribute", async (ipc_event_context, request_arguments) => {
    const raw_text = request_arguments.book_text_segment || "";
    const book_text_segment = raw_text.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
    const attribution_engine = request_arguments.attribution_engine || "laya";
    const laya_endpoint_url = (request_arguments.laya_endpoint_url || "http://127.0.0.1:8765").replace(/\/+$/, "");
    const clm_endpoint_url = (request_arguments.clm_endpoint_url || "http://127.0.0.1:8700").replace(/\/+$/, "");
    const laya_decide_target_url = resolve_laya_decide_url(laya_endpoint_url);
    const clm_systemone_target_url = resolve_clm_systemone_url(clm_endpoint_url);
    const confidence_threshold = typeof request_arguments.confidence_threshold === "number" ? request_arguments.confidence_threshold : 0.55;
    const is_unmarked_mode = !!request_arguments.unmarked_dialogue_mode;
    const lm_studio_api_url_address = request_arguments.lm_studio_api_url_address || "http://127.0.0.1:8081/v1/chat/completions";
    const voice_mapping_context = request_arguments.voice_mapping_context || {};
    const existing_script_segments = Array.isArray(request_arguments.existing_script_segments) ? request_arguments.existing_script_segments : [];

    if (attribution_engine === "llm" || attribution_engine === "hybrid") {
      await release_comfyui_vram();
    }

    if (attribution_engine === "laya" || attribution_engine === "hybrid" || attribution_engine === "cascade") {
      await ensure_laya_ready(laya_endpoint_url);
    }
    if (attribution_engine === "clm" || attribution_engine === "cascade") {
      await ensure_clm_ready(clm_endpoint_url);
    }

    const candidate_speaker_criteria = {
      "Narrator": "narrative exposition, scene description, setting, third-person commentary, or unquoted thoughts"
    };

    const cast_names = Object.keys(voice_mapping_context);
    if (cast_names.length > 0) {
      cast_names.forEach((name) => {
        const char_meta = voice_mapping_context[name] || {};
        const gender = char_meta.gender ? `${char_meta.gender} voice` : "";
        const age = char_meta.age ? `${char_meta.age}` : "";
        const traits = char_meta.traits ? `traits: ${char_meta.traits}` : "";
        candidate_speaker_criteria[name] = `dialogue spoken by ${name}, ${[gender, age, traits].filter(Boolean).join(", ")}`;
      });
    } else {
      candidate_speaker_criteria["Character"] = "general spoken dialogue spoken by an active character";
    }

    const emotion_palette_criteria = {
      "calm": "neutral, steady, composed, matter-of-fact",
      "whisper": "soft whisper, secretive, intimate, hushed, breathy",
      "fearful": "scared, terrified, trembling, anxious, panicking",
      "angry": "shouting, aggressive, furious, irritated, sharp",
      "sad": "sorrowful, weeping, grieving, subdued, low energy",
      "happy": "cheerful, delighted, upbeat, laughing, warm",
      "excited": "energetic, eager, enthusiastic, overjoyed",
      "surprised": "shocked, startled, stunned, disbelief"
    };

    const quotation_regex = /"([^"]+)"/g;
    const script_segments = [];
    const start_timestamp = Date.now();
    let laya_queries_count = 0;

    const detect_spans_fn = typeof getDetectUnmarkedSpans === "function" ? getDetectUnmarkedSpans() : null;

    try {
      const paragraphs_list = book_text_segment.split(/\n+/).map(p => p.trim()).filter(Boolean);

      for (let p_idx = 0; p_idx < paragraphs_list.length; p_idx++) {
        const paragraph_string = paragraphs_list[p_idx];
        const quote_tasks = [];

        if (is_unmarked_mode && detect_spans_fn) {
          const paragraph_spans = await detect_spans_fn(paragraph_string, lm_studio_api_url_address);

          for (let s_idx = 0; s_idx < paragraph_spans.length; s_idx++) {
            const span_item = paragraph_spans[s_idx];
            if (span_item.type === "narrator") {
              script_segments.push({
                type: "narrator",
                speaker: "Narrator",
                text: span_item.text,
                direction: "calm, steady narration",
                confidence: 1.0,
                engine: "narrator"
              });
            } else {
              const span_pos = paragraph_string.indexOf(span_item.text);
              const context_before = span_pos > 0 ? paragraph_string.substring(Math.max(0, span_pos - 120), span_pos).trim() : "";
              const span_end = span_pos >= 0 ? span_pos + span_item.text.length : 0;
              const context_after = span_end > 0 ? paragraph_string.substring(span_end, Math.min(paragraph_string.length, span_end + 120)).trim() : "";

              quote_tasks.push({
                quote_text: span_item.text,
                context_state: {
                  quote: span_item.text,
                  preceding_context: context_before,
                  following_context: context_after,
                  full_paragraph: paragraph_string
                },
                unmarked: true
              });
            }
          }
        } else {
          let match = null;
          let last_index = 0;

          while ((match = quotation_regex.exec(paragraph_string)) !== null) {
            if (match.index > last_index) {
              const pre_text = paragraph_string.substring(last_index, match.index).trim();
              if (pre_text) {
                script_segments.push({
                  type: "narrator",
                  speaker: "Narrator",
                  text: pre_text,
                  direction: "calm, steady narration",
                  confidence: 1.0,
                  engine: "narrator"
                });
              }
            }

            const quote_text = match[1].trim();
            const quote_start = match.index;
            const quote_end = quotation_regex.lastIndex;

            const context_before = paragraph_string.substring(Math.max(0, quote_start - 120), quote_start).trim();
            const context_after = paragraph_string.substring(quote_end, Math.min(paragraph_string.length, quote_end + 120)).trim();

            quote_tasks.push({
              quote_text,
              context_state: {
                quote: quote_text,
                preceding_context: context_before,
                following_context: context_after,
                full_paragraph: paragraph_string
              },
              unmarked: false
            });

            last_index = quotation_regex.lastIndex;
          }

          if (last_index < paragraph_string.length) {
            const post_text = paragraph_string.substring(last_index).trim();
            if (post_text) {
              script_segments.push({
                type: "narrator",
                speaker: "Narrator",
                text: post_text,
                direction: "calm, steady narration",
                confidence: 1.0,
                engine: "narrator"
              });
            }
          }

          if (quote_tasks.length === 0 && paragraph_string) {
            script_segments.push({
              type: "narrator",
              speaker: "Narrator",
              text: paragraph_string,
              direction: "calm, steady narration",
              confidence: 1.0,
              engine: "narrator"
            });
          }
        }

        if (quote_tasks.length > 0) {
          laya_queries_count += quote_tasks.length;
          const laya_predictions = await Promise.all(
            quote_tasks.map(async (task_item) => {
              const decide_payload = {
                state: task_item.context_state,
                questions: {
                  speaker: {
                    type: "choice",
                    instructions: "Which character speaks this dialogue based on the surrounding context and speech tags?",
                    criteria: candidate_speaker_criteria
                  },
                  emotion: {
                    type: "choice",
                    instructions: "What is the emotional tone or delivery style for this spoken dialogue?",
                    criteria: emotion_palette_criteria
                  },
                  energy: {
                    type: "score",
                    instructions: "Rate the vocal intensity or volume of this spoken line",
                    criteria: ["soft / intimate murmur", "moderate / normal conversational volume", "intense / shouting / forceful"]
                  }
                }
              };

              if (attribution_engine === "clm") {
                const clm_response = await dispatch_fast_json_post(clm_systemone_target_url, decide_payload);
                return {
                  quote_text: task_item.quote_text,
                  unmarked: task_item.unmarked,
                  answers: clm_response.answers || {},
                  engine: "clm"
                };
              }

              const laya_response = await dispatch_fast_json_post(laya_decide_target_url, decide_payload);
              let active_answers = laya_response.answers || {};
              let resolved_engine = "laya";

              if (attribution_engine === "cascade") {
                const speaker_ans = active_answers.speaker || {};
                const conf = typeof speaker_ans.confidence === "number" ? speaker_ans.confidence : 0.5;
                if (conf < 0.85) {
                  try {
                    const clm_response = await dispatch_fast_json_post(clm_systemone_target_url, decide_payload);
                    if (clm_response && clm_response.answers && clm_response.answers.speaker) {
                      active_answers = clm_response.answers;
                      resolved_engine = "clm_cascade";
                    }
                  } catch (clm_cascade_error) {
                    console.warn("Cascade escalation to CLM failed, keeping Laya prediction:", clm_cascade_error.message);
                  }
                }
              }

              return {
                quote_text: task_item.quote_text,
                unmarked: task_item.unmarked,
                answers: active_answers,
                engine: resolved_engine
              };
            })
          );

          laya_predictions.forEach((single_prediction_entry) => {
            const speaker_answer = single_prediction_entry.answers.speaker || {};
            const emotion_answer = single_prediction_entry.answers.emotion || {};
            const energy_answer = single_prediction_entry.answers.energy || {};

            let resolved_speaker = speaker_answer.choice || "Character";
            const speaker_confidence = typeof speaker_answer.confidence === "number" ? speaker_answer.confidence : 0.5;
            const detected_emotion = emotion_answer.choice || "calm";
            const energy_score = typeof energy_answer.score === "number" ? energy_answer.score : 1.0;

            let delivery_description = `${detected_emotion} delivery, ${energy_score > 1.3 ? "high intensity" : (energy_score < 0.7 ? "soft subdued tone" : "moderate conversational energy")}`;
            if (detected_emotion === "whisper") {
              delivery_description = "soft intimate whisper, hushed breathy delivery";
            }

            // WHAT: Correlating with existing reference segments to respect user locks and generate diffs.
            // WHY: User edits are protected ground truth. Divergent AI predictions become reviewable diffs.
            const matching_existing_segment = existing_script_segments.find((candidate_segment) => {
              return candidate_segment.type === "dialogue" && candidate_segment.text && candidate_segment.text.trim() === single_prediction_entry.quote_text.trim();
            });

            let final_speaker = resolved_speaker;
            let proposed_diff = null;
            let is_user_locked = false;

            if (matching_existing_segment && matching_existing_segment.is_user_locked && matching_existing_segment.speaker) {
              final_speaker = matching_existing_segment.speaker;
              is_user_locked = true;
            } else if (
              matching_existing_segment &&
              matching_existing_segment.speaker &&
              matching_existing_segment.speaker !== "unknown" &&
              matching_existing_segment.speaker !== "Character" &&
              matching_existing_segment.speaker !== resolved_speaker
            ) {
              proposed_diff = {
                previous_speaker: matching_existing_segment.speaker,
                proposed_speaker: resolved_speaker,
                confidence: speaker_confidence,
                engine: single_prediction_entry.engine || "laya"
              };
              final_speaker = matching_existing_segment.speaker;
            }

            script_segments.push({
              type: "dialogue",
              speaker: final_speaker,
              text: single_prediction_entry.quote_text,
              direction: delivery_description,
              confidence: is_user_locked ? 1.0 : speaker_confidence,
              emotion: detected_emotion,
              energy: energy_score,
              is_ambiguous: is_user_locked ? false : (speaker_confidence < confidence_threshold || !!proposed_diff),
              unmarked: !!single_prediction_entry.unmarked,
              engine: single_prediction_entry.engine || "laya",
              audioPath: matching_existing_segment ? (matching_existing_segment.audioPath || null) : null,
              audioVersions: matching_existing_segment && Array.isArray(matching_existing_segment.audioVersions) ? matching_existing_segment.audioVersions : [],
              workflowOverride: matching_existing_segment ? (matching_existing_segment.workflowOverride || null) : null,
              is_user_locked: is_user_locked,
              proposed_diff: proposed_diff
            });
          });
        }
      }

      const elapsed_duration_ms = Date.now() - start_timestamp;
      return {
        script_segments,
        unmarked_mode: is_unmarked_mode,
        performance: {
          total_segments: script_segments.length,
          laya_queries: laya_queries_count,
          elapsed_ms: elapsed_duration_ms,
          avg_ms_per_query: laya_queries_count > 0 ? Number((elapsed_duration_ms / laya_queries_count).toFixed(1)) : 0
        }
      };
    } catch (laya_error) {
      if (attribution_engine === "hybrid") {
        return {
          script_segments: [],
          fallback_reason: `Connection refused to decision engine: ${laya_error.message}`
        };
      }
      console.error("Attribution engine failed, falling back to local rule-based parser.", laya_error);
      const fallback_script_segments = [];
      const paragraphs_list = book_text_segment.split(/\n+/);
      for (let p_idx = 0; p_idx < paragraphs_list.length; p_idx++) {
        const p_str = paragraphs_list[p_idx].trim();
        if (!p_str) continue;

        const q_regex = /"([^"]+)"/g;
        let m = null;
        let last_pos = 0;
        while ((m = q_regex.exec(p_str)) !== null) {
          if (m.index > last_pos) {
            const pre = p_str.substring(last_pos, m.index).trim();
            if (pre) fallback_script_segments.push({ type: "narrator", speaker: "Narrator", text: pre, direction: "calm, steady narration" });
          }
          fallback_script_segments.push({ type: "dialogue", speaker: "Character", text: m[1], direction: "expressive delivery", confidence: 0.5 });
          last_pos = q_regex.lastIndex;
        }
        if (last_pos < p_str.length) {
          const post = p_str.substring(last_pos).trim();
          if (post) fallback_script_segments.push({ type: "narrator", speaker: "Narrator", text: post, direction: "calm, steady narration" });
        }
      }
      return { script_segments: fallback_script_segments, fallback_reason: laya_error.message, unmarked_mode: is_unmarked_mode };
    }
  });
}

module.exports = {
  register_laya_clm_handlers,
  laya_qc_pipeline_instance
};

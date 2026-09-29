// =========================================================================
// AI PIPELINE & LLM ORCHESTRATION SERVICE
// =========================================================================
// WHAT: Handles communication with local LLMs (llama-server / OpenAI-compatible API),
//       resilient balanced JSON extraction for reasoning models, Pass 1 Cast Discovery,
//       Pass 2 Dialogue Attribution, unmarked dialogue span detection, directorial scripts,
//       and style merging.
// WHY: Isolates prompt templating, LLM API dispatch, and grammar parsing away from the entry file.

const path_library = require("path");
const filesystem_library = require("fs");
const http_client_library = require("http");
const { app } = require("electron");
const { LayaQCPipeline } = require("../laya_qc_pipeline");
const {
  normalize_localhost_url_to_ipv4_address,
  release_comfyui_vram,
  probe_service_health
} = require("./service_health_service");
const {
  format_active_relationships_summary_for_prompt,
  merge_relationship_state_deltas,
  map_emotion_to_auk08_palette
} = require("./relationship_state_service");
const {
  RELATION_TYPES,
  RELATION_TONES,
  STATUSES,
  POWER_DYNAMICS,
  format_enum_as_pipe_list,
  format_enum_as_bracket_list
} = require("../constants/relationship_taxonomy");

// WHAT: Pre-formatted relationship taxonomy placeholders shared by every prompt that
//       documents relation_type / relation_tone / status / power_dynamic.
// WHY: Prevents each prompt-loading call site below from having to know the two
//      text formats (bracket-list for prose rules, pipe-list for schema examples).
const RELATIONSHIP_TAXONOMY_PROMPT_PLACEHOLDERS = {
  "{{RELATION_TYPE_ENUM_LIST}}": format_enum_as_bracket_list(RELATION_TYPES),
  "{{RELATION_TONE_ENUM_LIST}}": format_enum_as_bracket_list(RELATION_TONES),
  "{{STATUS_ENUM_LIST}}": format_enum_as_bracket_list(STATUSES),
  "{{POWER_DYNAMIC_ENUM_LIST}}": format_enum_as_bracket_list(POWER_DYNAMICS),
  "{{RELATION_TYPE_ENUM_PIPE}}": format_enum_as_pipe_list(RELATION_TYPES),
  "{{RELATION_TONE_ENUM_PIPE}}": format_enum_as_pipe_list(RELATION_TONES),
  "{{STATUS_ENUM_PIPE}}": format_enum_as_pipe_list(STATUSES),
  "{{POWER_DYNAMIC_ENUM_PIPE}}": format_enum_as_pipe_list(POWER_DYNAMICS)
};

// WHAT: Substitutes every {{RELATIONSHIP_TAXONOMY_*}}-style placeholder in a loaded prompt template.
// WHY: Centralizes the substitution so a prompt can freely use any subset of the eight
//      placeholders above without each call site needing its own replace() chain.
function apply_relationship_taxonomy_placeholders(prompt_template_text) {
  let substituted_text = prompt_template_text;
  for (const [placeholder_token, replacement_value] of Object.entries(RELATIONSHIP_TAXONOMY_PROMPT_PLACEHOLDERS)) {
    substituted_text = substituted_text.split(placeholder_token).join(replacement_value);
  }
  return substituted_text;
}

// WHAT: Extracting the first valid JSON object or array from free-form LLM output text.
// WHY: Modern thinking/reasoning models (e.g. Qwen 3.8) may output valid JSON followed by verification notes
//      or internal self-reflection commentary. A naive slice(start) includes this trailing text, which breaks JSON.parse.
//      This function scans for balanced braces/brackets to isolate the exact JSON payload regardless of trailing commentary.
function extract_json_from_llm_response_text(raw_llm_output_text) {
  let clean_text = (raw_llm_output_text || "").trim();

  // 1. Attempt extracting from markdown code fences first (```json ... ```)
  const fence_match = clean_text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence_match) {
    try {
      const sanitized = fence_match[1].trim().replace(/\\([^"\\/bfnrtu])/g, '\\\\$1');
      return JSON.parse(sanitized);
    } catch {}
  }

  // 2. Direct parse attempt if raw text is already pure JSON
  try {
    const sanitized = clean_text.replace(/\\([^"\\/bfnrtu])/g, '\\\\$1');
    return JSON.parse(sanitized);
  } catch {}

  // WHAT: 3. Scan for balanced JSON blocks ({...} or [...]) within the model's textual response.
  // WHY: Many LLMs preface or conclude JSON output with conversational remarks or explanations.
  let text_search_offset_position = 0;
  let first_valid_parsed_structure = null;

  while (text_search_offset_position < clean_text.length) {
    let opening_bracket_index = -1;
    for (let character_scan_index = text_search_offset_position; character_scan_index < clean_text.length; character_scan_index++) {
      if (clean_text[character_scan_index] === "{" || clean_text[character_scan_index] === "[") {
        opening_bracket_index = character_scan_index;
        break;
      }
    }
    if (opening_bracket_index === -1) break;

    const opening_bracket_character = clean_text[opening_bracket_index];
    const closing_bracket_character = opening_bracket_character === "{" ? "}" : "]";
    let bracket_nesting_depth_counter = 0;
    let is_inside_string_literal = false;
    let is_currently_escaping_character = false;
    let matching_closing_bracket_index = -1;

    for (let character_evaluation_index = opening_bracket_index; character_evaluation_index < clean_text.length; character_evaluation_index++) {
      const current_evaluated_character = clean_text[character_evaluation_index];
      if (is_currently_escaping_character) {
        is_currently_escaping_character = false;
        continue;
      }
      if (current_evaluated_character === "\\") {
        is_currently_escaping_character = true;
        continue;
      }
      if (current_evaluated_character === '"') {
        is_inside_string_literal = !is_inside_string_literal;
        continue;
      }
      if (!is_inside_string_literal) {
        if (current_evaluated_character === opening_bracket_character) {
          bracket_nesting_depth_counter++;
        } else if (current_evaluated_character === closing_bracket_character) {
          bracket_nesting_depth_counter--;
          if (bracket_nesting_depth_counter === 0) {
            matching_closing_bracket_index = character_evaluation_index;
            break;
          }
        }
      }
    }

    if (matching_closing_bracket_index !== -1) {
      const candidate_json = clean_text.substring(opening_bracket_index, matching_closing_bracket_index + 1);
      const sanitized_json = candidate_json.replace(/\\([^"\\/bfnrtu])/g, '\\\\$1');
      try {
        const parsed = JSON.parse(sanitized_json);
        if (typeof parsed === "object" && parsed !== null) {
          if (parsed.cast || parsed.script_segments || parsed.spans || parsed.relationships || Array.isArray(parsed)) {
            return parsed;
          }
          if (!first_valid_parsed_structure) {
            first_valid_parsed_structure = parsed;
          }
        }
      } catch {}
      text_search_offset_position = matching_closing_bracket_index + 1;
    } else {
      const candidate_json_substring = clean_text.substring(opening_bracket_index);
      const sanitized_candidate_json = candidate_json_substring.replace(/\\([^"\\/bfnrtu])/g, '\\\\$1');
      try {
        return JSON.parse(sanitized_candidate_json);
      } catch {}
      break;
    }
  }

  if (first_valid_parsed_structure) {
    return first_valid_parsed_structure;
  }

  try {
    const error_log_path = path_library.join(app ? app.getPath("userData") : "./", "json_parse_error_log.txt");
    filesystem_library.writeFileSync(error_log_path, clean_text, "utf-8");
  } catch {}

  throw new Error("No JSON object or array found in LLM response text.");
}

// WHAT: Dispatches an HTTP POST request with a JSON payload to a specified local or remote endpoint.
function dispatch_http_post_request(target_endpoint_url_string, request_payload_object, getMainWindow = null) {
  return new Promise((resolve_callback_function, reject_callback_function) => {
    try {
      const ipv4_safe_endpoint_url_string = normalize_localhost_url_to_ipv4_address(target_endpoint_url_string);
      const parsed_url_object = new URL(ipv4_safe_endpoint_url_string);
      const stringified_payload = JSON.stringify(request_payload_object);

      const request_configuration_options = {
        hostname: parsed_url_object.hostname,
        port: parsed_url_object.port,
        path: parsed_url_object.pathname,
        method: "POST",
        timeout: 1200000, // 20 minutes max
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(stringified_payload)
        }
      };

      const native_http_request = http_client_library.request(request_configuration_options, (native_http_response) => {
        let concatenated_response_data_chunks = "";

        native_http_response.on("data", (data_chunk) => {
          concatenated_response_data_chunks += data_chunk;
        });

        native_http_response.on("end", () => {
          try {
            const parsed_response_json = JSON.parse(concatenated_response_data_chunks);

            let warning_messages_list = [];
            if (native_http_response.headers["x-warning"]) {
              warning_messages_list.push(native_http_response.headers["x-warning"]);
            }
            if (parsed_response_json.warning) {
              warning_messages_list.push(parsed_response_json.warning);
            }
            if (parsed_response_json.warnings && Array.isArray(parsed_response_json.warnings)) {
              warning_messages_list.push(...parsed_response_json.warnings);
            }
            const primary_window = typeof getMainWindow === "function" ? getMainWindow() : null;
            if (warning_messages_list.length > 0 && primary_window) {
              primary_window.webContents.send("system:lm-studio-warning", warning_messages_list.join(" | "));
            }

            resolve_callback_function(parsed_response_json);
          } catch (json_parsing_exception) {
            reject_callback_function(new Error("Failed to parse response JSON: " + json_parsing_exception.message));
          }
        });
      });

      native_http_request.on("error", (connection_network_error) => {
        reject_callback_function(connection_network_error);
      });

      native_http_request.setTimeout(600000, () => {
        native_http_request.destroy();
        reject_callback_function(new Error("LLM API request timed out after 600 seconds."));
      });

      native_http_request.write(stringified_payload);
      native_http_request.end();
    } catch (general_request_execution_exception) {
      reject_callback_function(general_request_execution_exception);
    }
  });
}

// WHAT: Dynamic model tag resolver querying local LLM models registry.
function retrieve_currently_loaded_model_tag(lm_studio_base_endpoint_url) {
  return new Promise((resolve_callback_function) => {
    try {
      const ipv4_safe_base_url = normalize_localhost_url_to_ipv4_address(lm_studio_base_endpoint_url);
      const parsed_endpoint_url = new URL(ipv4_safe_base_url);
      const target_models_list_path = parsed_endpoint_url.pathname.replace(/\/chat\/completions$/, "/models");

      http_client_library.get({
        hostname: parsed_endpoint_url.hostname,
        port: parsed_endpoint_url.port,
        path: target_models_list_path,
        headers: { "Accept": "application/json" }
      }, (native_http_response) => {
        let concatenated_chunks_buffer = "";
        native_http_response.on("data", (data_chunk) => { concatenated_chunks_buffer += data_chunk; });
        native_http_response.on("end", () => {
          try {
            const parsed_model_list_response = JSON.parse(concatenated_chunks_buffer);
            if (parsed_model_list_response && parsed_model_list_response.data && parsed_model_list_response.data.length > 0) {
              resolve_callback_function(parsed_model_list_response.data[0].id);
            } else {
              resolve_callback_function("qwen3.8-27b-abliterated");
            }
          } catch {
            resolve_callback_function("qwen3.8-27b-abliterated");
          }
        });
      }).on("error", () => {
        resolve_callback_function("qwen3.8-27b-abliterated");
      });
    } catch {
      resolve_callback_function("qwen3.8-27b-abliterated");
    }
  });
}

// WHAT: Saves raw LLM responses to a dedicated debug log folder within active project workspace.
function save_raw_llm_debug_log(workspace_directory_path, project_name_string, log_type_identifier_string, raw_response_content_string) {
  if (!workspace_directory_path || !project_name_string) {
    return;
  }
  try {
    const project_absolute_directory_path = path_library.join(workspace_directory_path, project_name_string);
    const debug_logs_absolute_directory_path = path_library.join(project_absolute_directory_path, "debug_logs");
    if (!filesystem_library.existsSync(debug_logs_absolute_directory_path)) {
      filesystem_library.mkdirSync(debug_logs_absolute_directory_path, { recursive: true });
    }
    const target_log_file_absolute_path = path_library.join(debug_logs_absolute_directory_path, `${log_type_identifier_string}_raw.txt`);
    filesystem_library.writeFileSync(target_log_file_absolute_path, raw_response_content_string, "utf8");
  } catch (log_creation_failure_exception) {
    console.error("Failed to archive raw LLM response to debug directory:", log_creation_failure_exception);
  }
}

// WHAT: Syntactic register & speech-tag rule parser for unmarked literary prose.
function parse_unmarked_dialogue_by_rules(paragraph_string) {
  if (!paragraph_string || !paragraph_string.trim()) return [];

  const spans = [];
  const sentences = paragraph_string.split(/(?<=[.?!])\s+/);
  const speech_verb_pattern = "(?:said|asked|replied|whispered|muttered|cried|shouted|yelled|breathed|growled|murmured|gasped|snapped|called|demanded|told|answered)";
  const speech_pronoun_pattern = "(?:he|she|they|the boy|the man|the girl|the woman|the doctor|the soldier|the kid|one of them|someone)";

  const suffix_tag_regex = new RegExp(`^(.+?)(?:,|\\s+)?\\s+(${speech_pronoun_pattern}\\s+${speech_verb_pattern}|${speech_verb_pattern}\\s+${speech_pronoun_pattern})([.?!]?.*)$`, "i");
  const prefix_tag_regex = new RegExp(`^(${speech_pronoun_pattern}\\s+${speech_verb_pattern}|${speech_verb_pattern}\\s+${speech_pronoun_pattern})(?:,|:)?\\s+(.+)$`, "i");
  const conversational_prefix_regex = /^(?:where|what|why|who|how|when|are you|is it|can we|will we|do you|don't|did you|look|listen|come on|hurry|wait|yes|no|yeah|nah|hell|god|oh|please)\b/i;

  let pending_narrator_text = "";

  for (let s_idx = 0; s_idx < sentences.length; s_idx++) {
    const raw_sentence = sentences[s_idx].trim();
    if (!raw_sentence) continue;

    let match = null;

    if ((match = suffix_tag_regex.exec(raw_sentence)) !== null) {
      const dialogue_part = match[1].trim().replace(/,\s*$/, "");
      const tag_part = (match[2] + (match[3] || "")).trim();

      if (pending_narrator_text) {
        spans.push({ type: "narrator", text: pending_narrator_text });
        pending_narrator_text = "";
      }

      if (dialogue_part) {
        spans.push({ type: "dialogue", text: dialogue_part, unmarked: true });
      }
      if (tag_part) {
        pending_narrator_text = tag_part;
      }
      continue;
    }

    if ((match = prefix_tag_regex.exec(raw_sentence)) !== null) {
      const tag_part = match[1].trim();
      const dialogue_part = match[2].trim();

      if (pending_narrator_text) {
        pending_narrator_text += " " + tag_part;
      } else {
        pending_narrator_text = tag_part;
      }

      spans.push({ type: "narrator", text: pending_narrator_text });
      pending_narrator_text = "";

      if (dialogue_part) {
        spans.push({ type: "dialogue", text: dialogue_part, unmarked: true });
      }
      continue;
    }

    if (raw_sentence.endsWith("?") || conversational_prefix_regex.test(raw_sentence)) {
      if (pending_narrator_text) {
        spans.push({ type: "narrator", text: pending_narrator_text });
        pending_narrator_text = "";
      }
      spans.push({ type: "dialogue", text: raw_sentence, unmarked: true });
      continue;
    }

    if (pending_narrator_text) {
      pending_narrator_text += " " + raw_sentence;
    } else {
      pending_narrator_text = raw_sentence;
    }
  }

  if (pending_narrator_text) {
    spans.push({ type: "narrator", text: pending_narrator_text });
  }

  return spans;
}

// WHAT: Detects spoken dialogue spans vs narration in literary text without quotation marks.
async function detect_unmarked_spans(paragraph_string, lm_studio_api_url) {
  if (!paragraph_string || !paragraph_string.trim()) return [];

  if (lm_studio_api_url) {
    try {
      await release_comfyui_vram();
      const span_prompt_path = path_library.join(__dirname, "..", "prompts", "unmarked_span_detection.txt");
      if (filesystem_library.existsSync(span_prompt_path)) {
        const span_instruction_prompt = filesystem_library.readFileSync(span_prompt_path, "utf8");
        const active_model_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url);
        const response_payload = await dispatch_http_post_request(lm_studio_api_url, {
          model: active_model_tag,
          messages: [
            { role: "system", content: span_instruction_prompt },
            { role: "user", content: paragraph_string }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 2048
        });

        if (response_payload && response_payload.choices && response_payload.choices.length > 0) {
          const content = ((response_payload.choices[0].message.content) || (response_payload.choices[0].message.reasoning_content) || "").trim();
          const parsed = extract_json_from_llm_response_text(content);
          const spans_array = Array.isArray(parsed) ? parsed : (parsed.spans || parsed.script_segments || []);
          if (spans_array.length > 0) {
            return spans_array.map(s => ({
              type: s.type === "dialogue" ? "dialogue" : "narrator",
              text: (s.text || "").trim(),
              unmarked: s.type === "dialogue"
            })).filter(s => s.text);
          }
        }
      }
    } catch (llm_span_error) {
      console.warn("Stage 2A LLM span detection failed, falling back to rule-based register parser.", llm_span_error.message);
    }
  }

  return parse_unmarked_dialogue_by_rules(paragraph_string);
}

// WHAT: Performs 1-pass joint span segmentation and speaker attribution for unmarked literary prose.
// WHY: In unmarked dialogue (e.g. McCarthy, Selby), isolated fragments lack speech tags and punctuation.
//      Evaluating the full paragraph in a single LLM pass increases speaker attribution accuracy from ~36-74% to 100%,
//      leveraging whole-paragraph context rather than fragmented post-split classifiers.
async function detect_unmarked_spans_joint(paragraph_string, lm_studio_api_url, character_names_list = []) {
  if (!paragraph_string || !paragraph_string.trim()) {
    return null;
  }

  if (lm_studio_api_url) {
    try {
      await release_comfyui_vram();
      const joint_prompt_path = path_library.join(__dirname, "..", "prompts", "unmarked_joint_attribution.txt");
      if (filesystem_library.existsSync(joint_prompt_path)) {
        const base_system_instructional_prompt = filesystem_library.readFileSync(joint_prompt_path, "utf8");
        const formatted_candidate_characters_list = character_names_list.length > 0
          ? [...character_names_list]
          : ["Narrator", "Character"];
        if (!formatted_candidate_characters_list.includes("Narrator")) {
          formatted_candidate_characters_list.push("Narrator");
        }
        const finalized_joint_system_prompt = `${base_system_instructional_prompt}\n\nAvailable Characters for this scene: ${JSON.stringify(formatted_candidate_characters_list)}`;
        const active_loaded_model_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url);

        const api_response_payload = await dispatch_http_post_request(lm_studio_api_url, {
          model: active_loaded_model_tag,
          messages: [
            { role: "system", content: finalized_joint_system_prompt },
            { role: "user", content: paragraph_string }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 2048
        });

        if (api_response_payload && api_response_payload.choices && api_response_payload.choices.length > 0) {
          const raw_completion_text = ((api_response_payload.choices[0].message.content) || (api_response_payload.choices[0].message.reasoning_content) || "").trim();
          const parsed_json_output = extract_json_from_llm_response_text(raw_completion_text);
          const extracted_spans_array = Array.isArray(parsed_json_output) ? parsed_json_output : (parsed_json_output.spans || parsed_json_output.script_segments || []);
          if (extracted_spans_array.length > 0) {
            return extracted_spans_array.map((single_span_item) => ({
              type: single_span_item.type === "dialogue" ? "dialogue" : "narrator",
              text: (single_span_item.text || "").trim(),
              speaker: single_span_item.type === "dialogue" ? (single_span_item.speaker || "Character") : "Narrator",
              emotion: single_span_item.emotion || "calm",
              energy: typeof single_span_item.energy === "number" ? single_span_item.energy : 0.5,
              unmarked: single_span_item.type === "dialogue"
            })).filter((single_span_item) => single_span_item.text);
          }
        }
      }
    } catch (llm_joint_error) {
      console.warn("Stage 2A Joint LLM span & attribution failed, cascading to decoupled detection.", llm_joint_error.message);
    }
  }

  return null;
}

// WHAT: Formats general metadata fields to a clean string.
function format_general_metadata_field_to_string(metadata_field_value) {
  if (typeof metadata_field_value === "string") {
    return metadata_field_value;
  }
  if (!metadata_field_value) {
    return "";
  }
  if (Array.isArray(metadata_field_value)) {
    const formatted_metadata_parts = [];
    for (let item_index = 0; item_index < metadata_field_value.length; item_index++) {
      const metadata_item = metadata_field_value[item_index];
      if (metadata_item && typeof metadata_item === "object") {
        formatted_metadata_parts.push(JSON.stringify(metadata_item));
      } else if (metadata_item) {
        formatted_metadata_parts.push(String(metadata_item));
      }
    }
    return formatted_metadata_parts.join(", ");
  }
  if (typeof metadata_field_value === "object") {
    return JSON.stringify(metadata_field_value);
  }
  return String(metadata_field_value);
}

// WHAT: Formats the discovered global cast mapping database into a structured system instructions block.
function compile_global_cast_system_context(voice_mapping_context) {
  if (!voice_mapping_context || Object.keys(voice_mapping_context).length === 0) {
    return "No predefined cast profiles exist for this project yet. Please parse general speaker identities dynamically.";
  }

  let compiled_cast_guide_string = "PREDEFINED CAST PROFILES FOR THIS STORY:\n\n";
  const character_keys_list = Object.keys(voice_mapping_context);

  for (let character_counter = 0; character_counter < character_keys_list.length; character_counter++) {
    const character_name_string = character_keys_list[character_counter];
    const character_profile_details = voice_mapping_context[character_name_string];

    const resolved_voice_profile_string = format_general_metadata_field_to_string(
      character_profile_details.voiceProfile || character_profile_details.baseVoice || character_profile_details.designPrompt || "Normal, standard voice."
    );
    const resolved_identity_background_string = format_general_metadata_field_to_string(
      character_profile_details.identityBackground || ""
    );
    const resolved_physical_appearance_string = format_general_metadata_field_to_string(
      character_profile_details.physicalAppearance || character_profile_details.visualDetails || ""
    );
    const resolved_personality_traits_string = format_general_metadata_field_to_string(
      character_profile_details.personalityTraits || character_profile_details.traits || ""
    );

    compiled_cast_guide_string += `- Character Name: "${character_name_string}"\n`;
    compiled_cast_guide_string += `  - Gender: ${character_profile_details.gender || "Unknown"}\n`;
    compiled_cast_guide_string += `  - Age: ${character_profile_details.age || "Adult"}\n`;
    compiled_cast_guide_string += `  - Voice Profile: ${resolved_voice_profile_string}\n`;
    compiled_cast_guide_string += `  - Identity & Background: ${resolved_identity_background_string || "No background details available."}\n`;
    compiled_cast_guide_string += `  - Physical Appearance: ${resolved_physical_appearance_string || "No appearance descriptions available."}\n`;
    compiled_cast_guide_string += `  - Personality Traits: ${resolved_personality_traits_string || "No personality profile available."}\n`;
    compiled_cast_guide_string += `  - Current Emotion: ${character_profile_details.currentEmotion || "neutral and observant."}\n`;
    compiled_cast_guide_string += `\n`;
  }

  return compiled_cast_guide_string;
}

function escape_regex_characters_for_literal_match(source_string_to_escape) {
  return source_string_to_escape.replace(/[\-\/\\\^\$\*\+\?\.\(\)\|\[\]\{\}]/g, "\\$&");
}

function divide_text_into_sliding_overlapping_windows(text_content, max_chunk_words = 1500, overlap_words = 150) {
  const sentence_pattern_regex = /[^.!?]+[.!?]+(?:\s+|$)/g;
  let sentence_matches_list = text_content.match(sentence_pattern_regex);

  if (!sentence_matches_list || sentence_matches_list.length === 0) {
    sentence_matches_list = text_content.split(/\n+/).filter(line_item => line_item.trim().length > 0);
  }
  if (sentence_matches_list.length === 0) {
    sentence_matches_list = [text_content];
  }

  const sentences_metadata_list = [];
  for (let index_counter = 0; index_counter < sentence_matches_list.length; index_counter++) {
    const raw_sentence_string = sentence_matches_list[index_counter];
    const sentence_words_count = raw_sentence_string.trim().split(/\s+/).filter(word => word.length > 0).length;
    sentences_metadata_list.push({
      text: raw_sentence_string,
      word_count: sentence_words_count
    });
  }

  let total_words_count = 0;
  for (let index_counter = 0; index_counter < sentences_metadata_list.length; index_counter++) {
    total_words_count += sentences_metadata_list[index_counter].word_count;
  }
  if (total_words_count <= max_chunk_words) {
    return [text_content];
  }

  const chunks_list = [];
  let start_sentence_index = 0;

  while (start_sentence_index < sentences_metadata_list.length) {
    let current_chunk_words_sum = 0;
    let end_sentence_index = start_sentence_index;

    while (end_sentence_index < sentences_metadata_list.length) {
      const next_sentence_word_count = sentences_metadata_list[end_sentence_index].word_count;
      if (current_chunk_words_sum + next_sentence_word_count > max_chunk_words && end_sentence_index > start_sentence_index) {
        break;
      }
      current_chunk_words_sum += next_sentence_word_count;
      end_sentence_index++;
    }

    const chunk_sentences_slice = sentences_metadata_list.slice(start_sentence_index, end_sentence_index);
    const chunk_text_content = chunk_sentences_slice.map(item => item.text).join("");
    chunks_list.push(chunk_text_content);

    if (end_sentence_index >= sentences_metadata_list.length) {
      break;
    }

    let overlap_words_sum = 0;
    let overlap_start_index = end_sentence_index - 1;

    while (overlap_start_index > start_sentence_index && overlap_words_sum < overlap_words) {
      overlap_words_sum += sentences_metadata_list[overlap_start_index].word_count;
      overlap_start_index--;
    }

    const next_start_candidate = overlap_start_index + 1;
    if (next_start_candidate <= start_sentence_index) {
      start_sentence_index = start_sentence_index + 1;
    } else {
      start_sentence_index = next_start_candidate;
    }
  }

  return chunks_list;
}

function generate_rule_based_directorial_fallback(text_segment_content) {
  const rule_based_fallback_segments = [];
  const split_paragraph_lines_list = text_segment_content.split(/\n+/);

  for (let line_index_counter = 0; line_index_counter < split_paragraph_lines_list.length; line_index_counter++) {
    const paragraph_string_line = split_paragraph_lines_list[line_index_counter].trim();
    if (!paragraph_string_line) continue;

    const matching_quotes_regex_pattern = /"([^"]+)"/g;
    let matched_regex_substring = null;
    let last_scanned_index_pointer = 0;

    while ((matched_regex_substring = matching_quotes_regex_pattern.exec(paragraph_string_line)) !== null) {
      if (matched_regex_substring.index > last_scanned_index_pointer) {
        const narrator_pre_quote_text = paragraph_string_line.substring(last_scanned_index_pointer, matched_regex_substring.index).trim();
        if (narrator_pre_quote_text) {
          rule_based_fallback_segments.push({
            type: "narrator",
            speaker: "Narrator",
            text: narrator_pre_quote_text,
            intent: "Ominous or standard storytelling description.",
            delivery: {
              pitch: "medium",
              pacing: "normal",
              volume: "normal",
              style_label: "neutral",
              emotion_vector: { happiness: 0.0, sadness: 0.0, anger: 0.0, fear: 0.0, surprise: 0.0, disgust: 0.0, neutral: 1.0, other: 0.0 }
            }
          });
        }
      }

      rule_based_fallback_segments.push({
        type: "dialogue",
        speaker: "Character",
        text: matched_regex_substring[1],
        intent: "Spoken line dialogue requiring expressive delivery.",
        delivery: {
          pitch: "medium",
          pacing: "normal",
          volume: "normal",
          style_label: "neutral",
          emotion_vector: { happiness: 0.0, sadness: 0.0, anger: 0.0, fear: 0.0, surprise: 0.0, disgust: 0.0, neutral: 1.0, other: 0.0 }
        }
      });

      last_scanned_index_pointer = matching_quotes_regex_pattern.lastIndex;
    }

    if (last_scanned_index_pointer < paragraph_string_line.length) {
      const narrator_post_quote_text = paragraph_string_line.substring(last_scanned_index_pointer).trim();
      if (narrator_post_quote_text) {
        rule_based_fallback_segments.push({
          type: "narrator",
          speaker: "Narrator",
          text: narrator_post_quote_text,
          intent: "Ominous or standard storytelling description.",
          delivery: {
            pitch: "medium",
            pacing: "normal",
            volume: "normal",
            style_label: "neutral",
            emotion_vector: { happiness: 0.0, sadness: 0.0, anger: 0.0, fear: 0.0, surprise: 0.0, disgust: 0.0, neutral: 1.0, other: 0.0 }
          }
        });
      }
    }
  }

  return rule_based_fallback_segments;
}

function register_ai_pipeline_handlers(ipcMain, getMainWindow) {
  // WHAT: Handler to perform Pass 1: Global Cast Discovery.
  ipcMain.handle("ai:extract-cast", async (ipc_event_context, request_arguments) => {
    const { book_text_segment, lm_studio_api_url_address, workspace_directory_path, project_name } = request_arguments;
    await release_comfyui_vram();

    const prompt_path = path_library.join(__dirname, "..", "prompts", "cast_discovery.txt");
    const system_instructional_prompt = apply_relationship_taxonomy_placeholders(
      filesystem_library.readFileSync(prompt_path, "utf8")
    );
    const user_input_content = `Extract characters from this book segment:\n\n${book_text_segment}`;

    const active_loaded_model_id_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url_address);

    try {
      const api_response_payload = await dispatch_http_post_request(lm_studio_api_url_address, {
        model: active_loaded_model_id_tag,
        messages: [
          { role: "system", content: system_instructional_prompt },
          { role: "user", content: user_input_content }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 4096
      }, getMainWindow);

      if (!api_response_payload.choices || api_response_payload.choices.length === 0) {
        if (api_response_payload.error) {
          const lm_error_description = (typeof api_response_payload.error === "string")
            ? api_response_payload.error
            : (api_response_payload.error.message || JSON.stringify(api_response_payload.error));
          throw new Error(`LLM API Error (llama.cpp): ${lm_error_description}`);
        }
        throw new Error(`Invalid response structure from LLM server (llama.cpp): ${JSON.stringify(api_response_payload)}`);
      }

      const active_choices_message_object = api_response_payload.choices[0].message;
      if (active_choices_message_object.refusal) {
        throw new Error(`LLM request was refused: ${active_choices_message_object.refusal}`);
      }

      const completion_content_text = ((active_choices_message_object.content) || (active_choices_message_object.reasoning_content) || "").trim();
      save_raw_llm_debug_log(workspace_directory_path, project_name, "cast_discovery", completion_content_text);

      const parsed_cast_data = extract_json_from_llm_response_text(completion_content_text);

      // Gate 1 (Character Presence) and Gate 2 (Relationship Citation) QC via Laya
      if (parsed_cast_data && Array.isArray(parsed_cast_data.cast)) {
        try {
          const laya_url = (request_arguments.laya_endpoint_url || "http://127.0.0.1:8765").replace(/\/+$/, "");
          const is_laya_online = await probe_service_health(`${laya_url}/health`);
          if (is_laya_online) {
            const laya_qc = new LayaQCPipeline({ layaEndpoint: laya_url });

            for (const char_item of parsed_cast_data.cast) {
              if (char_item.name && char_item.name.toLowerCase() !== "narrator") {
                const intro_text = char_item.cited_intro || book_text_segment.substring(0, 300);
                const qc_res = await laya_qc.verifyCharacterPresence({
                  characterName: char_item.name,
                  citedIntro: intro_text,
                  bookId: project_name || "default_book"
                });
                char_item.qc_status = {
                  id: qc_res.id,
                  decision: qc_res.decision,
                  raw_noul: qc_res.raw_probability,
                  raw_confidence: qc_res.raw_probability,
                  gate_status: qc_res.gate_status
                };
              }
            }

            if (Array.isArray(parsed_cast_data.relationships)) {
              for (const rel_item of parsed_cast_data.relationships) {
                const char_a_name = rel_item.a || rel_item.char_a;
                const char_b_name = rel_item.b || rel_item.char_b;
                const evidence_text = rel_item.cited_evidence || rel_item.notes;
                if (char_a_name && char_b_name && evidence_text) {
                  const rel_qc = await laya_qc.verifyRelationshipCitation({
                    charA: char_a_name,
                    charB: char_b_name,
                    relationType: rel_item.relation_type || "unknown",
                    citedEvidence: evidence_text,
                    bookId: project_name || "default_book"
                  });
                  rel_item.qc_status = {
                    id: rel_qc.id,
                    decision: rel_qc.decision,
                    alert_status: rel_qc.alert_status,
                    raw_noul: rel_qc.raw_probability,
                    raw_confidence: rel_qc.raw_probability,
                    gate_status: rel_qc.gate_status
                  };
                }
              }
            }
          }
        } catch (qc_exception) {
          console.warn("Laya Pass 1 QC verification skipped or failed:", qc_exception.message);
        }
      }

      return parsed_cast_data;
    } catch (api_failure_exception) {
      console.error("Cast extraction failed, applying standard fallback.", api_failure_exception);
      return {
        cast: [
          {
            id: "narrator",
            name: "Narrator",
            voice_profile: "A clear, neutral adult voice with balanced pitch and smooth, steady delivery.",
            identity_background: "The omniscient narrator of the story. An adult storyteller with no specific biographical details.",
            physical_appearance: "No physical description available. Standard prose narration presence.",
            personality_traits: "Calm, observant, and impartial. Delivers prose with measured neutrality and steady composure."
          }
        ]
      };
    }
  });

  // WHAT: Handler to perform Pass 2: Dialogue Attribution & Script Parsing.
  ipcMain.handle("ai:attribute-dialogue", async (ipc_event_context, request_arguments) => {
    await release_comfyui_vram();

    const raw_text = request_arguments.book_text_segment || "";
    const book_text_segment = raw_text.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
    const lm_studio_api_url_address = request_arguments.lm_studio_api_url_address;

    const prompt_path = path_library.join(__dirname, "..", "prompts", "script_formatting.txt");
    const system_instructional_prompt = filesystem_library.readFileSync(prompt_path, "utf8");

    const active_loaded_model_id_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url_address);

    try {
      const api_response_payload = await dispatch_http_post_request(lm_studio_api_url_address, {
        model: active_loaded_model_id_tag,
        messages: [
          { role: "system", content: system_instructional_prompt },
          { role: "user", content: book_text_segment }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 4096
      }, getMainWindow);

      if (!api_response_payload.choices || api_response_payload.choices.length === 0) {
        if (api_response_payload.error) {
          const lm_error_description = (typeof api_response_payload.error === "string")
            ? api_response_payload.error
            : (api_response_payload.error.message || JSON.stringify(api_response_payload.error));
          throw new Error(`LLM API Error (llama.cpp): ${lm_error_description}`);
        }
        throw new Error(`Invalid response structure from LLM server (llama.cpp): ${JSON.stringify(api_response_payload)}`);
      }

      const active_choices_message_object = api_response_payload.choices[0].message;
      if (active_choices_message_object.refusal) {
        throw new Error(`LLM request was refused: ${active_choices_message_object.refusal}`);
      }

      const completion_content_text = ((active_choices_message_object.content) || (active_choices_message_object.reasoning_content) || "").trim();
      const parsed_json = extract_json_from_llm_response_text(completion_content_text);
      const extracted_script_blocks = Array.isArray(parsed_json) ? parsed_json : (parsed_json.script_segments || []);

      // Gate 3 & Gate 4 QC via Laya
      try {
        const laya_url = (request_arguments.laya_endpoint_url || "http://127.0.0.1:8765").replace(/\/+$/, "");
        const laya_qc = new LayaQCPipeline({ layaEndpoint: laya_url });
        const candidate_chars = request_arguments.voice_mapping_context ? Object.keys(request_arguments.voice_mapping_context) : ["Narrator", "Character"];
        if (!candidate_chars.includes("Narrator")) candidate_chars.push("Narrator");

        for (let s_idx = 0; s_idx < extracted_script_blocks.length; s_idx++) {
          const seg = extracted_script_blocks[s_idx];
          if (seg.type === "dialogue") {
            const pre_text = s_idx > 0 ? (extracted_script_blocks[s_idx - 1].text || "").slice(-150) : "";
            const qc_res = await laya_qc.verifySpeakerAttribution({
              spokenText: seg.text,
              precedingText: pre_text,
              candidateCharacters: candidate_chars,
              qwenSpeaker: seg.speaker,
              bookId: request_arguments.project_name || "default_book"
            });

            seg.qc_verification = {
              id: qc_res.id,
              laya_choice: qc_res.laya_choice,
              is_agreement: qc_res.is_agreement,
              raw_confidence: qc_res.raw_probability,
              gate_status: qc_res.gate_status
            };

            if (seg.direction) {
              const emo_qc = await laya_qc.verifyEmotion({
                spokenText: seg.text,
                contextText: pre_text,
                qwenEmotion: seg.direction,
                bookId: request_arguments.project_name || "default_book"
              });
              seg.qc_emotion = {
                id: emo_qc.id,
                decision: emo_qc.decision,
                raw_noul: emo_qc.raw_probability,
                gate_status: emo_qc.gate_status
              };
            }
          }
        }
      } catch (qc_exception) {
        console.warn("Laya Pass 2 QC verification skipped or failed:", qc_exception.message);
      }

      return { script_segments: extracted_script_blocks };
    } catch (api_failure_exception) {
      console.error("Dialogue attribution failed, executing rule-based local parser.", api_failure_exception);
      const fallback_script_segments = [];
      const paragraphs_list = book_text_segment.split(/\n+/);

      for (let paragraph_index = 0; paragraph_index < paragraphs_list.length; paragraph_index++) {
        const paragraph_string = paragraphs_list[paragraph_index].trim();
        if (!paragraph_string) continue;

        const quotation_regex_pattern = /"([^"]+)"/g;
        let matched_substring_reference = null;
        let last_processed_index_position = 0;

        while ((matched_substring_reference = quotation_regex_pattern.exec(paragraph_string)) !== null) {
          if (matched_substring_reference.index > last_processed_index_position) {
            const pre_quote_narration = paragraph_string.substring(last_processed_index_position, matched_substring_reference.index).trim();
            if (pre_quote_narration) {
              fallback_script_segments.push({
                type: "narrator",
                speaker: "Narrator",
                text: pre_quote_narration,
                direction: "calm, steady narration"
              });
            }
          }

          fallback_script_segments.push({
            type: "dialogue",
            speaker: "Character",
            text: matched_substring_reference[1],
            direction: "expressive delivery"
          });

          last_processed_index_position = quotation_regex_pattern.lastIndex;
        }

        if (last_processed_index_position < paragraph_string.length) {
          const post_quote_narration = paragraph_string.substring(last_processed_index_position).trim();
          if (post_quote_narration) {
            fallback_script_segments.push({
              type: "narrator",
              speaker: "Narrator",
              text: post_quote_narration,
              direction: "calm, steady narration"
            });
          }
        }
      }

      return { script_segments: fallback_script_segments };
    }
  });

  // WHAT: Handler to split a single mixed dialogue/narrator cell.
  ipcMain.handle("ai:split-segment", async (ipc_event_context, request_arguments) => {
    await release_comfyui_vram();
    const { cell_text, lm_studio_api_url_address } = request_arguments;
    const normalized_cell_text = (cell_text || "")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");

    const split_cell_system_prompt = `You are a screenplay formatting engine. Your ONLY task is to split a single mixed line of text into separate screenplay JSON objects.

CRITICAL RULES:
- Output ONLY valid, raw JSON — a plain array starting with [
- Do NOT wrap output in markdown fences or add any text outside the JSON array
- "dialogue" segments contain ONLY the exact spoken words between quotation marks — strip the quotes
- "narrator" segments contain descriptions, actions, and attribution tags like "he said", "she whispered"
- Split EVERY dialogue from its surrounding narration into separate objects
- Preserve every word — do not drop or summarize anything

JSON SCHEMA:
[
  {
    "type": "narrator" | "dialogue",
    "speaker": "Character Name" | "Narrator",
    "text": "exact text here",
    "direction": "brief vocal delivery cue"
  }
]

EXAMPLE INPUT:
"Oh no," she whispered, her voice barely audible.

EXAMPLE OUTPUT:
[
  {
    "type": "dialogue",
    "speaker": "Unknown",
    "text": "Oh no,",
    "direction": "whispered, barely audible, quiet distress"
  },
  {
    "type": "narrator",
    "speaker": "Narrator",
    "text": "she whispered, her voice barely audible.",
    "direction": "soft observational narrator, falling intonation"
  }
]`;

    const active_loaded_model_id_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url_address);

    try {
      const api_response_payload = await dispatch_http_post_request(lm_studio_api_url_address, {
        model: active_loaded_model_id_tag,
        messages: [
          { role: "system", content: split_cell_system_prompt },
          { role: "user", content: normalized_cell_text }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 1024
      }, getMainWindow);

      if (!api_response_payload.choices || api_response_payload.choices.length === 0) {
        throw new Error("LLM returned no choices for segment split.");
      }

      const raw_split_response_text = ((api_response_payload.choices[0].message.content) || (api_response_payload.choices[0].message.reasoning_content) || "").trim();
      const parsed_split_result = extract_json_from_llm_response_text(raw_split_response_text);
      const extracted_split_segments = Array.isArray(parsed_split_result)
        ? parsed_split_result
        : (parsed_split_result.script_segments || []);

      return { success: true, segments: extracted_split_segments };
    } catch (split_api_failure_exception) {
      console.error("AI segment split failed:", split_api_failure_exception);
      return { success: false, error: split_api_failure_exception.message };
    }
  });

  // WHAT: Directorial Script Doctor Pass (Pass 3).
  ipcMain.handle("ai:generate-directorial-script", async (ipc_event_context, request_arguments) => {
    await release_comfyui_vram();
    const { book_text_segment, lm_studio_api_url_address, workspace_directory_path, project_name, voice_mapping_context, forced_speaker_id, sliding_window_context, relationships_context } = request_arguments;

    const compiled_cast_guide_context = compile_global_cast_system_context(voice_mapping_context);
    const active_scene_cast_members = Object.keys(voice_mapping_context || {}).map((character_name) => ({ id: character_name, name: character_name }));
    const formatted_relationships_summary = format_active_relationships_summary_for_prompt(
      active_scene_cast_members,
      relationships_context || [],
      0
    );

    const prompt_path = path_library.join(__dirname, "..", "prompts", "directorial_orchestration.txt");
    const directorial_system_prompt_instructions = apply_relationship_taxonomy_placeholders(
      filesystem_library.readFileSync(prompt_path, "utf8")
    )
      .replace("{{CAST_GUIDE_CONTEXT}}", compiled_cast_guide_context)
      .replace("{{RELATIONSHIP_TIMELINE_CONTEXT}}", formatted_relationships_summary);

    const active_loaded_model_id_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url_address);
    const text_windows_list = divide_text_into_sliding_overlapping_windows(book_text_segment, 1500, 150);
    const aggregated_script_segments_list = [];
    let raw_search_index_pointer = 0;

    try {
      for (let window_counter = 0; window_counter < text_windows_list.length; window_counter++) {
        const window_text_chunk = text_windows_list[window_counter];
        let user_input_content = `Extract and enrich the directorial script from this book segment:\n\n${window_text_chunk}`;

        if (forced_speaker_id) {
          user_input_content += `\n\nCRITICAL OVERRIDE: The user has manually assigned this exact segment to the speaker ID "${forced_speaker_id}". You MUST output EXACTLY ONE segment in your JSON array, set "speaker_id" to "${forced_speaker_id}", set the type appropriately ("narrator" if "${forced_speaker_id}" is "Narrator", otherwise "dialogue"), and ensure the qwen_synthesis_prompt perfectly reflects the vocal texture and acting persona of "${forced_speaker_id}" as defined in the cast dictionary.`;
          if (sliding_window_context) {
            user_input_content += `\n\nSLIDING CONTEXT WINDOW:\nTo determine the transient emotional state of this segment, analyze the following timeline excerpt:\n${sliding_window_context}`;
          }
        }

        const directorial_api_response_payload = await dispatch_http_post_request(lm_studio_api_url_address, {
          model: active_loaded_model_id_tag,
          messages: [
            { role: "system", content: directorial_system_prompt_instructions },
            { role: "user", content: user_input_content }
          ],
          response_format: { type: "json_object" },
          temperature: 0.2
        }, getMainWindow);

        if (!directorial_api_response_payload.choices || directorial_api_response_payload.choices.length === 0) {
          throw new Error("Invalid response from LLM during rolling cut pass.");
        }

        const first_returned_choices_message = directorial_api_response_payload.choices[0].message;
        const completion_content_text = ((first_returned_choices_message.content) || (first_returned_choices_message.reasoning_content) || "").trim();
        save_raw_llm_debug_log(workspace_directory_path, project_name, `directorial_script_chunk_${window_counter + 1}`, completion_content_text);

        const parsed_chunk_json = extract_json_from_llm_response_text(completion_content_text);

        if (parsed_chunk_json && parsed_chunk_json.script_segments) {
          for (let segment_counter = 0; segment_counter < parsed_chunk_json.script_segments.length; segment_counter++) {
            const segment_item = parsed_chunk_json.script_segments[segment_counter];

            if (segment_item.type === "state_update") {
              if (segment_item.speaker_id && segment_item.new_current_emotion) {
                if (!voice_mapping_context[segment_item.speaker_id]) {
                  voice_mapping_context[segment_item.speaker_id] = {};
                }
                voice_mapping_context[segment_item.speaker_id].currentEmotion = segment_item.new_current_emotion;
              }
              continue;
            }

            if (segment_item.speaker_id && voice_mapping_context[segment_item.speaker_id] && voice_mapping_context[segment_item.speaker_id].currentEmotion) {
              segment_item.active_emotion_state = voice_mapping_context[segment_item.speaker_id].currentEmotion;
            } else {
              segment_item.active_emotion_state = "neutral and observant.";
            }

            // WHAT: Normalizing extracted emotion to AuK-08 palette with explicit whisper routing.
            // WHY: Guarantees line delivery maps cleanly to AuK post-production workflows.
            const mapped_emotion_details = map_emotion_to_auk08_palette(
              typeof segment_item.emotion === "object" ? segment_item.emotion?.primary : segment_item.emotion,
              segment_item.direction || (segment_item.render && segment_item.render.instruction) || ""
            );
            segment_item.auk08_emotion = mapped_emotion_details.auk08_emotion;
            segment_item.is_whisper = mapped_emotion_details.is_whisper;
            segment_item.workflow_route = mapped_emotion_details.workflow_route;

            const segment_text = segment_item.text ? segment_item.text.trim() : "";
            if (!segment_text) continue;

            const escaped_segment_text = escape_regex_characters_for_literal_match(segment_text);
            const whitespace_resilient_pattern = escaped_segment_text.replace(/\s+/g, "\\s+");
            const search_regex = new RegExp(whitespace_resilient_pattern);
            const search_haystack = book_text_segment.substring(raw_search_index_pointer);
            const matched_result = search_regex.exec(search_haystack);

            if (matched_result) {
              const absolute_start_index = raw_search_index_pointer + matched_result.index;
              const absolute_end_index = absolute_start_index + matched_result[0].length;
              if (absolute_start_index >= raw_search_index_pointer) {
                aggregated_script_segments_list.push(segment_item);
                raw_search_index_pointer = absolute_end_index;
              }
            } else {
              const fallback_match = search_regex.exec(book_text_segment);
              if (fallback_match) {
                const fallback_start = fallback_match.index;
                if (fallback_start >= raw_search_index_pointer) {
                  aggregated_script_segments_list.push(segment_item);
                  raw_search_index_pointer = fallback_start + fallback_match[0].length;
                }
              } else {
                aggregated_script_segments_list.push(segment_item);
              }
            }
          }
        }
      }

      return { script_segments: aggregated_script_segments_list, voice_mapping_context: voice_mapping_context };
    } catch (api_failure_exception) {
      console.error("Directorial script parsing failed, executing rule-based fallback parser.", api_failure_exception);
      const rule_based_fallback_result = generate_rule_based_directorial_fallback(book_text_segment);
      return { script_segments: rule_based_fallback_result };
    }
  });

  // WHAT: Pass 2.5: Relationship Timeline Delta Detection Pass.
  // WHY: Evaluates whether dialogue in a scene triggered an interpersonal transition (e.g., betrayal, reconciliation).
  ipcMain.handle("ai:run-relationship-delta-pass", async (ipc_event_context, request_arguments) => {
    await release_comfyui_vram();
    const { scene_segments, current_relationships, active_scene_cast, lm_studio_api_url_address } = request_arguments;

    const prompt_path = path_library.join(__dirname, "..", "prompts", "relationship_delta.txt");
    if (!filesystem_library.existsSync(prompt_path)) {
      return { updated_relationships: current_relationships || [], changes: [] };
    }
    const delta_prompt_template = apply_relationship_taxonomy_placeholders(
      filesystem_library.readFileSync(prompt_path, "utf8")
    );

    const formatted_active_relationships = format_active_relationships_summary_for_prompt(
      active_scene_cast || [],
      current_relationships || [],
      scene_segments && scene_segments[0] ? (scene_segments[0].index_position || 0) : 0
    );

    const formatted_dialogue_lines = (scene_segments || [])
      .filter((segment_item) => segment_item.type === "dialogue")
      .map((segment_item) => `[SEGMENT ${segment_item.index_position}] ${segment_item.speaker}: "${segment_item.text}"`)
      .join("\n");

    if (!formatted_dialogue_lines) {
      return { updated_relationships: current_relationships || [], changes: [] };
    }

    const compiled_system_prompt = delta_prompt_template
      .replace("{{ACTIVE_RELATIONSHIPS}}", formatted_active_relationships)
      .replace("{{ATTRIBUTED_SEGMENTS}}", formatted_dialogue_lines);

    const active_loaded_model_id_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url_address);

    try {
      const api_response_payload = await dispatch_http_post_request(lm_studio_api_url_address, {
        model: active_loaded_model_id_tag,
        messages: [
          { role: "system", content: compiled_system_prompt },
          { role: "user", content: "Analyze these dialogue segments and output any relationship changes as specified in JSON." }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1
      }, getMainWindow);

      const response_message = api_response_payload.choices && api_response_payload.choices[0] && api_response_payload.choices[0].message;
      const completion_text = ((response_message && response_message.content) || "").trim();
      const parsed_delta_json = extract_json_from_llm_response_text(completion_text);
      const incoming_changes = (parsed_delta_json && parsed_delta_json.relationship_changes) || [];

      const updated_relationships = merge_relationship_state_deltas({
        existing_relationships_list: current_relationships || [],
        incoming_relationship_changes_list: incoming_changes
      });

      return {
        updated_relationships: updated_relationships,
        changes: incoming_changes
      };
    } catch (delta_pass_error) {
      console.warn("Pass 2.5 Relationship Delta pass encountered an error, keeping existing states:", delta_pass_error.message);
      return { updated_relationships: current_relationships || [], changes: [] };
    }
  });

  // WHAT: Handler to perform Pass 3: Contextual Stage Staging Directions.
  ipcMain.handle("ai:generate-emotional-staging", async (ipc_event_context, request_arguments) => {
    await release_comfyui_vram();
    const { preceding_context_lines, target_sentence_text, succeeding_context_lines, lm_studio_api_url_address } = request_arguments;

    const prompt_path = path_library.join(__dirname, "..", "prompts", "emotional_staging.txt");
    const system_instructional_prompt = filesystem_library.readFileSync(prompt_path, "utf8");

    const user_input_content = `Preceding context: ${preceding_context_lines.join(" | ")}
Target line: "${target_sentence_text}"
Succeeding context: ${succeeding_context_lines.join(" | ")}`;

    const active_loaded_model_id_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url_address);

    try {
      const api_response_payload = await dispatch_http_post_request(lm_studio_api_url_address, {
        model: active_loaded_model_id_tag,
        messages: [
          { role: "system", content: system_instructional_prompt },
          { role: "user", content: user_input_content }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      }, getMainWindow);

      if (!api_response_payload.choices || api_response_payload.choices.length === 0) {
        if (api_response_payload.error) {
          const lm_error_description = (typeof api_response_payload.error === "string")
            ? api_response_payload.error
            : (api_response_payload.error.message || JSON.stringify(api_response_payload.error));
          throw new Error(`LLM API Error (llama.cpp): ${lm_error_description}`);
        }
        throw new Error(`Invalid response structure from LLM server: ${JSON.stringify(api_response_payload)}`);
      }

      const active_choices_message_object = api_response_payload.choices[0].message;
      if (active_choices_message_object.refusal) {
        throw new Error(`LLM request was refused: ${active_choices_message_object.refusal}`);
      }

      const completion_content_text = ((active_choices_message_object.content) || (active_choices_message_object.reasoning_content) || "").trim();
      return extract_json_from_llm_response_text(completion_content_text);
    } catch (api_failure_exception) {
      console.error("Contextual staging failed, using neutral fallback.", api_failure_exception);
      return { direction: "natural narration, standard pace" };
    }
  });

  // WHAT: Smart Style Merger IPC handler.
  ipcMain.handle("llm:merge-qwen-styles", async (ipc_event_context, request_arguments) => {
    await release_comfyui_vram();
    const { cell1_text, cell1_style, cell2_text, cell2_style, transition_instructions, lm_studio_api_url_address } = request_arguments;

    const prompt_path = path_library.join(__dirname, "..", "prompts", "style_merger.txt");
    const system_instructional_prompt = filesystem_library.readFileSync(prompt_path, "utf8");

    const user_input_content = `Cell 1 Text: "${cell1_text}"
Cell 1 Style: ${JSON.stringify(cell1_style)}

Cell 2 Text: "${cell2_text}"
Cell 2 Style: ${JSON.stringify(cell2_style)}

Director's Transition Instructions: "${transition_instructions}"

Merge the styles of Cell 1 and Cell 2 to create a single, unified directorial style for the combined text, obeying the instructions above. Output raw JSON.`;

    const active_loaded_model_id_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url_address);

    try {
      const api_response_payload = await dispatch_http_post_request(lm_studio_api_url_address, {
        model: active_loaded_model_id_tag,
        messages: [
          { role: "system", content: system_instructional_prompt },
          { role: "user", content: user_input_content }
        ],
        response_format: { type: "json_object" },
        temperature: 0.4
      }, getMainWindow);

      if (!api_response_payload.choices || api_response_payload.choices.length === 0) {
        if (api_response_payload.error) {
          const lm_error_description = (typeof api_response_payload.error === "string")
            ? api_response_payload.error
            : (api_response_payload.error.message || JSON.stringify(api_response_payload.error));
          throw new Error(`LLM API Error (llama.cpp): ${lm_error_description}`);
        }
        throw new Error(`Invalid response structure from LLM server: ${JSON.stringify(api_response_payload)}`);
      }

      const active_choices_message_object = api_response_payload.choices[0].message;
      if (active_choices_message_object.refusal) {
        throw new Error(`LLM request was refused: ${active_choices_message_object.refusal}`);
      }

      const completion_content_text = ((active_choices_message_object.content) || (active_choices_message_object.reasoning_content) || "").trim();
      const parsed_json_response = extract_json_from_llm_response_text(completion_content_text);
      return parsed_json_response.merged_direction;
    } catch (api_failure_exception) {
      console.error("Smart merge failed.", api_failure_exception);
      throw api_failure_exception;
    }
  });
}

module.exports = {
  extract_json_from_llm_response_text,
  dispatch_http_post_request,
  retrieve_currently_loaded_model_tag,
  save_raw_llm_debug_log,
  detect_unmarked_spans,
  detect_unmarked_spans_joint,
  parse_unmarked_dialogue_by_rules,
  apply_relationship_taxonomy_placeholders,
  RELATIONSHIP_TAXONOMY_PROMPT_PLACEHOLDERS,
  register_ai_pipeline_handlers
};

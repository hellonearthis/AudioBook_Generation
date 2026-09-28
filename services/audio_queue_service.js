// =========================================================================
// SEQUENTIAL GENERATION QUEUE & COMFYUI INTEGRATION SERVICE
// =========================================================================
// WHAT: Manages the sequential background audio generation queue, dynamic ComfyUI workflow
//       parameter injection (Qwen3-TTS, AuK, Custom Voice), anchor baking, custom voice saving,
//       and character reference audio discovery.
// WHY: Protects hardware allocations by enforcing single-thread GPU task execution,
//      preventing CUDA out-of-memory crashes while keeping the UI responsive.

const path_library = require("path");
const filesystem_library = require("fs");
const http_client_library = require("http");
const crypto = require("crypto");
const child_process_library = require("child_process");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegStatic);

const {
  release_comfyui_vram,
  ensure_comfyui_ready,
  ensure_llama_vram_released
} = require("./service_health_service");

const {
  dispatch_http_post_request
} = require("./ai_pipeline_service");

let audio_generation_task_queue = [];
let audio_generation_queue_is_processing = false;
let cached_comfyui_base_directory_path = null;
let last_known_comfyui_endpoint_url = "http://127.0.0.1:8188";

// WHAT: Resolving the absolute base folder path of the ComfyUI installation.
// WHY: We need to stage cloning reference inputs into ComfyUI's 'input/' directory and retrieve completed takes from its 'output/' directory.
//      We check directories in strict order of user preference and structural availability, returning immediately when a valid directory is found.
function resolve_comfyui_base_directory() {
  if (cached_comfyui_base_directory_path) {
    return cached_comfyui_base_directory_path;
  }

  // WHAT: Loading configuration parameters from an external config.json file if present.
  let local_configuration_object = {};
  const config_file_path = path_library.join(__dirname, "..", "config.json");
  try {
    if (filesystem_library.existsSync(config_file_path)) {
      local_configuration_object = JSON.parse(filesystem_library.readFileSync(config_file_path, "utf8"));
    }
  } catch (config_reading_exception) {
    console.error("Failed to read config.json:", config_reading_exception);
  }

  const explicit_user_installation_path = local_configuration_object.comfyui_path || "C:\\cui";
  const shortcut_link_absolute_path = local_configuration_object.comfyui_shortcut_path || "C:\\Users\\Desktop-Dev\\Desktop\\ComfyUI-EZi output.lnk";
  const primary_discovered_hardcoded_fallback_path = "H:\\comfyui\\ComfyUI-Easy-Install-Windows\\ComfyUI-Easy-Install\\ComfyUI";
  const final_resort_fallback_path = path_library.join(__dirname, "..", "..", "comfyui");

  // WHAT: Prioritizing the user's explicit installation directory.
  if (filesystem_library.existsSync(explicit_user_installation_path)) {
    cached_comfyui_base_directory_path = explicit_user_installation_path;
    return cached_comfyui_base_directory_path;
  }

  // WHAT: Secondary check - resolving the target path from the desktop shortcut link.
  if (filesystem_library.existsSync(shortcut_link_absolute_path)) {
    try {
      const powershell_query_command = `powershell -ExecutionPolicy Bypass -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('${shortcut_link_absolute_path}').TargetPath"`;
      const resolved_shortcut_output_buffer = child_process_library.execSync(powershell_query_command);
      const cleaned_shortcut_target_path = resolved_shortcut_output_buffer.toString().trim();

      if (cleaned_shortcut_target_path) {
        if (cleaned_shortcut_target_path.toLowerCase().endsWith("output")) {
          const extracted_parent_base_directory = path_library.dirname(cleaned_shortcut_target_path);
          if (filesystem_library.existsSync(extracted_parent_base_directory)) {
            cached_comfyui_base_directory_path = extracted_parent_base_directory;
            return cached_comfyui_base_directory_path;
          }
        }

        if (filesystem_library.existsSync(cleaned_shortcut_target_path)) {
          cached_comfyui_base_directory_path = cleaned_shortcut_target_path;
          return cached_comfyui_base_directory_path;
        }
      }
    } catch (shortcut_resolution_exception) {
      console.error("Failed to dynamically resolve ComfyUI shortcut target path:", shortcut_resolution_exception);
    }
  }

  // WHAT: Tertiary check - using the discovered external H-drive fallback path.
  if (filesystem_library.existsSync(primary_discovered_hardcoded_fallback_path)) {
    cached_comfyui_base_directory_path = primary_discovered_hardcoded_fallback_path;
    return cached_comfyui_base_directory_path;
  }

  // WHAT: Ultimate fallback.
  cached_comfyui_base_directory_path = final_resort_fallback_path;
  return cached_comfyui_base_directory_path;
}

// WHAT: Local helper to fetch history from ComfyUI REST interface.
// WHY: Confirms when rendering jobs finish.
function fetch_comfyui_queue_history(comfyui_server_endpoint, target_prompt_id) {
  return new Promise((resolve_callback_function) => {
    http_client_library.get(`${comfyui_server_endpoint}/history/${target_prompt_id}`, (native_http_response) => {
      let response_buffer = "";
      native_http_response.on("data", (chunk) => { response_buffer += chunk; });
      native_http_response.on("end", () => {
        try {
          resolve_callback_function(JSON.parse(response_buffer));
        } catch {
          resolve_callback_function(null);
        }
      });
    }).on("error", () => {
      resolve_callback_function(null);
    });
  });
}

// WHAT: Programmatic Refresh of ComfyUI model directories and object definitions.
// WHY: Ensures new saved voices are immediately recognized by ComfyUI without a manual restart.
async function refresh_comfyui_models(comfyui_api_url) {
  return new Promise((resolve_refresh_promise, reject_refresh_promise) => {
    const comfyui_post_request_handle = http_client_library.request(`${comfyui_api_url}/free`, { method: 'POST' }, (comfyui_free_response_stream) => {
      http_client_library.get(`${comfyui_api_url}/object_info`, (comfyui_object_info_response_stream) => {
        resolve_refresh_promise(true);
      }).on('error', reject_refresh_promise);
    });
    comfyui_post_request_handle.on('error', reject_refresh_promise);
    comfyui_post_request_handle.end();
  });
}

// WHAT: Transforming a simple, potentially vague voice emotional state label into a multi-dimensional, descriptive profile.
function transform_simple_emotion_label_into_rich_description_string(raw_emotion_label_string) {
  const normalized_emotion_label_string = raw_emotion_label_string.toLowerCase().trim();

  if (normalized_emotion_label_string.includes("happy") || normalized_emotion_label_string.includes("joyous")) {
    return "bubbly, energetic, and optimistic";
  }
  if (normalized_emotion_label_string.includes("sad") || normalized_emotion_label_string.includes("somber") || normalized_emotion_label_string.includes("melancholy")) {
    return "hollow, breathy, and melancholic";
  }
  if (normalized_emotion_label_string.includes("angry") || normalized_emotion_label_string.includes("intense")) {
    return "intense, aggressive, and booming";
  }
  if (normalized_emotion_label_string.includes("fearful") || normalized_emotion_label_string.includes("anxious") || normalized_emotion_label_string.includes("terrified") || normalized_emotion_label_string.includes("trembling")) {
    return "shaky, trembling, and anxious";
  }
  if (normalized_emotion_label_string.includes("whispered") || normalized_emotion_label_string.includes("intimate") || normalized_emotion_label_string.includes("whisper")) {
    return "intimate, quiet, and breathy";
  }
  if (normalized_emotion_label_string.includes("excited")) {
    return "joyous, rapid, and enthusiastic";
  }
  if (normalized_emotion_label_string.includes("surprised") || normalized_emotion_label_string.includes("shocked")) {
    return "shocked, breathless, and wide-eyed";
  }
  if (normalized_emotion_label_string.includes("disgusted") || normalized_emotion_label_string.includes("bitter")) {
    return "bitter, sneering, and resentful";
  }

  return raw_emotion_label_string;
}

// WHAT: Core worker function that handles the background synthesis queue sequentially.
// WHY: Protects hardware allocations and maintains precise status updates to the UI.
async function execute_sequential_generation_queue(getMainWindow) {
  function notify_renderer(progress_update_payload) {
    const mainWindow = getMainWindow ? getMainWindow() : null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("audio:generation-status-update", progress_update_payload);
    }
  }

  if (audio_generation_task_queue.length === 0) {
    audio_generation_queue_is_processing = false;
    await release_comfyui_vram();
    return;
  }

  audio_generation_queue_is_processing = true;
  const current_active_task = audio_generation_task_queue.shift();
  
  const segment_index_position = current_active_task.script_segment_data.index_position;
  const target_file_prefix_label = current_active_task.is_directorial_segment_flag ? "line_directorial" : "line";
  const target_take_number = current_active_task.take_number || 1;

  const take_destination_subfolder_path = path_library.join(
    current_active_task.workspace_directory_path,
    current_active_task.project_name,
    "audio",
    "takes",
    `${target_file_prefix_label}_${segment_index_position}`
  );

  if (!filesystem_library.existsSync(take_destination_subfolder_path)) {
    filesystem_library.mkdirSync(take_destination_subfolder_path, { recursive: true });
  }

  const target_file_extension_suffix = ".mp3";
  let destination_audio_file_path = path_library.join(
    take_destination_subfolder_path,
    `take_${target_take_number}${target_file_extension_suffix}`
  );

  notify_renderer({
    index_position: segment_index_position,
    status: "processing",
    is_directorial: current_active_task.is_directorial_segment_flag ? true : false,
    message: `Synthesizing line for: ${current_active_task.script_segment_data.speaker}...`
  });

  let staged_temporary_reference_audio_absolute_path = null;

  try {
    let comfyui_is_reachable = await new Promise((resolve_ping) => {
      const ping_request = http_client_library.get(`${current_active_task.comfyui_api_url_address}/system_stats`, (http_response_object) => {
        resolve_ping(http_response_object.statusCode === 200);
      }).on('error', () => {
        resolve_ping(false);
      });
      ping_request.setTimeout(2500, () => {
        ping_request.destroy();
        resolve_ping(false);
      });
    });

    if (!comfyui_is_reachable) {
      notify_renderer({
        index_position: segment_index_position,
        status: "processing",
        is_directorial: current_active_task.is_directorial_segment_flag ? true : false,
        message: "Starting ComfyUI on demand for speech synthesis..."
      });
      const comfy_started = await ensure_comfyui_ready(current_active_task.comfyui_api_url_address);
      if (!comfy_started) {
        throw new Error(`ComfyUI server is unreachable at ${current_active_task.comfyui_api_url_address}. Launch C:\\cui\\goLow.ps1.`);
      }
    }

    if (current_active_task.comfyui_api_url_address) {
      last_known_comfyui_endpoint_url = current_active_task.comfyui_api_url_address;
    }

    await ensure_llama_vram_released(current_active_task.lm_studio_api_url_address);

    const active_speaker_name = current_active_task.script_segment_data.speaker;
    const global_character_mapping = current_active_task.voice_configuration_mapping[active_speaker_name] || {};
    const cell_override_mapping = current_active_task.script_segment_data.workflowOverride || {};
    const segment_render_block = current_active_task.script_segment_data.render || {};

    let active_workflow_type = cell_override_mapping.workflowType || "inherit";
    if (active_workflow_type === "inherit") {
      // WHAT: Division of labour engine routing:
      // If segment explicitly declares render.engine, route accordingly.
      // Otherwise, dialogue with an established voice reference clip routes to AuK Zero-Shot Voice Clone,
      // while Narrator or unreferenced voices route to Qwen3.
      if (segment_render_block.engine === "auk") {
        active_workflow_type = "auk_voice_clone";
      } else if (segment_render_block.engine === "qwen3") {
        active_workflow_type = (active_speaker_name === "Narrator") ? "custom" : "design";
      } else if (global_character_mapping.workflowType) {
        active_workflow_type = global_character_mapping.workflowType;
      } else if (active_speaker_name !== "Narrator" && (global_character_mapping.anchorFilePath || global_character_mapping.voice?.reference_audio)) {
        active_workflow_type = "auk_voice_clone";
      } else {
        active_workflow_type = "custom";
      }
    }

    let is_anchor_rerouted_to_clone_workflow = false;
    let resolved_anchor_wav_absolute_path = null;
    let resolved_anchor_transcript_text = null;

    let is_saved_voice_rerouted = false;
    let resolved_saved_voice_filename = null;

    if (global_character_mapping.savedVoiceFilename && active_workflow_type !== "design") {
      is_saved_voice_rerouted = true;
      active_workflow_type = "load_custom_voice";
      resolved_saved_voice_filename = global_character_mapping.savedVoiceFilename;
      console.log(`[Custom Voice Reroute] Character "${active_speaker_name}" has a globally saved voice model. Rerouting to loadCustomVoice.`);
    }

    let workflow_filename;
    if (active_workflow_type === "auk_voice_clone" || active_workflow_type === "auk_clone") {
      workflow_filename = "AuK-02-Voice-Clone_api.json";
    } else if (active_workflow_type === "auk_instruct_tts" || active_workflow_type === "auk_instruct") {
      workflow_filename = "AuK-01-Instruct-TTS_api.json";
    } else if (active_workflow_type === "load_custom_voice") {
      workflow_filename = "QWEN3-TTS-loadCustomVoice_api.json";
    } else if (active_workflow_type === "design") {
      workflow_filename = "Qwen3-tts-DesignVoice_API.json";
    } else if (active_workflow_type === "clone") {
      if (filesystem_library.existsSync(path_library.join(__dirname, "..", "comfyui_workflows", "Qwen3-tts-voiceClone_API.json"))) {
        workflow_filename = "Qwen3-tts-voiceClone_API.json";
      } else {
        workflow_filename = "AuK-02-Voice-Clone_api.json";
        active_workflow_type = "auk_voice_clone";
      }
    } else {
      if (filesystem_library.existsSync(path_library.join(__dirname, "..", "comfyui_workflows", "Qwen3-tts_CustomVoice_API.json"))) {
        workflow_filename = "Qwen3-tts_CustomVoice_API.json";
      } else if (filesystem_library.existsSync(path_library.join(__dirname, "..", "comfyui_workflows", "AuK-01-Instruct-TTS_api.json"))) {
        workflow_filename = "AuK-01-Instruct-TTS_api.json";
        active_workflow_type = "auk_instruct_tts";
      } else {
        workflow_filename = "Qwen3-tts-DesignVoice_API.json";
        active_workflow_type = "design";
      }
    }
    const workflow_template_absolute_path = path_library.join(__dirname, "..", "comfyui_workflows", workflow_filename);

    if (!filesystem_library.existsSync(workflow_template_absolute_path)) {
      throw new Error(`ComfyUI workflow API template not found at: ${workflow_template_absolute_path}`);
    }

    const comfyui_workflow_nodes_payload = JSON.parse(filesystem_library.readFileSync(workflow_template_absolute_path, "utf-8"));

    let generated_qwen3_style_prompt_string = "";
    
    const speaker_gender_specification = global_character_mapping.gender || "neutral";
    const speaker_age_specification = global_character_mapping.age || "adult";
    const speaker_personality_traits = global_character_mapping.traits || "clear tone";
    
    let active_pitch_level = "balanced";
    let active_pacing_level = "steady speaking speed";
    let active_volume_level = "normal";
    let active_emotional_state = "neutral";
    let active_acting_style = "natural narrator";

    let has_rich_qwen_style_metadata = false;
    let rich_qwen_style_texture = "";
    let rich_qwen_style_persona = "";
    let rich_qwen_style_technique = "";
    let rich_qwen_style_emotion = "";

    if (current_active_task.is_directorial_segment_flag && current_active_task.script_segment_data.delivery) {
      const delivery_details = current_active_task.script_segment_data.delivery;
      active_pitch_level = delivery_details.pitch;
      active_pacing_level = `${delivery_details.pacing} pacing`;
      active_volume_level = delivery_details.volume;
      active_emotional_state = delivery_details.style_label;
      active_acting_style = `expressive speaker delivering dialogue at ${active_volume_level} volume`;

      if (delivery_details.qwen_style) {
        has_rich_qwen_style_metadata = true;
        rich_qwen_style_texture = delivery_details.qwen_style.vocal_texture || speaker_personality_traits;
        rich_qwen_style_persona = delivery_details.qwen_style.acting_persona || active_acting_style;
        rich_qwen_style_technique = delivery_details.qwen_style.vocal_technique || "steady cadence and rhythmic speech";
        rich_qwen_style_emotion = delivery_details.qwen_style.rich_emotion || delivery_details.style_label;
      }
    } else if (current_active_task.script_segment_data.direction) {
      const manual_direction_lowercase = current_active_task.script_segment_data.direction.toLowerCase();
      active_emotional_state = current_active_task.script_segment_data.direction;
      if (manual_direction_lowercase.includes("fast") || manual_direction_lowercase.includes("rapid")) {
        active_pacing_level = "rapid-fire pacing";
      } else if (manual_direction_lowercase.includes("slow")) {
        active_pacing_level = "slow and measured pacing";
      }
      if (manual_direction_lowercase.includes("low") || manual_direction_lowercase.includes("deep")) {
        active_pitch_level = "deep";
      } else if (manual_direction_lowercase.includes("high")) {
        active_pitch_level = "high-pitched";
      }
      active_acting_style = `speaker following instructions: ${current_active_task.script_segment_data.direction}`;

      if (current_active_task.script_segment_data.qwen_style) {
        has_rich_qwen_style_metadata = true;
        rich_qwen_style_texture = current_active_task.script_segment_data.qwen_style.vocal_texture || speaker_personality_traits;
        rich_qwen_style_persona = current_active_task.script_segment_data.qwen_style.acting_persona || active_acting_style;
        rich_qwen_style_technique = current_active_task.script_segment_data.qwen_style.vocal_technique || "steady cadence and rhythmic speech";
        rich_qwen_style_emotion = current_active_task.script_segment_data.qwen_style.rich_emotion || active_emotional_state;
      }
    }

    let compiled_voice_quality_block = "";
    let compiled_prosody_block = "";
    let compiled_style_block = "";
    let compiled_emotion_block = "";

    if (has_rich_qwen_style_metadata) {
      if (current_active_task.script_segment_data.qwen_style) {
        const qwen_inline_age = current_active_task.script_segment_data.qwen_style.age_range || speaker_age_specification;
        const qwen_inline_gender = current_active_task.script_segment_data.qwen_style.gender || speaker_gender_specification;
        const qwen_inline_pitch = current_active_task.script_segment_data.qwen_style.pitch || active_pitch_level;
        const qwen_inline_pacing = current_active_task.script_segment_data.qwen_style.pacing || active_pacing_level;
        const qwen_inline_cadence = current_active_task.script_segment_data.qwen_style.cadence || "steady cadence";

        compiled_voice_quality_block = `Voice Quality: Base voice is ${speaker_age_specification.toLowerCase()} ${speaker_gender_specification.toLowerCase()} with a ${speaker_personality_traits.toLowerCase()} tone. Subtly influenced by a ${qwen_inline_pitch.toLowerCase()} pitch and a ${rich_qwen_style_texture.toLowerCase()} texture.`;
        compiled_prosody_block = `Prosody: Core pacing is ${active_pacing_level}. Gently inflected with ${qwen_inline_pacing.toLowerCase()} pacing and ${qwen_inline_cadence.toLowerCase()} speech.`;
        compiled_style_block = `Style: Base style is ${active_acting_style}. Softly nuanced by a ${rich_qwen_style_persona} persona, emphasizing ${rich_qwen_style_technique.toLowerCase()}.`;
        compiled_emotion_block = `Emotion: Emotionally grounded with subtle layers of ${rich_qwen_style_emotion}.`;
      } else {
        compiled_voice_quality_block = `Voice Quality: Base voice is ${speaker_age_specification.toLowerCase()} ${speaker_gender_specification.toLowerCase()} with a ${speaker_personality_traits.toLowerCase()} tone. Subtly influenced by a ${active_pitch_level} pitch and a ${rich_qwen_style_texture.toLowerCase()} texture.`;
        compiled_prosody_block = `Prosody: Core pacing is ${active_pacing_level} delivery, gently inflected with ${rich_qwen_style_technique.toLowerCase()} speech.`;
        compiled_style_block = `Style: Base style is ${active_acting_style}. Softly nuanced by a ${rich_qwen_style_persona} persona.`;
        compiled_emotion_block = `Emotion: Emotionally grounded with subtle layers of ${rich_qwen_style_emotion}.`;
      }
    } else {
      const rich_emotional_description_string = transform_simple_emotion_label_into_rich_description_string(active_emotional_state);
      compiled_voice_quality_block = `Voice Quality: ${speaker_age_specification.toLowerCase()} ${speaker_gender_specification.toLowerCase()} with a ${active_pitch_level} pitch and a ${speaker_personality_traits.toLowerCase()} texture.`;
      compiled_prosody_block = `Prosody: ${active_pacing_level} delivery, featuring steady cadence and rhythmic speech.`;
      compiled_style_block = `Style: ${active_acting_style}.`;
      compiled_emotion_block = `Emotion: ${rich_emotional_description_string}.`;
    }

    generated_qwen3_style_prompt_string = `${compiled_voice_quality_block} ${compiled_prosody_block} ${compiled_style_block} ${compiled_emotion_block}`;

    const character_name_deterministic_hash_value = Array.from(active_speaker_name).reduce(
      (running_hash_accumulator, current_character) =>
        ((running_hash_accumulator << 5) - running_hash_accumulator + current_character.charCodeAt(0)) | 0,
      0
    );
    const deterministic_fallback_seed_value = Math.abs(character_name_deterministic_hash_value) % 90000 + 10000;
    const active_seed_value = Number(cell_override_mapping.seed || global_character_mapping.seed || deterministic_fallback_seed_value);
    const target_dialogue_text = current_active_task.script_segment_data.text;

    let save_node_id_string = "43";

    if (active_workflow_type === "custom") {
      save_node_id_string = "43";
      if (comfyui_workflow_nodes_payload["41"]) {
        comfyui_workflow_nodes_payload["41"].inputs.value = target_dialogue_text;
      }
      if (comfyui_workflow_nodes_payload["42"]) {
        comfyui_workflow_nodes_payload["42"].inputs.value = generated_qwen3_style_prompt_string;
      }
      if (comfyui_workflow_nodes_payload["39"]) {
        const raw_preset_speaker_name = cell_override_mapping.voice || global_character_mapping.voice || "Eric";
        const validated_qwen3_speaker_whitelist = ["Aiden", "Dylan", "Eric", "Ono_anna", "Ryan", "Serena", "Sohee", "Uncle_fu", "Vivian"];
        const preset_speaker_name = validated_qwen3_speaker_whitelist.includes(raw_preset_speaker_name)
          ? raw_preset_speaker_name
          : "Eric";

        if (preset_speaker_name !== raw_preset_speaker_name) {
          console.warn(`[Voice Validation] Speaker "${raw_preset_speaker_name}" is not in the Qwen3-TTS whitelist. Falling back to "Eric".`);
        }

        comfyui_workflow_nodes_payload["39"].inputs.speaker = preset_speaker_name;
        comfyui_workflow_nodes_payload["39"].inputs.seed = active_seed_value;
        comfyui_workflow_nodes_payload["39"].inputs.language = "English";
      }
    } else if (active_workflow_type === "design") {
      save_node_id_string = "41";
      if (comfyui_workflow_nodes_payload["42"]) {
        comfyui_workflow_nodes_payload["42"].inputs.value = target_dialogue_text;
      }
      if (comfyui_workflow_nodes_payload["43"]) {
        const precompiled_design_prompt_string = cell_override_mapping.designPrompt || 
          global_character_mapping.designPrompt || "";

        const resolved_voice_profile_section = global_character_mapping.voiceProfile || 
          global_character_mapping.baseVoice || 
          global_character_mapping.traits || 
          "A clean, clear, and natural speaking voice.";
        const resolved_identity_background_section = global_character_mapping.identityBackground || "";
        const resolved_physical_appearance_section = global_character_mapping.physicalAppearance || 
          global_character_mapping.visualDetails || "";
        const resolved_personality_traits_section = global_character_mapping.personalityTraits || 
          global_character_mapping.traits || "";

        let structured_custom_voice_style_prompt_string;

        if (precompiled_design_prompt_string && precompiled_design_prompt_string.includes("Voice Profile:")) {
          structured_custom_voice_style_prompt_string = 
            precompiled_design_prompt_string + `\n` +
            `Delivery: ${active_emotional_state}, ${active_pacing_level}, ${active_pitch_level} pitch, ${active_volume_level} volume`;
        } else {
          structured_custom_voice_style_prompt_string = 
            `Character Name: ${active_speaker_name}\n` +
            `Voice Profile: ${resolved_voice_profile_section}\n` +
            (resolved_identity_background_section ? `Identity & Background: ${resolved_identity_background_section}\n` : "") +
            (resolved_physical_appearance_section ? `Physical Appearance: ${resolved_physical_appearance_section}\n` : "") +
            (resolved_personality_traits_section ? `Personality Traits: ${resolved_personality_traits_section}\n` : "") +
            `Delivery: ${active_emotional_state}, ${active_pacing_level}, ${active_pitch_level} pitch, ${active_volume_level} volume`;
        }

        comfyui_workflow_nodes_payload["43"].inputs.value = structured_custom_voice_style_prompt_string;
      }
      if (comfyui_workflow_nodes_payload["38"]) {
        comfyui_workflow_nodes_payload["38"].inputs.seed = active_seed_value;
        comfyui_workflow_nodes_payload["38"].inputs.control_after_generate = "fixed";
        comfyui_workflow_nodes_payload["38"].inputs.language = "English";
      }
    } else if (active_workflow_type === "clone") {
      save_node_id_string = "4";
      if (comfyui_workflow_nodes_payload["6"]) {
        comfyui_workflow_nodes_payload["6"].inputs.value = target_dialogue_text;
      }

      if (is_anchor_rerouted_to_clone_workflow && resolved_anchor_wav_absolute_path) {
        const standardized_anchor_clone_speaker_name = active_speaker_name.toLowerCase().replace(/\s+/g, "_");
        const anchor_staging_filename = `qwen_anchor_${standardized_anchor_clone_speaker_name}_${Date.now()}.wav`;
        const comfyui_resolved_base_directory_for_anchor = resolve_comfyui_base_directory();
        const absolute_comfyui_anchor_staging_path = path_library.join(
          comfyui_resolved_base_directory_for_anchor, "input", anchor_staging_filename
        );

        const comfyui_anchor_input_parent_directory = path_library.dirname(absolute_comfyui_anchor_staging_path);
        if (!filesystem_library.existsSync(comfyui_anchor_input_parent_directory)) {
          filesystem_library.mkdirSync(comfyui_anchor_input_parent_directory, { recursive: true });
        }

        filesystem_library.copyFileSync(resolved_anchor_wav_absolute_path, absolute_comfyui_anchor_staging_path);
        staged_temporary_reference_audio_absolute_path = absolute_comfyui_anchor_staging_path;

        if (comfyui_workflow_nodes_payload["2"]) {
          comfyui_workflow_nodes_payload["2"].inputs.audio = anchor_staging_filename;
        }
        if (comfyui_workflow_nodes_payload["5"]) {
          comfyui_workflow_nodes_payload["5"].inputs.value = resolved_anchor_transcript_text || "";
        }
        if (comfyui_workflow_nodes_payload["3"]) {
          comfyui_workflow_nodes_payload["3"].inputs.seed = active_seed_value;
          comfyui_workflow_nodes_payload["3"].inputs.control_after_generate = "fixed";
          comfyui_workflow_nodes_payload["3"].inputs.language = "English";
          comfyui_workflow_nodes_payload["3"].inputs.temperature = 0.3;
        }

      } else {
        const standardized_speaker_name = active_speaker_name.toLowerCase().replace(/\s+/g, "_");
        
        let active_emotion_label = "neutral";
        if (current_active_task.is_directorial_segment_flag && current_active_task.script_segment_data.delivery) {
          active_emotion_label = current_active_task.script_segment_data.delivery.style_label.toLowerCase().trim();
        } else if (current_active_task.script_segment_data.direction) {
          const direction_lowercase = current_active_task.script_segment_data.direction.toLowerCase();
          if (direction_lowercase.includes("angry")) active_emotion_label = "angry";
          else if (direction_lowercase.includes("anxious") || direction_lowercase.includes("fear")) active_emotion_label = "anxious";
          else if (direction_lowercase.includes("excited") || direction_lowercase.includes("happy")) active_emotion_label = "excited";
          else if (direction_lowercase.includes("whisper")) active_emotion_label = "whispered";
        }

        const references_subfolder_absolute_path = path_library.join(
          current_active_task.workspace_directory_path,
          current_active_task.project_name,
          "audio",
          "references",
          standardized_speaker_name
        );

        let resolved_reference_audio_filename = "";
        let reference_transcription_text = "The direct path through the valley was covered in thick, dark moss.";

        if (filesystem_library.existsSync(references_subfolder_absolute_path)) {
          const emotional_audio_filename = `${active_emotion_label}.mp3`;
          const baseline_neutral_filename = "neutral.mp3";

          const absolute_path_to_emotional_audio = path_library.join(references_subfolder_absolute_path, emotional_audio_filename);
          const absolute_path_to_neutral_audio = path_library.join(references_subfolder_absolute_path, baseline_neutral_filename);

          let absolute_source_audio_path_to_use = "";
          let selected_audio_emotion_label = active_emotion_label;

          if (filesystem_library.existsSync(absolute_path_to_emotional_audio)) {
            absolute_source_audio_path_to_use = absolute_path_to_emotional_audio;
          } else if (filesystem_library.existsSync(absolute_path_to_neutral_audio)) {
            absolute_source_audio_path_to_use = absolute_path_to_neutral_audio;
            selected_audio_emotion_label = "neutral";
          }

          if (absolute_source_audio_path_to_use) {
            const unique_comfyui_input_filename = `qwen_staging_${standardized_speaker_name}_${selected_audio_emotion_label}_${Date.now()}.mp3`;
            const comfyui_resolved_base_directory = resolve_comfyui_base_directory();
            const absolute_comfyui_input_staging_path = path_library.join(
              comfyui_resolved_base_directory, "input", unique_comfyui_input_filename
            );

            const comfyui_input_directory_parent = path_library.dirname(absolute_comfyui_input_staging_path);
            if (!filesystem_library.existsSync(comfyui_input_directory_parent)) {
              filesystem_library.mkdirSync(comfyui_input_directory_parent, { recursive: true });
            }

            filesystem_library.copyFileSync(absolute_source_audio_path_to_use, absolute_comfyui_input_staging_path);
            resolved_reference_audio_filename = unique_comfyui_input_filename;
            staged_temporary_reference_audio_absolute_path = absolute_comfyui_input_staging_path;

            const transcript_text_filepath = path_library.join(references_subfolder_absolute_path, `${selected_audio_emotion_label}.txt`);
            if (filesystem_library.existsSync(transcript_text_filepath)) {
              reference_transcription_text = filesystem_library.readFileSync(transcript_text_filepath, "utf-8").trim();
            } else {
              console.warn(`[Voice Consistency Warning] No transcript file found at: ${transcript_text_filepath}. Using generic fallback transcript.`);
            }
          }
        }

        if (comfyui_workflow_nodes_payload["2"] && resolved_reference_audio_filename) {
          comfyui_workflow_nodes_payload["2"].inputs.audio = resolved_reference_audio_filename;
        }
        if (comfyui_workflow_nodes_payload["5"]) {
          comfyui_workflow_nodes_payload["5"].inputs.value = reference_transcription_text;
        }
        if (comfyui_workflow_nodes_payload["3"]) {
          comfyui_workflow_nodes_payload["3"].inputs.seed = active_seed_value;
          comfyui_workflow_nodes_payload["3"].inputs.control_after_generate = "fixed";
          comfyui_workflow_nodes_payload["3"].inputs.language = "English";
          comfyui_workflow_nodes_payload["3"].inputs.temperature = 0.3;
          comfyui_workflow_nodes_payload["3"].inputs.top_p = 0.7;
          comfyui_workflow_nodes_payload["3"].inputs.top_k = 15;
          comfyui_workflow_nodes_payload["3"].inputs.repetition_penalty = 1.1;
        }
      }
    } else if (active_workflow_type === "load_custom_voice") {
      save_node_id_string = "99";

      if (comfyui_workflow_nodes_payload["10"]) {
        comfyui_workflow_nodes_payload["10"].inputs.target_text = target_dialogue_text;
        comfyui_workflow_nodes_payload["10"].inputs.seed = active_seed_value;
        comfyui_workflow_nodes_payload["10"].inputs.language = "English";
        comfyui_workflow_nodes_payload["10"].inputs.temperature = 0.3;
        comfyui_workflow_nodes_payload["10"].inputs.top_p = 0.7;
        comfyui_workflow_nodes_payload["10"].inputs.top_k = 15;
        comfyui_workflow_nodes_payload["10"].inputs.repetition_penalty = 1.1;
      }

      if (comfyui_workflow_nodes_payload["11"]) {
        comfyui_workflow_nodes_payload["11"].inputs.filename = `${resolved_saved_voice_filename}.wav`;
      }

      comfyui_workflow_nodes_payload[save_node_id_string] = {
        inputs: {
          filename_prefix: "audio/ComfyUI",
          audio: ["10", 0]
        },
        class_type: "SaveAudio",
        _meta: { title: "Save Audio (Injected)" }
      };
    } else if (active_workflow_type === "auk_voice_clone" || active_workflow_type === "auk_clone") {
      save_node_id_string = "5";

      // WHAT: Synthesizing plain-language instruction and duration estimate for AuK.
      // WHY: AuK Zero-Shot Voice Clone uses the reference audio for static character vocal identity,
      //      while the secondary input carries the line-specific instruction (emotion, relationship state, subtext).
      let auk_instruction = segment_render_block.instruction || 
                            current_active_task.script_segment_data.direction || 
                            current_active_task.script_segment_data.delivery?.instruction || "";

      if (!auk_instruction) {
        if (active_emotional_state && active_emotional_state !== "neutral") {
          auk_instruction = `Say the following with the same voice, ${active_emotional_state}: '${target_dialogue_text}'`;
        } else {
          auk_instruction = `Say the following with the same voice: '${target_dialogue_text}'`;
        }
      }

      // WHAT: Estimating duration from word count or explicit gen_seconds hint.
      // WHY: AuK accepts an explicit generation duration hint to ensure correct speech cadence.
      //      ComfyUI AuK docs require reference + generated audio to fit within 30 seconds total.
      let estimated_seconds = 3;
      if (segment_render_block.gen_seconds) {
        estimated_seconds = Math.max(1, Math.min(28, Math.round(Number(segment_render_block.gen_seconds) * 10) / 10));
      } else {
        const word_count = target_dialogue_text.split(/\s+/).filter(Boolean).length;
        const comma_period_count = (target_dialogue_text.match(/[,.?!;:]/g) || []).length;
        estimated_seconds = Math.max(1.5, Math.min(28, Math.round(((word_count / 2.3) + (comma_period_count * 0.3) + 0.5) * 10) / 10));
      }

      if (comfyui_workflow_nodes_payload["3"]) {
        comfyui_workflow_nodes_payload["3"].inputs.task = "Zero-Shot TTS (Voice Clone)";
        comfyui_workflow_nodes_payload["3"].inputs.primary = target_dialogue_text;
        comfyui_workflow_nodes_payload["3"].inputs.secondary = auk_instruction;
        comfyui_workflow_nodes_payload["3"].inputs.seed = active_seed_value;
        comfyui_workflow_nodes_payload["3"].inputs.generation_seconds = estimated_seconds;
        comfyui_workflow_nodes_payload["3"].inputs.duration_mode = segment_render_block.gen_seconds ? "Custom Duration (Seconds)" : "Auto Estimate (TTS Recommended)";
      }

      // WHAT: Resolving the character reference audio clip.
      // Checks segment.render.reference_audio -> character voice object -> master anchor WAV -> references subfolder.
      let resolved_reference_audio_file_path = segment_render_block.reference_audio ||
                                              global_character_mapping.voice?.reference_audio ||
                                              cell_override_mapping.referenceAudioPath || 
                                              cell_override_mapping.reference_audio_path || 
                                              global_character_mapping.anchorFilePath ||
                                              global_character_mapping.referenceAudioPath || 
                                              global_character_mapping.reference_audio_path;

      if (!resolved_reference_audio_file_path || !filesystem_library.existsSync(resolved_reference_audio_file_path)) {
        const standardized_speaker_name = active_speaker_name.toLowerCase().replace(/\s+/g, "_");
        const potential_anchor_paths = [
          path_library.join(current_active_task.workspace_directory_path, current_active_task.project_name, "audio", "anchors", `${standardized_speaker_name}_anchor.wav`),
          path_library.join(current_active_task.workspace_directory_path, current_active_task.project_name, "audio", "anchors", `character_voice_${standardized_speaker_name}.wav`),
          path_library.join(current_active_task.workspace_directory_path, current_active_task.project_name, "audio", "anchors", `${standardized_speaker_name}_master.wav`)
        ];
        // WHAT: Checking standard master anchor file locations in priority order.
        // WHY: Looks for character-specific master anchor WAVs generated during initial VoiceDesign bake.
        for (let path_index = 0; path_index < potential_anchor_paths.length; path_index++) {
          const candidate_anchor_file_path = potential_anchor_paths[path_index];
          if (filesystem_library.existsSync(candidate_anchor_file_path)) {
            resolved_reference_audio_file_path = candidate_anchor_file_path;
            break;
          }
        }

        if (!resolved_reference_audio_file_path) {
          const references_subfolder_path = path_library.join(
            current_active_task.workspace_directory_path,
            current_active_task.project_name,
            "audio",
            "references",
            standardized_speaker_name
          );
          if (filesystem_library.existsSync(references_subfolder_path)) {
            const available_reference_files = filesystem_library.readdirSync(references_subfolder_path);
            const matching_audio_filename = available_reference_files.find(filename_candidate =>
              filename_candidate.endsWith(".wav") || filename_candidate.endsWith(".mp3") || filename_candidate.endsWith(".flac")
            );
            if (matching_audio_filename) {
              resolved_reference_audio_file_path = path_library.join(references_subfolder_path, matching_audio_filename);
            }
          }
        }
      }

      if (resolved_reference_audio_file_path && filesystem_library.existsSync(resolved_reference_audio_file_path)) {
        const reference_file_extension = path_library.extname(resolved_reference_audio_file_path) || ".wav";
        const unique_staging_audio_filename = `auk_ref_${Date.now()}${reference_file_extension}`;
        const comfyui_resolved_base_directory = resolve_comfyui_base_directory();
        const absolute_staging_path = path_library.join(comfyui_resolved_base_directory, "input", unique_staging_audio_filename);

        const comfyui_input_parent_directory = path_library.dirname(absolute_staging_path);
        if (!filesystem_library.existsSync(comfyui_input_parent_directory)) {
          filesystem_library.mkdirSync(comfyui_input_parent_directory, { recursive: true });
        }
        filesystem_library.copyFileSync(resolved_reference_audio_file_path, absolute_staging_path);
        staged_temporary_reference_audio_absolute_path = absolute_staging_path;

        if (comfyui_workflow_nodes_payload["2"]) {
          comfyui_workflow_nodes_payload["2"].inputs.audio = unique_staging_audio_filename;
        }
      } else {
        console.warn(`[AuK Voice Clone Warning] No reference audio file found for character "${active_speaker_name}". Will proceed with workflow defaults.`);
      }

    } else if (active_workflow_type === "auk_instruct_tts" || active_workflow_type === "auk_instruct") {
      save_node_id_string = "4";

      if (comfyui_workflow_nodes_payload["2"]) {
        comfyui_workflow_nodes_payload["2"].inputs.task = "Instruct TTS (Description)";
        comfyui_workflow_nodes_payload["2"].inputs.primary = target_dialogue_text;
        comfyui_workflow_nodes_payload["2"].inputs.secondary = generated_qwen3_style_prompt_string || global_character_mapping.traits || "A natural, clear, and warm speaking voice";
        comfyui_workflow_nodes_payload["2"].inputs.seed = active_seed_value;
        comfyui_workflow_nodes_payload["2"].inputs.duration_mode = "Auto Estimate (TTS Recommended)";
      }
    }

    if (comfyui_workflow_nodes_payload[save_node_id_string]) {
      comfyui_workflow_nodes_payload[save_node_id_string].inputs.filename_prefix = `take/${target_file_prefix_label}_${segment_index_position}_take_${target_take_number}`;
    }

    const comfyui_response = await dispatch_http_post_request(`${current_active_task.comfyui_api_url_address}/prompt`, { prompt: comfyui_workflow_nodes_payload });
    const prompt_execution_id = comfyui_response.prompt_id;

    let rendering_is_active = true;
    let check_iterations_limit = 0;

    while (rendering_is_active && check_iterations_limit < 600) {
      await new Promise((resolve_delay) => setTimeout(resolve_delay, 1000));
      
      const queue_status_payload = await fetch_comfyui_queue_history(current_active_task.comfyui_api_url_address, prompt_execution_id);
      if (queue_status_payload && queue_status_payload[prompt_execution_id]) {
        rendering_is_active = false;
        
        const comfyui_history_entry = queue_status_payload[prompt_execution_id];
        let target_output_node_entry = comfyui_history_entry.outputs ? comfyui_history_entry.outputs[save_node_id_string] : null;
        if (!target_output_node_entry || !target_output_node_entry.audio || target_output_node_entry.audio.length === 0) {
          for (const output_node_identifier of Object.keys(comfyui_history_entry.outputs || {})) {
            const candidate_output_node = comfyui_history_entry.outputs[output_node_identifier];
            if (candidate_output_node && candidate_output_node.audio && candidate_output_node.audio.length > 0) {
              target_output_node_entry = candidate_output_node;
              break;
            }
          }
        }

        if (!target_output_node_entry || !target_output_node_entry.audio || target_output_node_entry.audio.length === 0) {
          throw new Error(`ComfyUI workflow finished but no audio output was found for execution ${prompt_execution_id}.`);
        }
        
        const audio_output_entry = target_output_node_entry.audio[0];
        const relative_rendered_audio_path = path_library.join(
          audio_output_entry.subfolder || "",
          audio_output_entry.filename
        );

        const comfyui_resolved_base_directory = resolve_comfyui_base_directory();
        const absolute_comfyui_output_wav_path = path_library.join(
          comfyui_resolved_base_directory, "output", relative_rendered_audio_path
        );

        if (filesystem_library.existsSync(absolute_comfyui_output_wav_path)) {
          const actual_rendered_extension = path_library.extname(relative_rendered_audio_path);
          destination_audio_file_path = path_library.join(
            take_destination_subfolder_path,
            `take_${target_take_number}${actual_rendered_extension}`
          );

          filesystem_library.copyFileSync(absolute_comfyui_output_wav_path, destination_audio_file_path);
        } else {
          throw new Error(`Synthesized file was not found in ComfyUI output at: ${absolute_comfyui_output_wav_path}`);
        }
      }
      check_iterations_limit++;
    }

    if (rendering_is_active) {
      throw new Error("ComfyUI synthesis timed out.");
    }

    notify_renderer({
      index_position: current_active_task.script_segment_data.index_position,
      status: "completed",
      filePath: destination_audio_file_path,
      is_directorial: current_active_task.is_directorial_segment_flag ? true : false,
      take_number: current_active_task.take_number || 1,
      message: "Synthesis completed."
    });

  } catch (synthesis_failure_exception) {
    console.error("Queue item synthesis failed.", synthesis_failure_exception);
    notify_renderer({
      index_position: current_active_task.script_segment_data.index_position,
      status: "failed",
      is_directorial: current_active_task.is_directorial_segment_flag ? true : false,
      message: `Failed: ${synthesis_failure_exception.message}`
    });
  } finally {
    if (staged_temporary_reference_audio_absolute_path && filesystem_library.existsSync(staged_temporary_reference_audio_absolute_path)) {
      try {
        filesystem_library.unlinkSync(staged_temporary_reference_audio_absolute_path);
      } catch (cleanup_error) {
        console.error("Failed to clean up staged reference audio file.", cleanup_error);
      }
    }

    execute_sequential_generation_queue(getMainWindow);
  }
}

function register_audio_queue_handlers(ipcMain, getMainWindow) {
  function notify_renderer(progress_update_payload) {
    const mainWindow = getMainWindow ? getMainWindow() : null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("audio:generation-status-update", progress_update_payload);
    }
  }

  // WHAT: Discovery of character emotional reference clips.
  ipcMain.handle("references:get-character-references", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, character_name } = request_arguments;
    const standardized_character_name_string = character_name.toLowerCase().replace(/\s+/g, "_");

    const character_reference_subfolder_absolute_path = path_library.join(
      workspace_directory_path,
      project_name,
      "audio",
      "references",
      standardized_character_name_string
    );

    const compiled_list_of_detected_references = [];

    try {
      if (filesystem_library.existsSync(character_reference_subfolder_absolute_path)) {
        const list_of_folder_contents = filesystem_library.readdirSync(character_reference_subfolder_absolute_path);

        for (let file_counter = 0; file_counter < list_of_folder_contents.length; file_counter++) {
          const file_name_item = list_of_folder_contents[file_counter];
          const file_extension_name = path_library.extname(file_name_item).toLowerCase();

          if (file_extension_name === ".mp3" || file_extension_name === ".wav") {
            const emotion_style_name_label = path_library.basename(file_name_item, file_extension_name);
            const corresponding_transcription_text_filename = `${emotion_style_name_label}.txt`;
            const corresponding_transcription_text_absolute_path = path_library.join(
              character_reference_subfolder_absolute_path,
              corresponding_transcription_text_filename
            );

            let loaded_transcription_text_content = "";
            if (filesystem_library.existsSync(corresponding_transcription_text_absolute_path)) {
              loaded_transcription_text_content = filesystem_library.readFileSync(
                corresponding_transcription_text_absolute_path,
                "utf-8"
              ).trim();
            }

            compiled_list_of_detected_references.push({
              emotion: emotion_style_name_label,
              fileName: file_name_item,
              transcript: loaded_transcription_text_content
            });
          }
        }
      }
    } catch (filesystem_read_error) {
      console.error("Failed to read character references directory.", filesystem_read_error);
    }

    return { references: compiled_list_of_detected_references };
  });

  // WHAT: Appending a synthesis task into the background generation list.
  ipcMain.handle("audio:enqueue-generation", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, script_segment_data, voice_configuration_mapping, comfyui_api_url_address, take_number } = request_arguments;

    const task_item_descriptor = {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      script_segment_data: script_segment_data,
      voice_configuration_mapping: voice_configuration_mapping,
      comfyui_api_url_address: comfyui_api_url_address,
      take_number: Number(take_number || 1)
    };

    audio_generation_task_queue.push(task_item_descriptor);

    if (!audio_generation_queue_is_processing) {
      execute_sequential_generation_queue(getMainWindow);
    }

    return { queued: true, queueLength: audio_generation_task_queue.length };
  });

  // WHAT: Registering the Directorial Speech Synthesis Enqueuer IPC handler.
  ipcMain.handle("audio:enqueue-directorial-generation", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, script_segment_data, voice_configuration_mapping, comfyui_api_url_address, take_number } = request_arguments;

    const task_item_descriptor = {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      script_segment_data: script_segment_data,
      voice_configuration_mapping: voice_configuration_mapping,
      comfyui_api_url_address: comfyui_api_url_address,
      is_directorial_segment_flag: true,
      take_number: Number(take_number || 1)
    };

    audio_generation_task_queue.push(task_item_descriptor);

    if (!audio_generation_queue_is_processing) {
      execute_sequential_generation_queue(getMainWindow);
    }

    return { queued: true, queueLength: audio_generation_task_queue.length };
  });

  // WHAT: Retrieves the current status and length of the background audio synthesis queue.
  ipcMain.handle("audio:get-queue-status", async () => {
    return {
      is_processing: audio_generation_queue_is_processing,
      queue_length: audio_generation_task_queue.length,
      active_items: audio_generation_task_queue.map(task => ({
        index: task.script_segment_data.index_position,
        speaker: task.script_segment_data.speaker,
        is_directorial: task.is_directorial_segment_flag ? true : false
      }))
    };
  });

  // WHAT: Forcefully clears the background synthesis queue and resets processing flags.
  ipcMain.handle("audio:reset-queue", async () => {
    audio_generation_task_queue = [];
    audio_generation_queue_is_processing = false;
    await release_comfyui_vram();
    console.log("[Queue Reset] Main process audio generation queue has been manually flushed.");
    return { success: true, message: "Queue flushed and reset." };
  });

  // WHAT: Registering the Voice Anchor Bake IPC handler.
  ipcMain.handle("audio:bake-voice-anchor", async (ipc_event_context, request_arguments) => {
    const {
      workspace_directory_path,
      project_name,
      character_name,
      design_prompt,
      anchor_phrase,
      seed_value,
      comfyui_api_url_address
    } = request_arguments;

    const standardized_character_name_string = character_name.toLowerCase().replace(/\s+/g, "_");
    const anchors_directory_absolute_path = path_library.join(
      workspace_directory_path, project_name, "audio", "anchors"
    );

    if (!filesystem_library.existsSync(anchors_directory_absolute_path)) {
      filesystem_library.mkdirSync(anchors_directory_absolute_path, { recursive: true });
    }

    notify_renderer({
      index_position: `anchor_bake_${standardized_character_name_string}`,
      status: "processing",
      is_directorial: false,
      message: `Baking master anchor clip for ${character_name}...`
    });

    let staged_anchor_bake_output_path = null;

    try {
      const comfyui_anchor_bake_is_reachable = await new Promise((resolve_ping) => {
        const ping_request = http_client_library.get(`${comfyui_api_url_address}/system_stats`, (response) => {
          resolve_ping(response.statusCode === 200);
        }).on('error', () => {
          resolve_ping(false);
        });
        ping_request.setTimeout(2500, () => {
          ping_request.destroy();
          resolve_ping(false);
        });
      });

      if (!comfyui_anchor_bake_is_reachable) {
        throw new Error(`ComfyUI server is unreachable at ${comfyui_api_url_address}. Please ensure the server is running.`);
      }

      const voice_design_workflow_template_path = path_library.join(__dirname, "..", "comfyui_workflows", "Qwen3-tts-DesignVoice_API.json");
      if (!filesystem_library.existsSync(voice_design_workflow_template_path)) {
        throw new Error(`VoiceDesign workflow template not found at: ${voice_design_workflow_template_path}`);
      }
      const anchor_bake_workflow_nodes_payload = JSON.parse(
        filesystem_library.readFileSync(voice_design_workflow_template_path, "utf-8")
      );

      if (anchor_bake_workflow_nodes_payload["42"]) {
        anchor_bake_workflow_nodes_payload["42"].inputs.value = anchor_phrase;
      }

      if (anchor_bake_workflow_nodes_payload["43"]) {
        anchor_bake_workflow_nodes_payload["43"].inputs.value = design_prompt;
      }

      if (anchor_bake_workflow_nodes_payload["38"]) {
        anchor_bake_workflow_nodes_payload["38"].inputs.seed = Number(seed_value);
        anchor_bake_workflow_nodes_payload["38"].inputs.control_after_generate = "fixed";
        anchor_bake_workflow_nodes_payload["38"].inputs.language = "English";
      }

      const anchor_bake_output_prefix = `anchor_bake/${standardized_character_name_string}_anchor`;
      if (anchor_bake_workflow_nodes_payload["41"]) {
        anchor_bake_workflow_nodes_payload["41"].inputs.filename_prefix = anchor_bake_output_prefix;
      }

      const comfyui_anchor_bake_response = await dispatch_http_post_request(
        `${comfyui_api_url_address}/prompt`,
        { prompt: anchor_bake_workflow_nodes_payload }
      );
      const anchor_bake_prompt_execution_id = comfyui_anchor_bake_response.prompt_id;

      let anchor_bake_rendering_is_active = true;
      let anchor_bake_poll_iterations = 0;

      while (anchor_bake_rendering_is_active && anchor_bake_poll_iterations < 600) {
        await new Promise((resolve_delay) => setTimeout(resolve_delay, 1000));

        const anchor_bake_history_payload = await fetch_comfyui_queue_history(
          comfyui_api_url_address, anchor_bake_prompt_execution_id
        );

        if (anchor_bake_history_payload && anchor_bake_history_payload[anchor_bake_prompt_execution_id]) {
          anchor_bake_rendering_is_active = false;

          const anchor_bake_history_entry = anchor_bake_history_payload[anchor_bake_prompt_execution_id];
          const anchor_bake_audio_output_entry = anchor_bake_history_entry.outputs["41"].audio[0];
          const anchor_bake_relative_rendered_path = path_library.join(
            anchor_bake_audio_output_entry.subfolder || "",
            anchor_bake_audio_output_entry.filename
          );

          const comfyui_resolved_base_directory_for_anchor_bake = resolve_comfyui_base_directory();
          const absolute_comfyui_anchor_bake_output_path = path_library.join(
            comfyui_resolved_base_directory_for_anchor_bake, "output", anchor_bake_relative_rendered_path
          );

          if (!filesystem_library.existsSync(absolute_comfyui_anchor_bake_output_path)) {
            throw new Error(`Baked anchor file was not found in ComfyUI output at: ${absolute_comfyui_anchor_bake_output_path}`);
          }

          staged_anchor_bake_output_path = absolute_comfyui_anchor_bake_output_path;

          const final_anchor_wav_absolute_path = path_library.join(
            anchors_directory_absolute_path,
            `${standardized_character_name_string}_anchor.wav`
          );

          await new Promise((resolve_ffmpeg, reject_ffmpeg) => {
            ffmpeg(absolute_comfyui_anchor_bake_output_path)
              .audioChannels(1)
              .audioFrequency(24000)
              .audioCodec("pcm_s16le")
              .format("wav")
              .audioFilters("apad=pad_dur=0.2")
              .output(final_anchor_wav_absolute_path)
              .on("end", () => {
                console.log(`[Anchor Bake] Successfully converted anchor to WAV: ${final_anchor_wav_absolute_path}`);
                resolve_ffmpeg();
              })
              .on("error", (ffmpeg_conversion_error) => {
                console.error("[Anchor Bake] FFmpeg conversion failed:", ffmpeg_conversion_error);
                reject_ffmpeg(ffmpeg_conversion_error);
              })
              .run();
          });

          const anchor_transcript_file_absolute_path = path_library.join(
            anchors_directory_absolute_path,
            `${standardized_character_name_string}_anchor_transcript.txt`
          );
          filesystem_library.writeFileSync(anchor_transcript_file_absolute_path, anchor_phrase, "utf-8");

          notify_renderer({
            index_position: `anchor_bake_${standardized_character_name_string}`,
            status: "completed",
            is_directorial: false,
            filePath: final_anchor_wav_absolute_path,
            message: `Anchor baked successfully for ${character_name}.`
          });

          return {
            success: true,
            anchor_file_path: final_anchor_wav_absolute_path,
            anchor_transcript: anchor_phrase,
            baked_at_timestamp: Date.now()
          };
        }

        anchor_bake_poll_iterations++;
      }

      if (anchor_bake_rendering_is_active) {
        throw new Error("ComfyUI anchor bake synthesis timed out after 10 minutes.");
      }

    } catch (anchor_bake_failure_exception) {
      console.error("[Anchor Bake] Voice anchor baking failed:", anchor_bake_failure_exception);

      notify_renderer({
        index_position: `anchor_bake_${standardized_character_name_string}`,
        status: "failed",
        is_directorial: false,
        message: `Anchor bake failed: ${anchor_bake_failure_exception.message}`
      });

      return {
        success: false,
        error: anchor_bake_failure_exception.message
      };
    }
  });

  // WHAT: Registering the promote test to anchor IPC handler.
  ipcMain.handle("audio:promote-test-to-anchor", async (ipc_event_context, request_arguments) => {
    const {
      workspace_directory_path,
      project_name,
      character_name,
      test_take_file_path
    } = request_arguments;

    const standardized_character_name_string = character_name.toLowerCase().replace(/\s+/g, "_");
    const anchors_directory_absolute_path = path_library.join(
      workspace_directory_path, project_name, "audio", "anchors"
    );

    if (!filesystem_library.existsSync(anchors_directory_absolute_path)) {
      filesystem_library.mkdirSync(anchors_directory_absolute_path, { recursive: true });
    }

    const destination_anchor_file_path = path_library.join(
      anchors_directory_absolute_path, `character_voice_${standardized_character_name_string}.wav`
    );

    try {
      filesystem_library.copyFileSync(test_take_file_path, destination_anchor_file_path);
      return { success: true, anchor_file_path: destination_anchor_file_path };
    } catch (promote_operation_error) {
      console.error("Failed to promote test take to anchor:", promote_operation_error);
      return { success: false, error: promote_operation_error.message };
    }
  });

  // WHAT: Registering the Save Custom Voice IPC handler.
  ipcMain.handle("audio:save-custom-voice", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, character_name, anchor_file_path, anchor_phrase } = request_arguments;
    const comfyui_api_url_address = "http://127.0.0.1:8188";

    try {
      const workflow_template_absolute_path = path_library.join(__dirname, "..", "comfyui_workflows", "QWEN3-TTS-saveCustomVoice_api.json");
      
      if (!filesystem_library.existsSync(workflow_template_absolute_path)) {
        throw new Error(`ComfyUI workflow not found: ${workflow_template_absolute_path}`);
      }

      const comfyui_workflow_nodes_payload = JSON.parse(filesystem_library.readFileSync(workflow_template_absolute_path, "utf-8"));
      const uuid_string = crypto.randomUUID().substring(0, 8);
      const standardized_character_name_string = character_name.toLowerCase().replace(/\s+/g, "_");
      const standardized_project_name_string = project_name.toLowerCase().replace(/\s+/g, "_");
      const target_filename = `${standardized_project_name_string}_${standardized_character_name_string}_${uuid_string}`;

      const comfyui_base_directory = resolve_comfyui_base_directory();
      const comfyui_input_folder = path_library.join(comfyui_base_directory, "input");
      
      if (!filesystem_library.existsSync(comfyui_input_folder)) {
        filesystem_library.mkdirSync(comfyui_input_folder, { recursive: true });
      }
      
      const staging_filename = `anchor_save_${uuid_string}.wav`;
      const destination_path = path_library.join(comfyui_input_folder, staging_filename);
      filesystem_library.copyFileSync(anchor_file_path, destination_path);

      if (comfyui_workflow_nodes_payload["1"]) {
        comfyui_workflow_nodes_payload["1"].inputs.audio = staging_filename;
      }
      
      if (comfyui_workflow_nodes_payload["2"]) {
        comfyui_workflow_nodes_payload["2"].inputs.ref_text = anchor_phrase || "";
      }
      
      if (comfyui_workflow_nodes_payload["3"]) {
        comfyui_workflow_nodes_payload["3"].inputs.target_text = anchor_phrase;
        comfyui_workflow_nodes_payload["3"].inputs.ref_text = anchor_phrase;
        comfyui_workflow_nodes_payload["3"].inputs.seed = Math.floor(Math.random() * 90000) + 10000;
      }

      delete comfyui_workflow_nodes_payload["3"];
      delete comfyui_workflow_nodes_payload["4"];
      
      if (comfyui_workflow_nodes_payload["5"]) {
        comfyui_workflow_nodes_payload["5"].inputs.filename = target_filename;
        comfyui_workflow_nodes_payload["5"].inputs.ref_text = anchor_phrase || "";
      }

      const payload_data_string = JSON.stringify({
        prompt: comfyui_workflow_nodes_payload,
        client_id: "audiobooks_save_voice_client"
      });

      const execution_response = await new Promise((resolve_request, reject_request) => {
        const post_request = http_client_library.request(`${comfyui_api_url_address}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload_data_string) }
        }, (comfyui_prompt_response_stream) => {
          let comfyui_prompt_response_body = '';
          comfyui_prompt_response_stream.on('data', (response_data_chunk) => {
            comfyui_prompt_response_body += response_data_chunk;
          });
          comfyui_prompt_response_stream.on('end', () => {
            resolve_request(JSON.parse(comfyui_prompt_response_body));
          });
        });
        
        post_request.on('error', reject_request);
        post_request.write(payload_data_string);
        post_request.end();
      });

      if (execution_response.error) {
        console.error("ComfyUI Prompt Validation Error Details:", JSON.stringify(execution_response.error, null, 2));
        throw new Error(`ComfyUI rejected prompt: ${execution_response.error.message || execution_response.error.type}`);
      }

      const prompt_execution_id = execution_response.prompt_id;
      let is_execution_completed = false;
      let polling_loop_limit_counter = 0;

      while (!is_execution_completed && polling_loop_limit_counter < 60) {
        await new Promise((resolve_wait_timeout_promise) => {
          setTimeout(resolve_wait_timeout_promise, 2000);
        });
        
        const queue_history = await fetch_comfyui_queue_history(comfyui_api_url_address, prompt_execution_id);
        if (queue_history && queue_history[prompt_execution_id]) {
          is_execution_completed = true;
        }
        polling_loop_limit_counter++;
      }

      if (!is_execution_completed) {
        throw new Error("ComfyUI timed out while saving custom voice.");
      }

      await refresh_comfyui_models(comfyui_api_url_address);

      return { success: true, saved_filename: target_filename };
    } catch (voice_saving_execution_error) {
      console.error("Save custom voice failed:", voice_saving_execution_error);
      return { success: false, error: voice_saving_execution_error.message };
    }
  });
}

module.exports = {
  register_audio_queue_handlers,
  resolve_comfyui_base_directory,
  fetch_comfyui_queue_history
};

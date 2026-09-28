// =========================================================================
// AUK POST-PRODUCTION AUDIO EDITING SERVICE
// =========================================================================
// WHAT: Applies AuK editing workflows (whisper conversion, speech enhancement,
//       pitch shifting, speed adjustment, volume correction, emotion morphing,
//       de-accenting, speech content editing) to existing audio takes.
// WHY: Empowers creators to refine takes non-destructively, generating incremental
//      takes without overwriting or destroying original voice recordings.

const path_library = require("path");
const filesystem_library = require("fs");
const http_client_library = require("http");

const {
  resolve_comfyui_base_directory,
  fetch_comfyui_queue_history
} = require("./audio_queue_service");

const {
  dispatch_http_post_request
} = require("./ai_pipeline_service");

function register_auk_postprod_handlers(ipcMain) {
  // WHAT: Applies an AuK editing workflow to an existing take audio clip.
  ipcMain.handle("audio:apply-auk-edit", async (ipc_event_context, request_arguments) => {
    const {
      workspace_directory_path,
      project_name,
      is_directorial,
      index_position,
      source_take_file_path,
      edit_task_identifier,
      edit_parameter_value,
      secondary_parameter_value,
      comfyui_api_url_address
    } = request_arguments;

    let staged_temporary_edit_audio_path = null;

    try {
      if (!source_take_file_path || !filesystem_library.existsSync(source_take_file_path)) {
        return { success: false, error: "Source audio take file was not found on disk." };
      }

      const comfyui_is_reachable = await new Promise((resolve_ping_probe) => {
        const ping_connection_probe = http_client_library.get(`${comfyui_api_url_address}/system_stats`, (http_response_object) => {
          resolve_ping_probe(http_response_object.statusCode === 200);
        }).on("error", () => {
          resolve_ping_probe(false);
        });
        ping_connection_probe.setTimeout(2500, () => {
          ping_connection_probe.destroy();
          resolve_ping_probe(false);
        });
      });

      if (!comfyui_is_reachable) {
        return { success: false, error: `ComfyUI server is unreachable at ${comfyui_api_url_address}. Please ensure the server is active.` };
      }

      let workflow_template_filename;
      let resolved_primary_argument_value = edit_parameter_value;
      let resolved_secondary_argument_value = secondary_parameter_value || "";

      switch (edit_task_identifier) {
        case "whisper":
          workflow_template_filename = "AuK-12-Whisper-Conversion_api.json";
          resolved_primary_argument_value = "Convert this speech into a soft whisper while preserving the speaker and content.";
          break;
        case "enhance":
          workflow_template_filename = "AuK-13-Speech-Enhancement_api.json";
          resolved_primary_argument_value = "Preserve all speakers, remove noise and reverberation, and output clean speech of the same length.";
          break;
        case "pitch":
          workflow_template_filename = "AuK-05-Pitch-Editing_api.json";
          resolved_primary_argument_value = String(edit_parameter_value || "+2");
          break;
        case "speed":
          workflow_template_filename = "AuK-06-Speed-Editing_api.json";
          resolved_primary_argument_value = String(edit_parameter_value || "1.15");
          break;
        case "volume":
          workflow_template_filename = "AuK-07-Volume-Editing_api.json";
          resolved_primary_argument_value = String(edit_parameter_value || "+3");
          break;
        case "emotion":
          workflow_template_filename = "AuK-08-Emotion-Editing_api.json";
          const target_emotion_identifier = String(edit_parameter_value || "sad").trim();
          resolved_primary_argument_value = target_emotion_identifier.toLowerCase().startsWith("change the emotion")
            ? target_emotion_identifier
            : `Change the emotion to ${target_emotion_identifier}.`;
          break;
        case "deaccent":
          workflow_template_filename = "AuK-10-De-accent_api.json";
          resolved_primary_argument_value = "Remove the regional accent while preserving the speaker's voice and content.";
          break;
        case "speech_content":
          workflow_template_filename = "AuK-03-Speech-Content-Editing_api.json";
          resolved_primary_argument_value = String(edit_parameter_value || "");
          resolved_secondary_argument_value = String(secondary_parameter_value || "");
          break;
        default:
          return { success: false, error: `Unrecognized AuK edit task identifier: ${edit_task_identifier}` };
      }

      const workflow_template_absolute_path = path_library.join(__dirname, "..", "comfyui_workflows", workflow_template_filename);
      if (!filesystem_library.existsSync(workflow_template_absolute_path)) {
        return { success: false, error: `AuK workflow template ${workflow_template_filename} not found on disk.` };
      }

      const comfyui_workflow_nodes_payload = JSON.parse(filesystem_library.readFileSync(workflow_template_absolute_path, "utf-8"));

      const source_audio_file_extension = path_library.extname(source_take_file_path) || ".wav";
      const staging_audio_filename = `auk_edit_input_${Date.now()}${source_audio_file_extension}`;
      const comfyui_resolved_base_directory = resolve_comfyui_base_directory();
      const absolute_comfyui_staging_path = path_library.join(comfyui_resolved_base_directory, "input", staging_audio_filename);

      const comfyui_input_parent_directory = path_library.dirname(absolute_comfyui_staging_path);
      if (!filesystem_library.existsSync(comfyui_input_parent_directory)) {
        filesystem_library.mkdirSync(comfyui_input_parent_directory, { recursive: true });
      }
      filesystem_library.copyFileSync(source_take_file_path, absolute_comfyui_staging_path);
      staged_temporary_edit_audio_path = absolute_comfyui_staging_path;

      if (comfyui_workflow_nodes_payload["2"]) {
        comfyui_workflow_nodes_payload["2"].inputs.audio = staging_audio_filename;
      }

      if (comfyui_workflow_nodes_payload["3"]) {
        comfyui_workflow_nodes_payload["3"].inputs.primary = resolved_primary_argument_value;
        comfyui_workflow_nodes_payload["3"].inputs.secondary = resolved_secondary_argument_value;
        comfyui_workflow_nodes_payload["3"].inputs.seed = Math.floor(Math.random() * 9000000000) + 100000;
      }

      if (comfyui_workflow_nodes_payload["5"]) {
        comfyui_workflow_nodes_payload["5"].inputs.filename_prefix = `auk/edited_${edit_task_identifier}_${Date.now()}`;
      }

      const comfyui_response_payload = await dispatch_http_post_request(`${comfyui_api_url_address}/prompt`, { prompt: comfyui_workflow_nodes_payload });
      const prompt_execution_id = comfyui_response_payload.prompt_id;

      let rendering_is_completed = false;
      let polling_iterations_counter = 0;
      let rendered_audio_file_path = null;

      while (!rendering_is_completed && polling_iterations_counter < 300) {
        await new Promise(resolve_delay => setTimeout(resolve_delay, 1000));
        const queue_history = await fetch_comfyui_queue_history(comfyui_api_url_address, prompt_execution_id);
        if (queue_history && queue_history[prompt_execution_id]) {
          rendering_is_completed = true;
          const history_entry = queue_history[prompt_execution_id];

          let target_output_node = history_entry.outputs ? history_entry.outputs["5"] : null;
          if (!target_output_node || !target_output_node.audio) {
            for (const output_key of Object.keys(history_entry.outputs || {})) {
              const candidate_node = history_entry.outputs[output_key];
              if (candidate_node && candidate_node.audio && candidate_node.audio.length > 0) {
                target_output_node = candidate_node;
                break;
              }
            }
          }

          if (!target_output_node || !target_output_node.audio || target_output_node.audio.length === 0) {
            throw new Error("AuK editing completed but no audio output was found.");
          }

          const audio_file_info = target_output_node.audio[0];
          const relative_audio_path = path_library.join(audio_file_info.subfolder || "", audio_file_info.filename);
          rendered_audio_file_path = path_library.join(comfyui_resolved_base_directory, "output", relative_audio_path);
        }
        polling_iterations_counter++;
      }

      if (!rendering_is_completed || !rendered_audio_file_path || !filesystem_library.existsSync(rendered_audio_file_path)) {
        throw new Error("AuK editing execution timed out or rendered audio was missing.");
      }

      const target_file_prefix_label = is_directorial ? "line_directorial" : "line";
      const takes_destination_directory_path = path_library.join(
        workspace_directory_path,
        project_name,
        "audio",
        "takes",
        `${target_file_prefix_label}_${index_position}`
      );

      if (!filesystem_library.existsSync(takes_destination_directory_path)) {
        filesystem_library.mkdirSync(takes_destination_directory_path, { recursive: true });
      }

      const existing_take_file_names = filesystem_library.readdirSync(takes_destination_directory_path);
      let highest_take_number_found = 1;
      for (const filename_candidate of existing_take_file_names) {
        const regex_take_match = filename_candidate.match(/take_(\d+)/i);
        if (regex_take_match) {
          const parsed_take_number = parseInt(regex_take_match[1], 10);
          if (parsed_take_number > highest_take_number_found) {
            highest_take_number_found = parsed_take_number;
          }
        }
      }
      const next_take_number = highest_take_number_found + 1;
      const output_audio_extension = path_library.extname(rendered_audio_file_path) || ".flac";
      const destination_take_audio_path = path_library.join(takes_destination_directory_path, `take_${next_take_number}${output_audio_extension}`);

      filesystem_library.copyFileSync(rendered_audio_file_path, destination_take_audio_path);

      return {
        success: true,
        newTakeNumber: next_take_number,
        filePath: destination_take_audio_path,
        task: edit_task_identifier,
        message: `Take ${next_take_number} created with AuK ${edit_task_identifier}.`
      };

    } catch (auk_editing_execution_exception) {
      console.error("AuK edit execution failed:", auk_editing_execution_exception);
      return { success: false, error: auk_editing_execution_exception.message };
    } finally {
      if (staged_temporary_edit_audio_path && filesystem_library.existsSync(staged_temporary_edit_audio_path)) {
        try {
          filesystem_library.unlinkSync(staged_temporary_edit_audio_path);
        } catch (cleanup_filesystem_exception) {
          console.error("Failed to clean up staged edit audio:", cleanup_filesystem_exception);
        }
      }
    }
  });
}

module.exports = {
  register_auk_postprod_handlers
};

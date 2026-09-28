// =========================================================================
// AUDIO FFMPEG & TIMELINE PROCESSING SERVICE
// =========================================================================
// WHAT: Handles audio duration probing, silence-padded multi-take timeline stitching via FFmpeg,
//       direct buffer reads for Web Audio API decoding, and timeline markers CSV parsing.
// WHY: Offloads heavy audio processing and binary manipulation out of the main controller
//      into a dedicated processing service with native FFmpeg error guards.

const path_library = require("path");
const filesystem_library = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegStatic);

function register_audio_ffmpeg_handlers(ipcMain) {
  // WHAT: Get precise duration of an audio file using music-metadata.
  // WHY: Avoids loading the full audio buffer into memory just to check its length.
  ipcMain.handle("audio:get-duration", async (ipc_event_context, request_arguments) => {
    const { file_path } = request_arguments;
    try {
      const musicMetadata = await import("music-metadata");
      const metadata = await musicMetadata.parseFile(file_path, { duration: true });
      return metadata.format.duration || 2.0;
    } catch (metadata_parsing_error) {
      console.error("Failed to parse audio metadata duration:", metadata_parsing_error);
      return 2.0; // Fallback default duration in seconds
    }
  });

  // WHAT: Stitch multiple audio segments together based on absolute timeline positions.
  // WHY: Bypasses browser memory limitations by using native FFmpeg to assemble the final master audio.
  ipcMain.handle("audio:stitch-timeline", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, timeline_data, is_directorial } = request_arguments;
    
    return new Promise((resolve_promise_callback, reject_promise_callback) => {
      try {
        const project_root_directory_path = path_library.join(workspace_directory_path, project_name);
        const output_audio_directory_path = path_library.join(project_root_directory_path, "audio", "master");
        
        if (!filesystem_library.existsSync(output_audio_directory_path)) {
          filesystem_library.mkdirSync(output_audio_directory_path, { recursive: true });
        }

        const formatted_project_name = project_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const output_filename = is_directorial ? `${formatted_project_name}_directorial_mixdown.wav` : `${formatted_project_name}_classic_mixdown.wav`;
        const compiled_master_output_path = path_library.join(output_audio_directory_path, output_filename);

        if (!timeline_data || timeline_data.length === 0) {
          return resolve_promise_callback({ success: false, error: "No timeline data provided." });
        }

        // WHAT: Verifying that each audio file on the timeline physically exists on disk.
        // WHY: Prevents FFmpeg from crashing halfway through stitching if a line was not synthesized yet.
        for (const timeline_audio_clip of timeline_data) {
          if (!filesystem_library.existsSync(timeline_audio_clip.filePath)) {
            return resolve_promise_callback({ 
              success: false, 
              error: `Missing required audio file: ${timeline_audio_clip.filePath}. Please ensure all segments are generated before stitching.` 
            });
          }
        }

        const ffmpeg_command_instance = ffmpeg();
        let complex_filter_chain_string = "";
        let concatenated_audio_inputs_string = "";

        // WHAT: Adding audio inputs to FFmpeg and building silence padding filters.
        // WHY: Inter-line pauses (gap_before) must be preserved in the stitched master file.
        timeline_data.forEach((timeline_audio_clip, clip_index_position) => {
          ffmpeg_command_instance.input(timeline_audio_clip.filePath);
          
          const silence_gap_duration_seconds = timeline_audio_clip.gap_before || 0;
          if (silence_gap_duration_seconds > 0 && clip_index_position < timeline_data.length - 1) {
            complex_filter_chain_string += `[${clip_index_position}:a]apad=pad_dur=${silence_gap_duration_seconds}[aud${clip_index_position}];`;
            concatenated_audio_inputs_string += `[aud${clip_index_position}]`;
          } else {
            concatenated_audio_inputs_string += `[${clip_index_position}:a]`;
          }
        });

        complex_filter_chain_string += `${concatenated_audio_inputs_string}concat=n=${timeline_data.length}:v=0:a=1[aout]`;

        ffmpeg_command_instance
          .complexFilter(complex_filter_chain_string, ["aout"])
          .output(compiled_master_output_path)
          .on("end", () => {
            resolve_promise_callback({ success: true, mixdownAudioPath: compiled_master_output_path });
          })
          .on("error", (ffmpeg_execution_error) => {
            console.error("FFmpeg stitching error:", ffmpeg_execution_error);
            reject_promise_callback(ffmpeg_execution_error);
          })
          .run();

      } catch (timeline_stitching_error) {
        console.error("Failed to stitch timeline:", timeline_stitching_error);
        reject_promise_callback(timeline_stitching_error);
      }
    });
  });

  // WHAT: Reads an audio file directly into memory and returns an ArrayBuffer.
  // WHY: Needed by Peaks.js and Web Audio API for waveform decoding.
  ipcMain.handle("audio:read-file-as-buffer", async (ipc_event_context, request_arguments) => {
    const { file_path } = request_arguments;
    if (!file_path || !filesystem_library.existsSync(file_path)) {
      throw new Error(`Audio file not found at path: ${file_path}`);
    }

    const raw_file_buffer = filesystem_library.readFileSync(file_path);
    return raw_file_buffer.buffer.slice(
      raw_file_buffer.byteOffset,
      raw_file_buffer.byteOffset + raw_file_buffer.byteLength
    );
  });

  // WHAT: Reads and parses timeline markers CSV file for peaks.js interactive waveform display.
  // WHY: Allows the front-end to highlight which character is speaking at every moment on the waveform.
  ipcMain.handle("audio:read-timeline-markers", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, is_directorial } = request_arguments;
    const csv_file_prefix_label = is_directorial ? "timeline_markers_directorial" : "timeline_markers";
    const timeline_csv_absolute_path = path_library.join(
      workspace_directory_path,
      project_name,
      `${csv_file_prefix_label}.csv`
    );

    if (!filesystem_library.existsSync(timeline_csv_absolute_path)) {
      return { markers: [] };
    }

    const raw_csv_file_content = filesystem_library.readFileSync(timeline_csv_absolute_path, "utf-8");
    const csv_content_lines = raw_csv_file_content.split("\n").filter(line_text => line_text.trim().length > 0);

    const parsed_timeline_marker_objects = [];
    for (let line_index = 1; line_index < csv_content_lines.length; line_index++) {
      const current_csv_line = csv_content_lines[line_index];
      const csv_field_extraction_regex = /(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^,]*))/g;
      const extracted_field_values = [];
      let regex_match_result;
      while ((regex_match_result = csv_field_extraction_regex.exec(current_csv_line)) !== null) {
        const field_value = (regex_match_result[1] !== undefined)
          ? regex_match_result[1].replace(/""/g, '"')
          : regex_match_result[2];
        extracted_field_values.push(field_value);
      }

      if (extracted_field_values.length >= 4) {
        parsed_timeline_marker_objects.push({
          index_position: parseInt(extracted_field_values[0], 10),
          speaker: extracted_field_values[1] || "Unknown",
          text: extracted_field_values[2] || "",
          start_time_seconds: parseFloat(extracted_field_values[3]) || 0
        });
      }
    }

    return { markers: parsed_timeline_marker_objects };
  });

  // WHAT: Saves master audio directly from client ArrayBuffer.
  // WHY: Provides an alternative path when the front-end has pre-rendered or modified the audio stream.
  ipcMain.handle("project:save-master-audio", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, array_buffer, is_directorial } = request_arguments;
    const formatted_project_name = project_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const mixdown_file_prefix_label = is_directorial ? `${formatted_project_name}_directorial_mixdown` : `${formatted_project_name}_classic_mixdown`;
    const compiled_book_output_audio_path = path_library.join(workspace_directory_path, project_name, `${mixdown_file_prefix_label}.wav`);
    filesystem_library.writeFileSync(compiled_book_output_audio_path, Buffer.from(array_buffer));
    return { mixdownAudioPath: compiled_book_output_audio_path };
  });
}

module.exports = {
  register_audio_ffmpeg_handlers
};

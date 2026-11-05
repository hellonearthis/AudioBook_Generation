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

/**
 * WHAT: Chunks an array into smaller sub-arrays of specified maximum size.
 * WHY: Prevents exhausting OS open file descriptors (512 limit on Windows) when stitching large audio timelines.
 * 
 * @param {ReadonlyArray<any>} items_list 
 * @param {number} batch_size 
 * @returns {Array<Array<any>>}
 */
function chunk_timeline_into_safe_batches(items_list, batch_size = 45) {
  const batches = [];
  for (let index = 0; index < items_list.length; index += batch_size) {
    batches.push(items_list.slice(index, index + batch_size));
  }
  return batches;
}

/**
 * WHAT: Stitches a single batch of audio clips into a temporary WAV file using FFmpeg filter_complex.
 * 
 * @param {ReadonlyArray<Object>} batch_clips 
 * @param {string} destination_output_path 
 * @returns {Promise<string>} Output file path.
 */
function stitch_single_batch_to_wav(batch_clips, destination_output_path) {
  return new Promise((resolve_batch, reject_batch) => {
    const ffmpeg_command = ffmpeg();
    let complex_filter_chain = "";
    let concatenated_inputs = "";

    batch_clips.forEach((clip, clip_index) => {
      ffmpeg_command.input(clip.filePath);
      const silence_gap = clip.gap_before || 0;
      if (silence_gap > 0 && clip_index < batch_clips.length - 1) {
        complex_filter_chain += `[${clip_index}:a]apad=pad_dur=${silence_gap}[aud${clip_index}];`;
        concatenated_inputs += `[aud${clip_index}]`;
      } else {
        concatenated_inputs += `[${clip_index}:a]`;
      }
    });

    complex_filter_chain += `${concatenated_inputs}concat=n=${batch_clips.length}:v=0:a=1[aout]`;

    ffmpeg_command
      .complexFilter(complex_filter_chain, ["aout"])
      .output(destination_output_path)
      .on("end", () => resolve_batch(destination_output_path))
      .on("error", (error) => reject_batch(error))
      .run();
  });
}

/**
 * WHAT: Concatenates pre-stitched chunk WAV files using FFmpeg's concat demuxer in stream-copy mode.
 * WHY: Zero-reencoding concat takes <0.2 seconds and opens only 1 file at a time, completely immune to file descriptor limits.
 * 
 * @param {ReadonlyArray<string>} chunk_file_paths 
 * @param {string} final_output_master_path 
 * @param {string} temporary_directory_path 
 * @returns {Promise<string>}
 */
function concat_chunk_wav_files_via_demuxer(chunk_file_paths, final_output_master_path, temporary_directory_path) {
  return new Promise((resolve_concat, reject_concat) => {
    const manifest_path = path_library.join(temporary_directory_path, `concat_manifest_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.txt`);
    const manifest_content = chunk_file_paths
      .map(p => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
      .join("\n");

    filesystem_library.writeFileSync(manifest_path, manifest_content, "utf-8");

    ffmpeg()
      .input(manifest_path)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"])
      .output(final_output_master_path)
      .on("end", () => {
        try {
          if (filesystem_library.existsSync(manifest_path)) {
            filesystem_library.unlinkSync(manifest_path);
          }
        } catch (_) {}
        resolve_concat(final_output_master_path);
      })
      .on("error", (error) => {
        try {
          if (filesystem_library.existsSync(manifest_path)) {
            filesystem_library.unlinkSync(manifest_path);
          }
        } catch (_) {}
        reject_concat(error);
      })
      .run();
  });
}

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
  // WHY: Bypasses browser memory limitations and OS file descriptor limits via hierarchical batching and concat demuxer.
  ipcMain.handle("audio:stitch-timeline", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, timeline_data, is_directorial } = request_arguments;
    
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
        return { success: false, error: "No timeline data provided." };
      }

      // WHAT: Verifying that each audio file on the timeline physically exists on disk.
      // WHY: Prevents FFmpeg from crashing halfway through stitching if a line was not synthesized yet.
      for (const timeline_audio_clip of timeline_data) {
        if (!filesystem_library.existsSync(timeline_audio_clip.filePath)) {
          return { 
            success: false, 
            error: `Missing required audio file: ${timeline_audio_clip.filePath}. Please ensure all segments are generated before stitching.` 
          };
        }
      }

      const timeline_batches = chunk_timeline_into_safe_batches(timeline_data, 45);

      if (timeline_batches.length === 1) {
        // WHAT: Fast path for small timelines (<= 45 clips): stitch directly to master output.
        await stitch_single_batch_to_wav(timeline_batches[0], compiled_master_output_path);
        return { success: true, mixdownAudioPath: compiled_master_output_path };
      }

      // WHAT: Large timelines (> 45 clips): hierarchical batching + stream-copy concat demuxer.
      // WHY: Prevents exhausting OS open file descriptors (512 limit on Windows) and eliminates giant filter graphs.
      const temporary_chunk_paths = [];
      const temp_timestamp = Date.now();

      try {
        for (let batch_index = 0; batch_index < timeline_batches.length; batch_index++) {
          const chunk_target_path = path_library.join(
            output_audio_directory_path,
            `temp_stitch_chunk_${temp_timestamp}_${batch_index}.wav`
          );
          await stitch_single_batch_to_wav(timeline_batches[batch_index], chunk_target_path);
          temporary_chunk_paths.push(chunk_target_path);
        }

        await concat_chunk_wav_files_via_demuxer(
          temporary_chunk_paths,
          compiled_master_output_path,
          output_audio_directory_path
        );

        return { success: true, mixdownAudioPath: compiled_master_output_path };
      } finally {
        // Clean up temporary batch files
        for (const temp_chunk_file of temporary_chunk_paths) {
          try {
            if (filesystem_library.existsSync(temp_chunk_file)) {
              filesystem_library.unlinkSync(temp_chunk_file);
            }
          } catch (_) {}
        }
      }
    } catch (timeline_stitching_error) {
      console.error("Failed to stitch timeline:", timeline_stitching_error);
      return { success: false, error: timeline_stitching_error.message };
    }
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
  register_audio_ffmpeg_handlers,
  chunk_timeline_into_safe_batches,
  stitch_single_batch_to_wav,
  concat_chunk_wav_files_via_demuxer
};

// =========================================================================
// PURE FUNCTIONAL AUDIO MASTERING & ASSEMBLY SERVICE
// =========================================================================
// WHAT: Assembles approved audio takes into a master audiobook with calibrated inter-speaker
//       pauses, EBU R128 loudness normalization (-19 LUFS for Audible/ACX compliance),
//       chapter markers, and multi-format export (WAV / M4B / MP3).
// WHY: Delivers distributor-ready audiobooks without manual digital audio workstation (DAW) editing,
//      strictly avoiding artificial room tone as requested.

const path_library = require("path");
const filesystem_library = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * WHAT: Standard pause duration configurations in seconds.
 * WHY: Establishes natural human conversational cadence between distinct speech contexts.
 */
const DEFAULT_PAUSE_CONFIGURATIONS = {
  same_speaker_continuation_seconds: 0.25,  // 250ms between consecutive lines by same voice
  speaker_transition_seconds: 0.45,         // 450ms when switching character turns
  scene_heading_break_seconds: 1.0,         // 1000ms at chapter or scene headings
  paragraph_break_seconds: 0.35             // 350ms between paragraph thoughts
};

/**
 * WHAT: Computes the precise pause duration preceding a segment based on conversational context.
 * WHY: Dialogue turns require longer breathing pauses than monologues; scene shifts require deliberate silence.
 * 
 * @param {Readonly<Object>|null} previous_segment 
 * @param {Readonly<Object>} current_segment 
 * @param {Readonly<Object>} custom_pause_config 
 * @returns {number} Pause duration in seconds.
 */
function compute_inter_segment_pause_duration(
  previous_segment,
  current_segment,
  custom_pause_config = DEFAULT_PAUSE_CONFIGURATIONS
) {
  // WHAT: First segment of the timeline requires zero initial pause padding.
  if (!previous_segment) {
    return 0.0;
  }

  // WHAT: Interrupted dialogue cuts. If the previous speaker was interrupted mid-sentence,
  //       the succeeding line begins immediately with zero pause gap.
  if (
    previous_segment.line_is_interrupted ||
    previous_segment.lineIsInterruptedByNextSpeaker ||
    previous_segment.is_interrupted ||
    current_segment.interrupts_previous_speaker
  ) {
    return 0.0;
  }

  // WHAT: Respect explicit director or dramatic pause overrides on the current or previous segment.
  if (typeof current_segment.secondsOfSilenceBeforeLine === "number" && current_segment.secondsOfSilenceBeforeLine >= 0) {
    return current_segment.secondsOfSilenceBeforeLine;
  }
  if (typeof current_segment.pause_before_seconds === "number" && current_segment.pause_before_seconds >= 0) {
    return current_segment.pause_before_seconds;
  }
  if (typeof current_segment.gap_before === "number" && current_segment.gap_before >= 0) {
    return current_segment.gap_before;
  }
  if (typeof current_segment.pause_before === "number" && current_segment.pause_before >= 0) {
    return current_segment.pause_before;
  }
  if (typeof previous_segment.secondsOfSilenceAfterLine === "number" && previous_segment.secondsOfSilenceAfterLine >= 0) {
    return previous_segment.secondsOfSilenceAfterLine;
  }
  if (typeof previous_segment.pause_after_seconds === "number" && previous_segment.pause_after_seconds >= 0) {
    return previous_segment.pause_after_seconds;
  }

  const is_scene_heading = (current_segment.type === "scene_heading") ||
                           Boolean(current_segment.is_scene_break) ||
                           (current_segment.text && current_segment.text.toUpperCase().startsWith("SCENE"));

  if (is_scene_heading) {
    return custom_pause_config.scene_heading_break_seconds;
  }

  const previous_speaker = (previous_segment.speaker || "narrator").trim().toLowerCase();
  const current_speaker = (current_segment.speaker || "narrator").trim().toLowerCase();

  // WHAT: Switching speakers (e.g. Character A -> Character B, or Narrator -> Character).
  if (previous_speaker !== current_speaker) {
    return custom_pause_config.speaker_transition_seconds;
  }

  // WHAT: Same speaker continuing.
  return custom_pause_config.same_speaker_continuation_seconds;
}

/**
 * WHAT: Generates standard FFMETADATA format text containing chapter markers.
 * WHY: Allows players (Apple Books, Audible, Smart AudioBook Player) to jump between chapters with names.
 * 
 * @param {Readonly<{ title: string, author?: string, chapters: ReadonlyArray<{ title: string, start_seconds: number, end_seconds: number }> }>} project_metadata 
 * @returns {string} FFMETADATA formatted string.
 */
function generate_ffmetadata_file_content(project_metadata) {
  const metadata_lines = [
    ";FFMETADATA1",
    `title=${project_metadata.title || "Audiobook"}`,
    `artist=${project_metadata.author || "Author"}`,
    `album=${project_metadata.title || "Audiobook"}`
  ];

  const chapters_list = project_metadata.chapters || [];
  for (let chapter_index = 0; chapter_index < chapters_list.length; chapter_index++) {
    const chapter_entry = chapters_list[chapter_index];
    const start_time_milliseconds = Math.round((chapter_entry.start_seconds || 0) * 1000);
    const end_time_milliseconds = Math.round((chapter_entry.end_seconds || chapter_entry.start_seconds || 0) * 1000);

    metadata_lines.push(
      "",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${start_time_milliseconds}`,
      `END=${end_time_milliseconds}`,
      `title=${chapter_entry.title || `Chapter ${chapter_index + 1}`}`
    );
  }

  return metadata_lines.join("\n") + "\n";
}

const { resolve_acoustic_filter_chain } = require("./special_content_service");

/**
 * WHAT: Builds the FFmpeg audio filter chain for timeline stitching, acoustic coloring, and EBU R128 loudness normalization.
 * WHY: Applies silence padding (apad) on clips, inserts acoustic transmission filters (phone, radio, wall) per segment,
 *      and passes the concatenated mixdown into loudnorm.
 * 
 * @param {ReadonlyArray<{ filePath: string, pause_duration_seconds: number, acoustic_filter?: string, transmission_context?: string }>} timeline_clips 
 * @param {number} target_lufs_integrated - Target integrated loudness in LUFS (-19 typical).
 * @returns {{ readonly filter_chain_string: string, readonly output_label: string }}
 */
function build_ffmpeg_filter_chain(timeline_clips, target_lufs_integrated = -19) {
  if (!timeline_clips || timeline_clips.length === 0) {
    return { filter_chain_string: "", output_label: "" };
  }

  let filter_steps = "";
  let concatenated_input_labels = "";

  for (let clip_index = 0; clip_index < timeline_clips.length; clip_index++) {
    const pause_seconds = timeline_clips[clip_index].pause_duration_seconds || 0;
    const acoustic_filter_name = timeline_clips[clip_index].acoustic_filter || timeline_clips[clip_index].transmission_context || null;
    const resolved_acoustic_filter = acoustic_filter_name ? resolve_acoustic_filter_chain(acoustic_filter_name) : "anull";
    const has_acoustic_filter = resolved_acoustic_filter !== "anull";

    // WHAT: Build filter chain for this clip stream.
    if (has_acoustic_filter && pause_seconds > 0) {
      filter_steps += `[${clip_index}:a]${resolved_acoustic_filter},apad=pad_dur=${pause_seconds}[processed_${clip_index}];`;
      concatenated_input_labels += `[processed_${clip_index}]`;
    } else if (has_acoustic_filter) {
      filter_steps += `[${clip_index}:a]${resolved_acoustic_filter}[processed_${clip_index}];`;
      concatenated_input_labels += `[processed_${clip_index}]`;
    } else if (pause_seconds > 0) {
      filter_steps += `[${clip_index}:a]apad=pad_dur=${pause_seconds}[processed_${clip_index}];`;
      concatenated_input_labels += `[processed_${clip_index}]`;
    } else {
      concatenated_input_labels += `[${clip_index}:a]`;
    }
  }

  // WHAT: Concatenate all streams, then apply EBU R128 loudnorm filter.
  // loudnorm=I=-19:TP=-1.5:LRA=11 enforces industry distributor standards.
  filter_steps += `${concatenated_input_labels}concat=n=${timeline_clips.length}:v=0:a=1[concatenated_mix];`;
  filter_steps += `[concatenated_mix]loudnorm=I=${target_lufs_integrated}:TP=-1.5:LRA=11[master_audio_out]`;

  return {
    filter_chain_string: filter_steps,
    output_label: "master_audio_out"
  };
}

/**
 * WHAT: Locates the best available audio take file for a given screenplay segment.
 * WHY: Checks for directorial take first if requested, then standard take in order of take numbers.
 * 
 * @param {string} project_root_directory_path 
 * @param {number} segment_index_position 
 * @param {boolean} is_directorial 
 * @returns {string|null} Path to audio take file or null if not synthesized.
 */
function resolve_segment_audio_take_file_path(project_root_directory_path, segment_index_position, is_directorial = false) {
  const target_file_prefix = is_directorial ? "line_directorial" : "line";
  const takes_folder_path = path_library.join(
    project_root_directory_path,
    "audio",
    "takes",
    `${target_file_prefix}_${segment_index_position}`
  );

  if (!filesystem_library.existsSync(takes_folder_path)) {
    // WHAT: Fallback to non-directorial folder if directorial is missing.
    const fallback_folder_path = path_library.join(
      project_root_directory_path,
      "audio",
      "takes",
      `line_${segment_index_position}`
    );
    if (!filesystem_library.existsSync(fallback_folder_path)) {
      return null;
    }
    return get_latest_take_in_directory(fallback_folder_path);
  }

  return get_latest_take_in_directory(takes_folder_path);
}

/**
 * WHAT: Helper resolving the highest take number file in a take folder.
 */
function get_latest_take_in_directory(directory_path) {
  try {
    const files_in_folder = filesystem_library.readdirSync(directory_path);
    const audio_take_files = files_in_folder.filter((filename) =>
      filename.startsWith("take_") && (filename.endsWith(".wav") || filename.endsWith(".mp3") || filename.endsWith(".flac"))
    );

    if (audio_take_files.length === 0) {
      return null;
    }

    // Sort descending by take number
    audio_take_files.sort((a, b) => {
      const num_a = parseInt((a.match(/\d+/) || ["0"])[0], 10);
      const num_b = parseInt((b.match(/\d+/) || ["0"])[0], 10);
      return num_b - num_a;
    });

    return path_library.join(directory_path, audio_take_files[0]);
  } catch (error) {
    return null;
  }
}

/**
 * WHAT: Assembles project audio into master normalized files.
 * WHY: Orchestrates timeline construction, pause calculation, and FFmpeg loudnorm rendering.
 * 
 * @param {Readonly<Object>} assembly_request_payload 
 * @returns {Promise<Object>} Result object with generated master audio paths.
 */
async function assemble_project_audio_master(assembly_request_payload) {
  const {
    workspace_directory_path,
    project_name,
    is_directorial = false,
    target_lufs = -19,
    export_format = "wav", // "wav", "mp3", or "m4b"
    custom_pause_config = DEFAULT_PAUSE_CONFIGURATIONS
  } = assembly_request_payload;

  const project_root_directory_path = path_library.join(workspace_directory_path, project_name);
  const master_output_directory_path = path_library.join(project_root_directory_path, "audio", "master");

  if (!filesystem_library.existsSync(master_output_directory_path)) {
    filesystem_library.mkdirSync(master_output_directory_path, { recursive: true });
  }

  const project_state_file_path = path_library.join(project_root_directory_path, "project_state.json");
  if (!filesystem_library.existsSync(project_state_file_path)) {
    throw new Error(`Project state file does not exist at: ${project_state_file_path}`);
  }

  const project_state_payload = JSON.parse(filesystem_library.readFileSync(project_state_file_path, "utf-8"));
  const segments_list = is_directorial
    ? (project_state_payload.directorialSegments || project_state_payload.scriptSegments || [])
    : (project_state_payload.scriptSegments || []);

  if (segments_list.length === 0) {
    throw new Error("No screenplay segments found in project state.");
  }

  // WHAT: Resolving existing audio take files for each segment and computing pauses.
  const timeline_clips = [];
  const missing_segment_indices = [];

  for (let segment_index = 0; segment_index < segments_list.length; segment_index++) {
    const current_segment = segments_list[segment_index];
    const previous_segment = segment_index > 0 ? segments_list[segment_index - 1] : null;
    const resolved_take_file_path = resolve_segment_audio_take_file_path(
      project_root_directory_path,
      current_segment.index_position ?? segment_index,
      is_directorial
    );

    if (!resolved_take_file_path || !filesystem_library.existsSync(resolved_take_file_path)) {
      missing_segment_indices.push(current_segment.index_position ?? segment_index);
      continue;
    }

    const calculated_pause_duration = compute_inter_segment_pause_duration(
      previous_segment,
      current_segment,
      custom_pause_config
    );

    timeline_clips.push({
      segment_index: current_segment.index_position ?? segment_index,
      speaker: current_segment.speaker,
      filePath: resolved_take_file_path,
      pause_duration_seconds: calculated_pause_duration
    });
  }

  if (timeline_clips.length === 0) {
    throw new Error(`No synthesized audio takes found to assemble. Missing all ${missing_segment_indices.length} segments.`);
  }

  const sanitized_project_name = project_name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const normalized_output_filename = `${sanitized_project_name}_master_${target_lufs}lufs.${export_format}`;
  const compiled_master_output_path = path_library.join(master_output_directory_path, normalized_output_filename);

  const { filter_chain_string, output_label } = build_ffmpeg_filter_chain(timeline_clips, target_lufs);

  return new Promise((resolve_promise, reject_promise) => {
    const ffmpeg_command_instance = ffmpeg();

    for (let clip_index = 0; clip_index < timeline_clips.length; clip_index++) {
      ffmpeg_command_instance.input(timeline_clips[clip_index].filePath);
    }

    ffmpeg_command_instance
      .complexFilter(filter_chain_string, [output_label])
      .output(compiled_master_output_path);

    if (export_format === "mp3") {
      ffmpeg_command_instance.audioCodec("libmp3lame").audioBitrate(192);
    } else if (export_format === "m4b") {
      ffmpeg_command_instance.audioCodec("aac").audioBitrate(128);
    }

    ffmpeg_command_instance
      .on("end", () => {
        resolve_promise({
          success: true,
          masterAudioPath: compiled_master_output_path,
          clipsAssembledCount: timeline_clips.length,
          missingSegmentsCount: missing_segment_indices.length,
          missingSegmentIndices: missing_segment_indices,
          targetLufs: target_lufs,
          exportFormat: export_format
        });
      })
      .on("error", (ffmpeg_error) => {
        console.error("Mastering assembly error:", ffmpeg_error);
        reject_promise(ffmpeg_error);
      })
      .run();
  });
}

/**
 * WHAT: Registers IPC handlers for the audio mastering service.
 * WHY: Bridges Electron IPC calls from the studio frontend to the mastering engine.
 * 
 * @param {Object} ipcMain 
 */
function register_audio_mastering_handlers(ipcMain) {
  ipcMain.handle("mastering:assemble-project-audio", async (ipc_event_context, request_arguments) => {
    try {
      const assembly_result = await assemble_project_audio_master(request_arguments);
      return { success: true, ...assembly_result };
    } catch (assembly_error) {
      console.error("Audio mastering failed:", assembly_error);
      return { success: false, error: assembly_error.message };
    }
  });

  ipcMain.handle("mastering:preview-chapter-timeline", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, is_directorial, custom_pause_config } = request_arguments;
    const project_root_directory_path = path_library.join(workspace_directory_path, project_name);
    const project_state_file_path = path_library.join(project_root_directory_path, "project_state.json");

    if (!filesystem_library.existsSync(project_state_file_path)) {
      return { success: false, error: "Project state file not found." };
    }

    const state_payload = JSON.parse(filesystem_library.readFileSync(project_state_file_path, "utf-8"));
    const segments = is_directorial ? (state_payload.directorialSegments || []) : (state_payload.scriptSegments || []);

    const timeline_preview_items = [];
    let cumulative_time_seconds = 0;

    for (let index = 0; index < segments.length; index++) {
      const current_seg = segments[index];
      const prev_seg = index > 0 ? segments[index - 1] : null;
      const pause = compute_inter_segment_pause_duration(prev_seg, current_seg, custom_pause_config);
      cumulative_time_seconds += pause;

      timeline_preview_items.push({
        index_position: current_seg.index_position ?? index,
        speaker: current_seg.speaker,
        text_preview: (current_seg.text || "").substring(0, 60),
        pause_before_seconds: pause,
        estimated_start_time_seconds: cumulative_time_seconds
      });

      // Rough duration estimate for preview
      const word_count = (current_seg.text || "").split(/\s+/).filter(Boolean).length;
      cumulative_time_seconds += Math.max(1.5, word_count / 2.5);
    }

    return {
      success: true,
      timeline: timeline_preview_items,
      total_estimated_duration_seconds: cumulative_time_seconds
    };
  });
}

module.exports = {
  DEFAULT_PAUSE_CONFIGURATIONS,
  compute_inter_segment_pause_duration,
  generate_ffmetadata_file_content,
  build_ffmpeg_filter_chain,
  resolve_segment_audio_take_file_path,
  assemble_project_audio_master,
  register_audio_mastering_handlers
};


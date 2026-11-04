// WHAT: Importing the standard Electron modules necessary for context isolation and IPC communication.
// WHY: We need to expose safe, selected APIs from the node environment to the front-end renderer process.
const { contextBridge, ipcRenderer } = require("electron");

// WHAT: Creating the secure bridge between the isolated renderer context and the main Node.js process.
// WHY: By using contextBridge, we prevent the renderer from accessing raw Node.js APIs directly, avoiding security holes.
contextBridge.exposeInMainWorld("audiobook_api", {
  
  // WHAT: Function to select a workspace directory where projects are stored.
  // WHY: The user needs to choose a local disk directory using native dialogue boxes to read/write book files.
  select_workspace_directory: () => {
    // WHAT: Triggering the folder dialog channel on the main IPC channel.
    // WHY: Native GUI dialogs can only be launched from the main Electron process.
    return ipcRenderer.invoke("dialog:select-workspace-directory");
  },

  // WHAT: Function to load all existing projects from the chosen workspace directory.
  // WHY: The UI needs to list all previously started audiobook projects to allow switching.
  list_audiobook_projects: (workspace_directory_path) => {
    // WHAT: Invoking the IPC handler to retrieve all subfolders corresponding to projects.
    // WHY: The filesystem search needs to execute in the Main process safely.
    return ipcRenderer.invoke("project:list-projects", workspace_directory_path);
  },

  // WHAT: Function to initialize a new audiobook project with a raw text book file.
  // WHY: The user uploads a TXT file which starts a new audiobook project session.
  create_new_audiobook_project: (workspace_directory_path, project_name, raw_book_text_content) => {
    // WHAT: Forwarding the project configuration and source book text to the backend.
    // WHY: Setting up file structures, subfolders, and JSON state must occur on the OS filesystem.
    return ipcRenderer.invoke("project:create-project", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      raw_book_text_content: raw_book_text_content
    });
  },

  // WHAT: Function to retrieve details about an active project's state.
  // WHY: When opening a project, we load its segments, voice maps, and text from the local disk state.
  load_audiobook_project_state: (workspace_directory_path, project_name) => {
    // WHAT: Requesting the loaded JSON state from the main process.
    // WHY: Keeps UI state synchronized with the persistent JSON state stored in the directory.
    return ipcRenderer.invoke("project:load-state", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name
    });
  },

  // WHAT: Save project state to disk.
  // WHY: Whenever the user edits characters, performance notes, or script dialogue, we immediately save to avoid data loss.
  save_audiobook_project_state: (workspace_directory_path, project_name, project_state_data) => {
    // WHAT: Sending the state data to the main process file saver.
    // WHY: Keeps the file persistence layer clean and separated from UI code.
    return ipcRenderer.invoke("project:save-state", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      project_state_data: project_state_data
    });
  },

  // WHAT: Request LLM to discover characters and compile the Global Cast Profile.
  // WHY: Pass 1 of our pipeline calls an external LLM running locally to extract characters from a book segment.
  trigger_global_cast_extraction: (book_text_segment, lm_studio_api_url_address, workspace_directory_path, project_name) => {
    // WHAT: Sending text segment to the backend LLM wrapper.
    // WHY: The backend orchestrates the HTTP connection securely and handles API request formats.
    return ipcRenderer.invoke("ai:extract-cast", {
      book_text_segment: book_text_segment,
      lm_studio_api_url_address: lm_studio_api_url_address,
      workspace_directory_path: workspace_directory_path,
      project_name: project_name
    });
  },

  // WHAT: Request LLM to parse text and attribute paragraphs to speakers in JSON format.
  // WHY: Pass 2 of the pipeline converts blocks of prose into a structured screenplay.
  trigger_dialogue_attribution: (book_text_segment, lm_studio_api_url_address) => {
    // WHAT: Sending text segments to the LLM backend to execute dialogue attribution.
    // WHY: Offloads heavy network JSON processing to the native process thread.
    return ipcRenderer.invoke("ai:attribute-dialogue", {
      book_text_segment: book_text_segment,
      lm_studio_api_url_address: lm_studio_api_url_address
    });
  },

  // WHAT: Query health and model loading status of the local Laya Decision Engine (port 8765).
  // WHY: Lets the UI detect whether sub-25ms fast classification is available.
  check_laya_status: (laya_endpoint_url) => {
    return ipcRenderer.invoke("ai:laya-status", {
      laya_endpoint_url: laya_endpoint_url
    });
  },

  // WHAT: Tests if Laya NPU service is running on demand, and launches it if offline.
  // WHY: Allows the frontend UI to ensure the Intel AI Boost NPU engine is running.
  ensure_laya_ready: () => {
    return ipcRenderer.invoke("ai:ensure-laya-ready");
  },

  // WHAT: Ultra-fast Dialogue Attribution and Emotional Staging via Laya (~17-25ms forward passes).
  // WHY: Non-autoregressive classification eliminates LLM latency and JSON hallucination risk.
  trigger_laya_attribution: (attribution_options) => {
    return ipcRenderer.invoke("ai:laya-attribute", attribution_options);
  },

  // WHAT: Query accumulated QC calibration logs and task decision counts.
  // WHY: Displays empirical calibration status and sample counts in developer settings.
  get_qc_calibration_stats: () => {
    return ipcRenderer.invoke("ai:get-qc-calibration-stats");
  },

  // WHAT: Run empirical temperature calibration re-fit on logged decisions.
  // WHY: Solves optimal task temperatures T dynamically from real audiobook decisions.
  run_qc_calibration: () => {
    return ipcRenderer.invoke("ai:run-qc-calibration");
  },

  // WHAT: Submit human verdict on a logged QC decision (Phase 2).
  // WHY: Converts natural editorial review and card edits into labeled ground truth for calibration.
  record_human_verdict: (record_id, verdict, notes) => {
    return ipcRenderer.invoke("ai:record-human-verdict", { id: record_id, verdict, notes });
  },

  // WHAT: Run Pass 3 to generate emotional directions / performance instructions for screenplay segments.
  // WHY: Generates parenthetical stage directions for our Instruct-TTS synthesis engine.
  trigger_emotional_staging: (preceding_context_lines, target_sentence_text, succeeding_context_lines, lm_studio_api_url_address) => {
    // WHAT: Sending a text window containing preceding lines, target sentence, and succeeding lines.
    // WHY: Gives the LLM context to determine appropriate acting instructions (e.g. fear, whispering).
    return ipcRenderer.invoke("ai:generate-emotional-staging", {
      preceding_context_lines: preceding_context_lines,
      target_sentence_text: target_sentence_text,
      succeeding_context_lines: succeeding_context_lines,
      lm_studio_api_url_address: lm_studio_api_url_address
    });
  },

  // WHAT: Directorial Staging and Speech Tag Harvester (Pass 2.6).
  // WHY: Synthesizes micro-level vocal acoustics, prosody, style, and emotion into screenplay cards.
  enrich_directorial_staging: (script_segments, voice_mapping, relationships) => {
    return ipcRenderer.invoke("ai:enrich-directorial-staging", {
      script_segments: script_segments,
      voice_mapping: voice_mapping,
      relationships: relationships
    });
  },

  // WHAT: Merges two directorial segment styles into a single unified style using local LLM / llama.cpp.
  // WHY: Facilitates the smart "Combine Cells" feature using explicit narrative flow instructions.
  trigger_style_merge_via_llm: (cell1_text, cell1_style, cell2_text, cell2_style, transition_instructions, lm_studio_api_url_address) => {
    return ipcRenderer.invoke("llm:merge-qwen-styles", {
      cell1_text: cell1_text,
      cell1_style: cell1_style,
      cell2_text: cell2_text,
      cell2_style: cell2_style,
      transition_instructions: transition_instructions,
      lm_studio_api_url_address: lm_studio_api_url_address
    });
  },

  // WHAT: Add specific text segments into the sequential ComfyUI voice generation queue.
  // WHY: Pass 4 coordinates local speech synthesis without freezing the UI.
  enqueue_speech_generation_task: (workspace_directory_path, project_name, script_segment_data, voice_configuration_mapping, comfyui_api_url_address, take_number) => {
    // WHAT: Sending the script line, voice mappings, and active take number to the background worker.
    // WHY: Keeps sequential file numbering in check and prevents overwriting prior audio takes.
    return ipcRenderer.invoke("audio:enqueue-generation", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      script_segment_data: script_segment_data,
      voice_configuration_mapping: voice_configuration_mapping,
      comfyui_api_url_address: comfyui_api_url_address,
      take_number: take_number
    });
  },

  // WHAT: Save the final arranged master audio buffer directly to disk.
  // WHY: Replaces the backend stitching. Waveform-Playlist renders the mixdown in the browser, and we just save the final blob.
  save_audiobook_mixdown: (workspace_directory_path, project_name, array_buffer, is_directorial_segment_flag) => {
    return ipcRenderer.invoke("project:save-master-audio", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      array_buffer: array_buffer,
      is_directorial: is_directorial_segment_flag ? true : false
    });
  },

  // WHAT: Run the new Directorial Orchestration Pipeline to generate Intent-rich segments and 8D Vectors.
  // WHY: Pass 2 & 3 merger converts prose text into a directorial script using our specialized system prompt.
  trigger_directorial_script_generation: (book_text_segment, lm_studio_api_url_address, workspace_directory_path, project_name, voice_mapping_context, forced_speaker_id = null, sliding_window_context = null, relationships_context = null) => {
    // WHAT: Dispatching book segment to the new IPC channel on the backend.
    // WHY: Keeps LLM processing safe and off the main UI rendering thread.
    return ipcRenderer.invoke("ai:generate-directorial-script", {
      book_text_segment: book_text_segment,
      lm_studio_api_url_address: lm_studio_api_url_address,
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      voice_mapping_context: voice_mapping_context,
      forced_speaker_id: forced_speaker_id,
      sliding_window_context: sliding_window_context,
      relationships_context: relationships_context
    });
  },

  // WHAT: Run Pass 2.5 Relationship State Engine to detect state transitions between character pairs.
  // WHY: Updates chronological relationship timelines in project_state so Pass 3 directorial staging receives active relationship state.
  run_relationship_delta_pass: (scene_segments, current_relationships, active_scene_cast, lm_studio_api_url_address) => {
    return ipcRenderer.invoke("ai:run-relationship-delta-pass", {
      scene_segments: scene_segments,
      current_relationships: current_relationships,
      active_scene_cast: active_scene_cast,
      lm_studio_api_url_address: lm_studio_api_url_address
    });
  },

  // WHAT: Add specific directorial segments to the background sequential synthesis queue.
  // WHY: Pass 4 directorial worker coordinates speech generation including hooks and vectors.
  enqueue_directorial_speech_generation_task: (workspace_directory_path, project_name, script_segment_data, voice_configuration_mapping, comfyui_api_url_address, take_number) => {
    // WHAT: Invoking the directorial enqueuer IPC route.
    // WHY: Passes intent metrics, reference hooks, emotion weights, and take number down to the ComfyUI handler sequentially.
    return ipcRenderer.invoke("audio:enqueue-directorial-generation", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      script_segment_data: script_segment_data,
      voice_configuration_mapping: voice_configuration_mapping,
      comfyui_api_url_address: comfyui_api_url_address,
      take_number: take_number
    });
  },

  // WHAT: Retrieve detected references for a character (emotion MP3s + transcriptions).
  // WHY: Needed to populate the Voice Clone configuration lists in our settings modal dynamically.
  get_character_references: (workspace_directory_path, project_name, character_name) => {
    return ipcRenderer.invoke("references:get-character-references", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      character_name: character_name
    });
  },

  // WHAT: Delete a specific audio take file from the filesystem securely.
  // WHY: Restricts deletion to paths contained strictly within the project boundaries.
  delete_take_file: (workspace_directory_path, project_name, is_directorial, index_position, take_number, extension) => {
    return ipcRenderer.invoke("project:delete-take", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      is_directorial: is_directorial,
      index_position: index_position,
      take_number: take_number,
      extension: extension
    });
  },

  // WHAT: Retrieve the health and status of the background queue.
  // WHY: Lets the frontend query queue contents to restore active statuses if needed.
  get_queue_status: () => {
    return ipcRenderer.invoke("audio:get-queue-status");
  },

  // WHAT: Force the backend queue to reset and clear all pending tasks.
  // WHY: The "manual boop" to recover from stuck ComfyUI states.
  reset_stuck_queue: () => {
    return ipcRenderer.invoke("audio:reset-queue");
  },

  // WHAT: Subscribes to warning events emitted during LLM requests.
  // WHY: Allows the frontend to display context or loading warnings in the UI.
  subscribe_to_lm_studio_warnings: (callback_function_for_warnings) => {
    ipcRenderer.on("system:lm-studio-warning", (event_source, warning_message_string) => {
      callback_function_for_warnings(warning_message_string);
    });
  },

  // WHAT: Registers a listener function to track real-time audio generation status updates.
  // WHY: Updates progress bars and synthesis indicators dynamically in the UI.
  subscribe_to_generation_status_updates: (callback_function_for_updates) => {
    // WHAT: Binding an IPC event listener to catch updates from the main thread.
    // WHY: Allows asynchronous event flows from backend processes back to the renderer.
    ipcRenderer.on("audio:generation-status-update", (event_source, progress_update_payload) => {
      callback_function_for_updates(progress_update_payload);
    });
  },

  // WHAT: Registers a listener function to track real-time dialogue attribution progress (lines, paragraphs, speakers).
  // WHY: Powers real-time line-by-line status updates, progress bars, and character tags in the screenplay editor.
  subscribe_to_attribution_progress: (callback_function_for_updates) => {
    ipcRenderer.on("system:attribution-progress", (event_source, progress_update_payload) => {
      callback_function_for_updates(progress_update_payload);
    });
  },

  // WHAT: Sends a single mixed cell text to LLM to be split into clean screenplay segments.
  // WHY: Allows the user to right-click any card and have the AI separate dialogue from narrator attribution accurately.
  trigger_segment_ai_split: (cell_text, lm_studio_api_url_address) => {
    return ipcRenderer.invoke("ai:split-segment", {
      cell_text: cell_text,
      lm_studio_api_url_address: lm_studio_api_url_address
    });
  },

  // WHAT: Reads a local audio file from disk and returns its raw binary content as an ArrayBuffer.
  // WHY: Peaks.js needs raw audio bytes to decode waveform data via the Web Audio API.
  //      This bridge provides a secure IPC path for the sandboxed renderer to access local files.
  read_audio_file_as_buffer: (file_path_string) => {
    return ipcRenderer.invoke("audio:read-file-as-buffer", {
      file_path: file_path_string
    });
  },

  // WHAT: Reads and parses the timeline markers CSV file generated during audio stitching.
  // WHY: Peaks.js uses these markers to render labeled segment overlays on the waveform,
  //      showing exactly where each character speaks throughout the audiobook timeline.
  read_timeline_markers: (workspace_directory_path, project_name, is_directorial_flag) => {
    return ipcRenderer.invoke("audio:read-timeline-markers", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      is_directorial: is_directorial_flag
    });
  },

  // WHAT: Launch native OS popup context menu for cell operations.
  // WHY: Safer and feels more native than an HTML div overlay.
  show_native_context_menu: () => {
    return ipcRenderer.invoke("ui:show-context-menu");
  },

  // WHAT: Get audio file duration efficiently without loading the file.
  // WHY: Replaces Web Audio API for performance.
  get_audio_duration: (file_path_string) => {
    return ipcRenderer.invoke("audio:get-duration", {
      file_path: file_path_string
    });
  },

  // WHAT: Stitch the audio timeline using background FFmpeg.
  // WHY: Avoids browser memory limits.
  stitch_timeline: (workspace_directory_path, project_name, timeline_data, is_directorial_flag) => {
    return ipcRenderer.invoke("audio:stitch-timeline", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      timeline_data: timeline_data,
      is_directorial: is_directorial_flag
    });
  },

  // WHAT: Triggers the Voice Anchor Baking pipeline for a specific character.
  // WHY: Step 1 of the Two-Step Voice Cloning pipeline. Runs VoiceDesign once to generate a master
  //      anchor WAV that structurally locks the character's voice identity. All subsequent renders
  //      will automatically reroute through VoiceClone ICL mode using this anchor as reference.
  bake_voice_anchor: (workspace_directory_path, project_name, character_name, design_prompt, anchor_phrase, seed_value, comfyui_api_url_address) => {
    return ipcRenderer.invoke("audio:bake-voice-anchor", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      character_name: character_name,
      design_prompt: design_prompt,
      anchor_phrase: anchor_phrase,
      seed_value: seed_value,
      comfyui_api_url_address: comfyui_api_url_address
    });
  },

  // WHAT: Promotes a test audio generation directly to a master anchor file.
  // WHY: Bypasses the need to re-bake an anchor if the user already generated a perfect test take.
  promote_test_to_anchor: (workspace_directory_path, project_name, character_name, test_take_file_path) => {
    return ipcRenderer.invoke("audio:promote-test-to-anchor", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      character_name: character_name,
      test_take_file_path: test_take_file_path
    });
  },

  // WHAT: Saves a custom voice anchor directly to ComfyUI's model directory.
  // WHY: Enables the loadCustomVoice workflow for faster generation and better persistence.
  save_custom_voice: (workspace_directory_path, project_name, character_name, anchor_file_path, anchor_phrase) => {
    return ipcRenderer.invoke("audio:save-custom-voice", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      character_name: character_name,
      anchor_file_path: anchor_file_path,
      anchor_phrase: anchor_phrase
    });
  },

  // WHAT: Opens a specific file's parent folder in the native OS file explorer.
  // WHY: Allows the user to quickly access their exported audio mixes without digging through the file system.
  open_file_folder: (file_path_string) => {
    return ipcRenderer.invoke("system:open-file-folder", {
      file_path: file_path_string
    });
  },

  // WHAT: Opens external URLs (e.g. llama-server Web UI, Laya/CLM docs) safely in default browser.
  // WHY: Gives the user a one-click way to view and inspect active AI server operations.
  open_external_url: (target_url_string) => {
    return ipcRenderer.invoke("system:open-external-url", {
      url: target_url_string
    });
  },

  // WHAT: Applies an AuK editing workflow to an existing take audio clip.
  // WHY: Allows the frontend script editor to invoke post-processing (whisper, pitch, speed, volume, denoise, emotion) on takes.
  apply_auk_audio_edit: (edit_request_configuration_payload) => {
    return ipcRenderer.invoke("audio:apply-auk-edit", edit_request_configuration_payload);
  },

  // WHAT: Exports screenplay segments into standard Fountain plain-text format.
  // WHY: Allows opening and proofreading scripts in screenwriting software like Beat or VS Code.
  export_fountain_screenplay: (export_configuration_payload) => {
    return ipcRenderer.invoke("fountain:export-script", export_configuration_payload);
  },

  // WHAT: Imports standard Fountain plain-text scripts and parses them into screenplay segments.
  // WHY: Enables round-trip editing where human changes in Beat can be re-imported into the audiobook engine.
  import_fountain_screenplay: (import_configuration_payload) => {
    return ipcRenderer.invoke("fountain:import-script", import_configuration_payload);
  },

  // WHAT: Calculates Beat-style screenplay statistics, casting tiers, and attribution sanity checks.
  // WHY: Displays character speaking distribution, estimated runtimes, and detects misattributed lines.
  compute_screenplay_analytics: (analytics_request_payload) => {
    return ipcRenderer.invoke("fountain:compute-analytics", analytics_request_payload);
  },

  // WHAT: Aggregates screenplay segments into high-level scene index cards.
  // WHY: Provides a visual overview of characters present, synopses, and relationship dynamics before rendering.
  generate_scene_outline_cards: (outline_request_payload) => {
    return ipcRenderer.invoke("fountain:generate-outline-cards", outline_request_payload);
  },

  // WHAT: Compares script revisions against audio cache to compute a surgical diff re-render plan.
  // WHY: Avoids regenerating unaltered audio, saving GPU compute time.
  compute_revision_diff: (diff_request_payload) => {
    return ipcRenderer.invoke("fountain:compute-revision-diff", diff_request_payload);
  },

  // WHAT: Sanitizes manuscript prose (curled quotes, em-dashes, soft line breaks, footnote stripping).
  // WHY: Normalizes raw prose for LLM attribution and TTS pronunciation.
  sanitize_manuscript_text: (raw_text, options) => {
    const { sanitize_book_manuscript_text } = require("./services/text_sanitizer_service");
    return sanitize_book_manuscript_text(raw_text, options);
  },

  // WHAT: Detects chapter and section boundaries in book manuscript text.
  // WHY: Allows the user to switch between chapters and work on smaller chunks without UI slowdowns.
  detect_manuscript_chapters: (text) => {
    const { detect_manuscript_chapters } = require("./services/text_sanitizer_service");
    return detect_manuscript_chapters(text);
  },

  // WHAT: Validates synthesized speech audio takes against expected script dialogue using Whistle STT.
  // WHY: Evaluates whether TTS model matched dialogue text with strict 90% threshold, word diffs, and latency telemetry.
  validate_audio_take: (file_path, expected_text, options) => {
    return ipcRenderer.invoke("audio:validate-take", {
      file_path: file_path,
      expected_text: expected_text,
      options: options || {}
    });
  },

  // WHAT: Queries Whistle engine readiness and local installation status.
  // WHY: Allows the UI to check if the 16.9 MB CPU speech model is operational.
  get_whistle_status: () => {
    return ipcRenderer.invoke("audio:get-whistle-status");
  },

  // WHAT: Loads the pronunciation lexicon dictionary for a project.
  // WHY: Provides custom phonetic overrides for fantasy names, technical terms, and acronyms.
  get_project_lexicon: (workspace_directory_path, project_name) => {
    return ipcRenderer.invoke("lexicon:get-project-lexicon", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name
    });
  },

  // WHAT: Saves updated pronunciation lexicon entries to `<project>/lexicon.json`.
  // WHY: Persists user-defined vocabulary rules to disk.
  save_project_lexicon: (workspace_directory_path, project_name, entries) => {
    return ipcRenderer.invoke("lexicon:save-project-lexicon", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      entries: entries
    });
  },

  // WHAT: Previews phonetic lexicon substitutions on sample text passages without modifying disk.
  // WHY: Gives the user immediate feedback on how words will be respelled for TTS.
  preview_lexicon_replacements: (text, entries) => {
    return ipcRenderer.invoke("lexicon:preview-replacements", {
      text: text,
      entries: entries
    });
  },

  // WHAT: Assembles project audio into master normalized files with calibrated pauses and -19 LUFS loudnorm.
  // WHY: Automates final publication-ready audio assembly without manual DAW editing or artificial room tone.
  assemble_project_audio: (assembly_options) => {
    return ipcRenderer.invoke("mastering:assemble-project-audio", assembly_options);
  },

  // WHAT: Previews the timeline pause progression across character lines and scene breaks.
  // WHY: Visualizes pause durations and estimated cumulative chapter runtime.
  preview_chapter_timeline: (preview_options) => {
    return ipcRenderer.invoke("mastering:preview-chapter-timeline", preview_options);
  },

  // WHAT: Scans manuscript for rare capitalized words, proper nouns, and acronyms for pronunciation review.
  // WHY: Discovers fantasy names and unusual terms before synthesis begins.
  scan_manuscript_rare_tokens: (text, options) => {
    return ipcRenderer.invoke("lexicon:scan-manuscript-tokens", {
      text: text,
      options: options || {}
    });
  },

  // WHAT: Restores unfinished tasks from disk into the live audio generation queue.
  // WHY: Recovers gracefully after application restart or ComfyUI crash without losing batch progress.
  restore_audio_queue: (workspace_directory_path, project_name) => {
    return ipcRenderer.invoke("audio:restore-queue", {
      workspace_directory_path: workspace_directory_path,
      project_name: project_name
    });
  },

  // WHAT: Sorts screenplay segments into a risk-prioritized "Listen by Exception" review queue.
  // WHY: Focuses human review on the top 10% risky lines with combined attribution, STT, pacing, and timbre signals.
  build_risk_prioritized_review_queue: (screenplay_segments, filter_options) => {
    const { build_risk_prioritized_review_queue } = require("./services/triage_risk_service");
    return build_risk_prioritized_review_queue(screenplay_segments, filter_options);
  },

  // WHAT: Resolves nicknames, titles, and conversational aliases to single canonical character IDs.
  // WHY: Prevents wrong voice casting from nickname or honorific variations.
  resolve_character_alias: (candidate_speaker_name, cast_profiles_list) => {
    const { build_character_alias_index, resolve_speaker_alias } = require("./services/character_alias_service");
    const alias_index = build_character_alias_index(cast_profiles_list);
    return resolve_speaker_alias(candidate_speaker_name, alias_index);
  },

  // WHAT: Models character emotional intensity progression, exponential decay, and discrete bands.
  // WHY: Enforces smooth emotional arcs across scenes rather than erratic line-by-line guessing.
  update_character_emotional_intensity: (parameters_payload) => {
    const { update_character_emotional_intensity } = require("./services/emotional_arc_service");
    return update_character_emotional_intensity(parameters_payload);
  },

  // WHAT: Resolves discrete 1-5 intensity band descriptor for an emotion and continuous level.
  // WHY: Maps continuous sliders to discrete acting adjectives for AuK and Qwen3.
  resolve_emotional_intensity_band: (emotion, intensity_value) => {
    const { resolve_emotional_intensity_band } = require("./services/emotional_arc_service");
    return resolve_emotional_intensity_band(emotion, intensity_value);
  },

  // WHAT: Resolves initial baseline tension floor from active relationship state.
  // WHY: Hostile and tense relationships start scenes with higher baseline tension.
  resolve_relationship_emotional_baseline: (relationship_status, tone) => {
    const { resolve_relationship_emotional_baseline } = require("./services/emotional_arc_service");
    return resolve_relationship_emotional_baseline(relationship_status, tone);
  },

  // WHAT: Retrieves standard multi-length audition test sentences for voice calibration passes.
  // WHY: Fixed sentences allow empirical measurement of identity and intensity limits across bands.
  get_calibration_test_sentences: () => {
    return ipcRenderer.invoke("calibration:get-test-sentences");
  },

  // WHAT: Fetches a character's saved empirical capability and band limit profile from disk.
  // WHY: Guides directorial staging to avoid requesting vocal extremes that distort identity.
  get_character_calibration_profile: (workspace_directory_path, project_name, character_name) => {
    return ipcRenderer.invoke("calibration:get-profile", {
      workspace_directory_path,
      project_name,
      character_name
    });
  },

  // WHAT: Persists a character's measured calibration profile to disk.
  // WHY: Stores empirical per-band thresholds, caps, and compensation rules for the character.
  save_character_calibration_profile: (workspace_directory_path, project_name, character_name, profile) => {
    return ipcRenderer.invoke("calibration:save-profile", {
      workspace_directory_path,
      project_name,
      character_name,
      profile
    });
  },

  // WHAT: Pure functional remapper adapting story directorial requests to character limits.
  // WHY: Downward-remaps requests exceeding voice caps and injects pacing compensation cues.
  remap_staging_for_character_limits: (staging_request) => {
    return ipcRenderer.invoke("calibration:remap-staging", staging_request);
  },

  // WHAT: Extracts dialogue lines from the manuscript matching a character, emotion, and band as audition test lines.
  // WHY: Auditioning and profiling a character on their actual dialogue tests true cadence, prose style, and emotion.
  extract_calibration_test_lines_from_book: (screenplay_segments, character_identifier, target_emotion, target_band_number, options) => {
    return ipcRenderer.invoke("calibration:extract-book-test-lines", {
      screenplay_segments,
      character_identifier,
      target_emotion,
      target_band_number,
      options
    });
  },

  // WHAT: Compiles an advanced multi-layered performance instruction for AuK Instruct-TTS.
  // WHY: Formats subtext (displayed vs felt emotion), distance, emphasis, physical states, and director notes into prompt.
  compile_advanced_performance_instruction: (performance_record, dialogue_text) => {
    const { compile_advanced_auk_performance_instruction } = require("./services/performance_direction_service");
    return compile_advanced_auk_performance_instruction(performance_record, dialogue_text);
  },

  // WHAT: Derives dramatic pause timing and interruption flags between adjacent dialogue segments.
  // WHY: Computes pauses based on emotional tension, trailing ellipses, and interruption cuts.
  derive_dramatic_pause_timing: (current_segment, preceding_segment) => {
    const { derive_dramatic_pause_timing } = require("./services/performance_direction_service");
    return derive_dramatic_pause_timing(current_segment, preceding_segment);
  },

  // WHAT: Detects inner thoughts, italics, and internal monologues for intimate delivery treatment.
  // WHY: Differentiates internal character thoughts from outward dialogue and narrator prose.
  detect_inner_thought_content: (segment) => {
    const { detect_inner_thought_content } = require("./services/special_content_service");
    return detect_inner_thought_content(segment);
  },

  // WHAT: Resolves FFmpeg filter chains for phone calls, radio intercoms, and voices through walls.
  // WHY: Colors transmission contexts authentically in post-production without re-rendering voice takes.
  resolve_acoustic_filter_chain: (acoustic_context_name) => {
    const { resolve_acoustic_filter_chain } = require("./services/special_content_service");
    return resolve_acoustic_filter_chain(acoustic_context_name);
  },

  // WHAT: Resolves which voice reads letters, text messages, and emails per book policy.
  // WHY: Supports sender-voice, recipient-voice, or formal-narrator reading conventions.
  resolve_epistolary_reader_speaker: (epistolary_context) => {
    const { resolve_epistolary_reader_speaker } = require("./services/special_content_service");
    return resolve_epistolary_reader_speaker(epistolary_context);
  },

  // WHAT: Deterministically maps minor incidental characters to a reusable voice pool.
  // WHY: Prevents the overhead of creating 40 separate voice clones for one-line characters.
  assign_minor_character_voice_pool: (minor_character_name, gender_hint) => {
    const { assign_minor_character_voice_pool } = require("./services/special_content_service");
    return assign_minor_character_voice_pool(minor_character_name, gender_hint);
  },

  // WHAT: Computes word-level timestamp intervals and forced alignment across a spoken take.
  // WHY: Enables WebVTT subtitles, EPUB3 media overlays, and precise audio trimming.
  compute_word_level_timestamps: (dialogue_text, total_audio_duration_seconds, stt_observed_tokens) => {
    const { compute_word_level_timestamps } = require("./services/forced_alignment_service");
    return compute_word_level_timestamps(dialogue_text, total_audio_duration_seconds, stt_observed_tokens);
  },

  // WHAT: Exports W3C WebVTT subtitle track cues for word-level sync.
  export_webvtt_cues: (word_intervals, timeline_offset_seconds) => {
    const { export_webvtt_cues } = require("./services/forced_alignment_service");
    return export_webvtt_cues(word_intervals, timeline_offset_seconds);
  },

  // WHAT: Exports EPUB3 SMIL Media Overlays XML document for synchronized eBook read-alongs.
  export_epub3_smil_media_overlay: (smil_payload) => {
    const { export_epub3_smil_media_overlay } = require("./services/forced_alignment_service");
    return export_epub3_smil_media_overlay(smil_payload);
  },

  // WHAT: Calculates production efficiency metrics (review minutes per hour, false positive rate, re-render rate).
  calculate_pipeline_telemetry_metrics: (telemetry_payload) => {
    const { calculate_pipeline_telemetry_metrics } = require("./services/pipeline_metrics_service");
    return calculate_pipeline_telemetry_metrics(telemetry_payload);
  },

  // WHAT: Loads saved pipeline efficiency metrics from disk.
  load_pipeline_metrics: (workspace_directory_path, project_name) => {
    const { load_pipeline_metrics } = require("./services/pipeline_metrics_service");
    return load_pipeline_metrics(workspace_directory_path, project_name);
  },

  // WHAT: Saves pipeline efficiency metrics to disk.
  save_pipeline_metrics: (workspace_directory_path, project_name, metrics_payload) => {
    const { save_pipeline_metrics } = require("./services/pipeline_metrics_service");
    return save_pipeline_metrics(workspace_directory_path, project_name, metrics_payload);
  },

  // =========================================================================
  // MULTI-CHAPTER MANUSCRIPT & SHARED GLOBAL CAST MANAGEMENT
  // =========================================================================

  // WHAT: Splits raw book manuscript into discrete chapter records while preserving global cast.
  split_manuscript_into_chapters: (raw_manuscript_text) => {
    return ipcRenderer.invoke("chapter:split-manuscript", { raw_manuscript_text });
  },

  // WHAT: Upgrades existing single-chapter project state to multi-chapter while preserving global cast.
  upgrade_project_to_multichapter: (current_project_state, raw_text_or_chapters) => {
    return ipcRenderer.invoke("chapter:upgrade-project-state", { current_project_state, raw_text_or_chapters });
  },

  // WHAT: Switches active editor chapter while retaining global cast.
  switch_active_chapter: (project_state, target_chapter_id) => {
    return ipcRenderer.invoke("chapter:switch-active-chapter", { project_state, target_chapter_id });
  },

  // WHAT: Saves segments and text for a specific chapter back into project state.
  save_chapter_segments: (project_state, chapter_id, updated_script_segments, updated_raw_text) => {
    return ipcRenderer.invoke("chapter:save-chapter-segments", { project_state, chapter_id, updated_script_segments, updated_raw_text });
  },

  // WHAT: Compiles continuous master timeline segments across all chapters for full-book export.
  compile_master_book_timeline: (project_state) => {
    return ipcRenderer.invoke("chapter:compile-master-timeline", { project_state });
  },

  // =========================================================================
  // DIRECT AUDIO VOICE IMPORT & PHONETIC CALIBRATION TUNING
  // =========================================================================

  // WHAT: Opens native OS file dialog to select reference audio file (.wav, .mp3, .m4a, .flac, .ogg).
  select_audio_file: () => {
    return ipcRenderer.invoke("dialog:select-audio-file");
  },

  // WHAT: Retrieves list of standardized phonetic tuning test phrases.
  get_phonetic_test_sentences: () => {
    return ipcRenderer.invoke("voice:get-phonetic-test-sentences");
  },

  // WHAT: Imports an external audio file as a character reference voice (skips 100% synthetic VoiceDesign).
  import_character_voice_audio: (request_options) => {
    return ipcRenderer.invoke("voice:import-reference-audio", request_options);
  },

  // WHAT: Generates phonetic tuning task payload to synthesize calibration test phrase with clone.
  create_phonetic_tuning_task: (request_options) => {
    return ipcRenderer.invoke("voice:create-phonetic-tuning-task", request_options);
  },

  // WHAT: Evaluates completed phonetic tuning take and updates character calibration profile.
  evaluate_phonetic_tuning: (request_options) => {
    return ipcRenderer.invoke("voice:evaluate-phonetic-tuning", request_options);
  }
});



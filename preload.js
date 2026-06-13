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

  // WHAT: Request LM Studio to discover characters and compile the Global Cast Profile.
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

  // WHAT: Request LM Studio to parse text and attribute paragraphs to speakers in JSON format.
  // WHY: Pass 2 of the pipeline converts blocks of prose into a structured screenplay.
  trigger_dialogue_attribution: (book_text_segment, lm_studio_api_url_address) => {
    // WHAT: Sending text segments to the LLM backend to execute dialogue attribution.
    // WHY: Offloads heavy network JSON processing to the native process thread.
    return ipcRenderer.invoke("ai:attribute-dialogue", {
      book_text_segment: book_text_segment,
      lm_studio_api_url_address: lm_studio_api_url_address
    });
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

  // WHAT: Merges two directorial segment styles into a single unified style using LM Studio.
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
  trigger_directorial_script_generation: (book_text_segment, lm_studio_api_url_address, workspace_directory_path, project_name, voice_mapping_context, forced_speaker_id = null, sliding_window_context = null) => {
    // WHAT: Dispatching book segment to the new IPC channel on the backend.
    // WHY: Keeps LLM processing safe and off the main UI rendering thread.
    return ipcRenderer.invoke("ai:generate-directorial-script", {
      book_text_segment: book_text_segment,
      lm_studio_api_url_address: lm_studio_api_url_address,
      workspace_directory_path: workspace_directory_path,
      project_name: project_name,
      voice_mapping_context: voice_mapping_context,
      forced_speaker_id: forced_speaker_id,
      sliding_window_context: sliding_window_context
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

  // WHAT: Subscribes to warning events emitted during LM Studio requests.
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

  // WHAT: Sends a single mixed cell text to LM Studio to be split into clean screenplay segments.
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
  }
});

// WHAT: Importing standard Node.js and Electron core libraries.
// WHY: We need path resolution, file system access, HTTP client, and Electron main process components.
const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net } = require("electron");
const path_library = require("path");
const filesystem_library = require("fs");
const http_client_library = require("http");
const child_process_library = require("child_process");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const crypto = require("crypto");
ffmpeg.setFfmpegPath(ffmpegStatic);

// WHAT: Registering the custom "peaksaudio" protocol scheme as privileged before app is ready.
// WHY: Peaks.js needs to fetch() audio files for Web Audio API decoding. Because the renderer
//      runs with sandbox: true, standard file:// URLs are blocked by Chromium's security policy.
//      By registering a custom protocol as "standard" and "supportFetchAPI", the sandboxed
//      renderer can call fetch("peaksaudio:///path/to/file.wav") and receive the raw audio bytes
//      served securely from the main process. The "corsEnabled" flag prevents CORS blocks.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "peaksaudio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

// WHAT: Declaring variables for the primary application window and the active audio synthesis queue.
// WHY: These must reside at the module level to maintain references and orchestrate sequential execution.
let primary_application_window = null;
let audio_generation_task_queue = [];
let audio_generation_queue_is_processing = false;

// WHAT: Creating the main desktop application window.
// WHY: This initiates the visual environment for the user, pointing to the index.html file in the renderer.
function create_primary_desktop_window() {
  // WHAT: Instantiating BrowserWindow with custom sizes and secure settings.
  // WHY: Context isolation and secure preload configuration protect the operating system from untrusted render scripts.
  primary_application_window = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1000,
    minHeight: 700,
    title: "AI Audiobook Screenplay Generator & Synthesizer",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path_library.join(__dirname, "preload.js")
    }
  });

  // WHAT: Loading the index.html layout inside the application window.
  // WHY: The front-end is rendered via standard web technologies.
  primary_application_window.loadFile(path_library.join(__dirname, "renderer", "index.html"));

  // WHAT: Hooking the window closed event.
  // WHY: We clean up variables and release resources when the UI is terminated.
  primary_application_window.on("closed", () => {
    primary_application_window = null;
  });
}

// WHAT: Handling application boot lifecycle.
// WHY: Electron requires waiting until app initialization is finished before creating UI windows.
app.whenReady().then(() => {
  // WHAT: Registering the peaksaudio:// protocol handler to serve local audio files to the renderer.
  // WHY: Peaks.js in the sandboxed renderer uses fetch() to download audio data for waveform
  //      decoding. This handler intercepts peaksaudio:// requests, validates the file path
  //      exists on disk, and streams the raw bytes back with the correct MIME type.
  //      Security: we do NOT restrict to workspace paths here because the renderer only ever
  //      constructs URLs from workspace-derived paths. The protocol is not exposed externally.
  protocol.handle("peaksaudio", (incoming_protocol_request) => {
    // WHAT: Extracting the absolute file path from the custom protocol URL.
    // WHY: The renderer encodes the path as peaksaudio:///C:/path/to/file.wav — we decode it
    //      back to a standard filesystem path so we can read the file with Node's fs module.
    const requested_url_object = new URL(incoming_protocol_request.url);
    let decoded_file_system_path = decodeURIComponent(requested_url_object.pathname);

    // WHAT: Reconstructing Windows drive letters from the URL hostname if present.
    // WHY: Chromium's URL parser for standard schemes converts "protocol:///C:/" into hostname "c", pathname "/".
    if (process.platform === "win32" && requested_url_object.hostname && requested_url_object.hostname.length === 1) {
      decoded_file_system_path = `${requested_url_object.hostname}:${decoded_file_system_path}`;
    }

    // WHAT: Stripping the leading slash on Windows paths (e.g. "/C:/foo" becomes "C:/foo").
    // WHY: Windows absolute paths don't start with a forward slash, but URL pathnames always do.
    if (process.platform === "win32" && decoded_file_system_path.startsWith("/")) {
      decoded_file_system_path = decoded_file_system_path.substring(1);
    }

    // WHAT: Checking if the requested audio file actually exists before attempting to serve it.
    // WHY: Returning a clean 404-style error response prevents peaks.js from crashing on missing files.
    if (!filesystem_library.existsSync(decoded_file_system_path)) {
      return new Response("Audio file not found on disk.", { status: 404 });
    }

    // WHAT: Determining the correct MIME type based on file extension.
    // WHY: The Web Audio API and peaks.js require correct Content-Type headers to decode audio.
    const file_extension_lowercase = path_library.extname(decoded_file_system_path).toLowerCase();
    const mime_type_lookup_table = {
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".flac": "audio/flac",
      ".m4a": "audio/mp4"
    };
    const resolved_content_type_string = mime_type_lookup_table[file_extension_lowercase] || "application/octet-stream";

    // WHAT: Reading the entire audio file into memory and returning it as a Response object.
    // WHY: Peaks.js calls fetch() and then response.arrayBuffer() to feed into Web Audio API.
    const audio_file_raw_buffer = filesystem_library.readFileSync(decoded_file_system_path);
    return new Response(audio_file_raw_buffer, {
      status: 200,
      headers: {
        "Content-Type": resolved_content_type_string,
        "Content-Length": String(audio_file_raw_buffer.length)
      }
    });
  });

  create_primary_desktop_window();

  // WHAT: Mac OS specific window recovery setup.
  // WHY: Keeps application running in tray/dock and recreates window when clicked if none exist.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      create_primary_desktop_window();
    }
  });
});

// WHAT: Handling standard application close events across all platforms.
// WHY: Windows and Linux terminate the process when all windows are closed, while macOS stays active.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// =========================================================================
// IPC HANDLERS - WORKSPACE & FILE MANAGEMENT
// =========================================================================

// WHAT: Registering native open folder dialog IPC service.
// WHY: Allows the front-end to request the user to select their main project storage folder.
ipcMain.handle("dialog:select-workspace-directory", async () => {
  // WHAT: Opening native OS dialog window filter for directories.
  // WHY: Using electron's native file dialogues provides a native user experience.
  const dialog_selection_result = await dialog.showOpenDialog(primary_application_window, {
    properties: ["openDirectory"]
  });

  // WHAT: Returning chosen path or null if selection is aborted.
  // WHY: Let the renderer know if the operation was cancelled or completed.
  if (dialog_selection_result.canceled) {
    return null;
  } else {
    return dialog_selection_result.filePaths[0];
  }
});

// WHAT: Handler to list all audiobook projects in a designated workspace.
// WHY: Reads folder names representing existing books to display inside the project list view.
ipcMain.handle("project:list-projects", async (ipc_event_context, workspace_directory_path) => {
  // WHAT: Verifying if the workspace directory exists on disk.
  // WHY: Prevents crash if directory is missing or deleted manually by the user.
  if (!filesystem_library.existsSync(workspace_directory_path)) {
    return [];
  }

  // WHAT: Reading directory children directories.
  // WHY: Every audiobook project lives in its own subdirectory inside the main workspace.
  const workspace_contents = filesystem_library.readdirSync(workspace_directory_path, { withFileTypes: true });
  const list_of_project_folder_names = [];

  // WHAT: Iterating through each folder child item.
  // WHY: We filter out plain files to identify directories that represent valid projects.
  for (let index_counter = 0; index_counter < workspace_contents.length; index_counter++) {
    const active_file_system_node = workspace_contents[index_counter];
    if (active_file_system_node.isDirectory()) {
      const state_file_path = path_library.join(workspace_directory_path, active_file_system_node.name, "project_state.json");
      // WHAT: Checking if the project has a valid project state descriptor.
      // WHY: Guarantees we only list folders that contain an actual initialized project state.
      if (filesystem_library.existsSync(state_file_path)) {
        list_of_project_folder_names.push(active_file_system_node.name);
      }
    }
  }

  return list_of_project_folder_names;
});

// WHAT: Creating and initializing folder structures for a new book project.
// WHY: We separate text, states, and audios inside unique subdirectories to ensure organized local storage.
ipcMain.handle("project:create-project", async (ipc_event_context, request_arguments) => {
  const { workspace_directory_path, project_name, raw_book_text_content } = request_arguments;
  const project_root_directory = path_library.join(workspace_directory_path, project_name);
  const project_audio_directory = path_library.join(project_root_directory, "audio");
  const project_anchors_directory = path_library.join(project_audio_directory, "anchors");

  // WHAT: Creating the project root directory and subdirectories on disk recursively.
  // WHY: Directory structures must exist before we can write initial project state and audio segments.
  if (!filesystem_library.existsSync(project_root_directory)) {
    filesystem_library.mkdirSync(project_root_directory, { recursive: true });
  }
  if (!filesystem_library.existsSync(project_audio_directory)) {
    filesystem_library.mkdirSync(project_audio_directory, { recursive: true });
  }
  // WHAT: Creating the voice anchors directory for the Bake-Once Clone-Always pipeline.
  // WHY: Each character's master anchor WAV is saved here to structurally anchor their voice identity
  //      across all subsequent generation requests, preventing timbre drift.
  if (!filesystem_library.existsSync(project_anchors_directory)) {
    filesystem_library.mkdirSync(project_anchors_directory, { recursive: true });
  }

  // WHAT: Saving a local copy of the raw source text document.
  // WHY: Keeps a reference of original text inside the project directory for processing pipelines.
  const book_raw_text_storage_path = path_library.join(project_root_directory, "book.txt");
  filesystem_library.writeFileSync(book_raw_text_storage_path, raw_book_text_content, "utf-8");

  // WHAT: Generating the initial, default structure for the project state JSON file.
  // WHY: This file serves as the database for script segments, character maps, and rendering flags.
  const initial_project_state_schema = {
    projectName: project_name,
    createdTimestamp: Date.now(),
    voiceMapping: {},
    scriptSegments: [],
    directorialSegments: [],
    rawBookText: raw_book_text_content
  };

  const project_state_file_path = path_library.join(project_root_directory, "project_state.json");
  filesystem_library.writeFileSync(
    project_state_file_path,
    JSON.stringify(initial_project_state_schema, null, 2),
    "utf-8"
  );

  return initial_project_state_schema;
});

// WHAT: Reading a project's state from disk.
// WHY: Allows the user to load previously saved configurations and screenplay segments.
ipcMain.handle("project:load-state", async (ipc_event_context, request_arguments) => {
  const { workspace_directory_path, project_name } = request_arguments;
  const project_state_file_path = path_library.join(workspace_directory_path, project_name, "project_state.json");

  // WHAT: Fetching files from the disk directory.
  // WHY: Ensures state loaded exists, returning error details if missing.
  if (!filesystem_library.existsSync(project_state_file_path)) {
    throw new Error("Project state file does not exist on disk.");
  }

  const raw_serialized_state_data = filesystem_library.readFileSync(project_state_file_path, "utf-8");
  return JSON.parse(raw_serialized_state_data);
});

// WHAT: Writing updated state parameters back into the persistent project file on disk.
// WHY: When changes are made, we maintain up-to-date states in case the application restarts.
ipcMain.handle("project:save-state", async (ipc_event_context, request_arguments) => {
  const { workspace_directory_path, project_name, project_state_data } = request_arguments;
  const project_state_file_path = path_library.join(workspace_directory_path, project_name, "project_state.json");

  // WHAT: Serializing and flushing the state database to the project directory.
  // WHY: Avoids data corruption by writing a clean, formatted JSON file.
  filesystem_library.writeFileSync(
    project_state_file_path,
    JSON.stringify(project_state_data, null, 2),
    "utf-8"
  );

  return true;
});

// WHAT: Get precise duration of an audio file using music-metadata.
// WHY: Avoids loading the full audio buffer into memory just to check its length.
ipcMain.handle("audio:get-duration", async (ipc_event_context, request_arguments) => {
  const { file_path } = request_arguments;
  try {
    // Dynamically import music-metadata as it is an ESM-only package
    const musicMetadata = await import("music-metadata");
    const metadata = await musicMetadata.parseFile(file_path, { duration: true });
    return metadata.format.duration || 2.0;
  } catch (error) {
    console.error("Failed to parse audio metadata duration:", error);
    return 2.0; // Fallback
  }
});

// WHAT: Stitch multiple audio segments together based on absolute timeline positions.
// WHY: Bypasses browser memory limitations by using native FFmpeg to assemble the final master audio.
ipcMain.handle("audio:stitch-timeline", async (ipc_event_context, request_arguments) => {
  const { workspace_directory_path, project_name, timeline_data, is_directorial } = request_arguments;
  
  return new Promise((resolve, reject) => {
    try {
      const project_root = path_library.join(workspace_directory_path, project_name);
      const output_dir = path_library.join(project_root, "audio", "master");
      
      if (!filesystem_library.existsSync(output_dir)) {
        filesystem_library.mkdirSync(output_dir, { recursive: true });
      }

      const formatted_project_name = project_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const output_filename = is_directorial ? `${formatted_project_name}_directorial_mixdown.wav` : `${formatted_project_name}_classic_mixdown.wav`;
      const output_path = path_library.join(output_dir, output_filename);

      if (timeline_data.length === 0) {
        return resolve({ success: false, error: "No timeline data provided." });
      }

      const command = ffmpeg();
      let filter_complex = "";
      let mix_inputs = "";

      timeline_data.forEach((clip, index) => {
        command.input(clip.filePath);
        
        // WHAT: Fetch the desired gap interval.
        // WHY: We pad the end of this current clip with silence so the next clip starts after the gap.
        const gap = clip.gap_before || 0;
        
        // Only pad if there is a next clip in the sequence to transition into.
        if (gap > 0 && index < timeline_data.length - 1) {
          filter_complex += `[${index}:a]apad=pad_dur=${gap}[aud${index}];`;
          concat_inputs += `[aud${index}]`;
        } else {
          concat_inputs += `[${index}:a]`;
        }
      });

      // WHAT: Concatenate all processed audio streams end-to-end.
      // WHY: concat natively decodes stream lengths, preventing overlap or cut-offs caused by imprecise metadata approximations.
      filter_complex += `${concat_inputs}concat=n=${timeline_data.length}:v=0:a=1[aout]`;

      command
        .complexFilter(filter_complex, ["aout"])
        .output(output_path)
        .on("end", () => {
          resolve({ success: true, mixdownAudioPath: output_path });
        })
        .on("error", (ffmpeg_execution_error) => {
          console.error("FFmpeg stitching error:", ffmpeg_execution_error);
          reject(ffmpeg_execution_error);
        })
        .run();

    } catch (error) {
      console.error("Failed to stitch timeline:", error);
      reject(error);
    }
  });
});

// WHAT: Registering the dynamic take file deletion IPC service.
// WHY: Gives the UI a secure, sandbox-compliant mechanism to delete a specific audio take from the filesystem,
//      guaranteeing that deleted files are strictly contained within the active project root directory to prevent path traversal exploits.
ipcMain.handle("project:delete-take", async (ipc_event_context, request_arguments) => {
  const { workspace_directory_path, project_name, is_directorial, index_position, take_number, extension } = request_arguments;
  
  const target_file_prefix_label = is_directorial ? "line_directorial" : "line";
  const project_root_directory = path_library.join(workspace_directory_path, project_name);
  const target_take_file_path = path_library.join(
    project_root_directory,
    "audio",
    "takes",
    `${target_file_prefix_label}_${index_position}`,
    `take_${take_number}${extension}`
  );

  // WHAT: Ensuring target file resides strictly within our active project boundaries.
  // WHY: Protects the user's operating system from malicious path injection or traversal attempts.
  if (!target_take_file_path.startsWith(project_root_directory)) {
    return { success: false, error: "Target take audio file access is restricted." };
  }

  // WHAT: Check if the file exists on disk.
  // WHY: If it's already missing, we still want to report success so the UI can clear out "ghost" state records.
  if (!filesystem_library.existsSync(target_take_file_path)) {
    return { success: true, message: "File already missing from disk, but state cleared." };
  }

  try {
    // WHAT: Deleting the audio take file synchronously.
    // WHY: Frees disk space and clears cached takes immediately.
    filesystem_library.unlinkSync(target_take_file_path);
    return { success: true };
  } catch (filesystem_deletion_exception) {
    console.error("Failed to delete active take file:", filesystem_deletion_exception);
    return { success: false, error: filesystem_deletion_exception.message };
  }
});

// =========================================================================
// IPC HANDLERS - LM STUDIO API WORKERS (PASS 1, 2, 3)
// =========================================================================

// WHAT: Local utility function to dispatch clean POST requests to a local HTTP service.
// WHY: LM Studio doesn't require complex wrappers, standard HTTP requests are lightweight and dependable.

// WHAT: Normalizing any "localhost" string in a URL to the literal IPv4 address 127.0.0.1.
// WHY: Node.js v17+ resolves the hostname "localhost" through the OS DNS resolver, which on
//      modern systems returns the IPv6 address ::1 first. LM Studio binds only to IPv4
//      (0.0.0.0 / 127.0.0.1), so a connection attempt to ::1 is immediately refused.
//      Replacing "localhost" with the literal "127.0.0.1" bypasses DNS entirely and
//      guarantees the TCP connection reaches the correct network interface.
function normalize_localhost_url_to_ipv4_address(input_url_string) {
  return input_url_string.replace(/^(https?:\/\/)localhost/i, "$1127.0.0.1");
}

// WHAT: Extracting the first valid JSON object or array from free-form LLM output text.
// WHY: Without JSON mode enforced (which chromadb-context-1 does not support), the model
//      may wrap its JSON in markdown code fences like ```json ... ``` or prepend
//      explanatory sentences. This function strips all decoration and returns pure
//      parsed JSON, or throws if no valid JSON block can be found.
function extract_json_from_llm_response_text(raw_llm_output_text) {
  // WHAT: Stripping markdown code fences (```json ... ``` or ``` ... ```).
  // WHY: Models commonly wrap structured output in fenced blocks even when instructed not to.
  const stripped_fence_text = raw_llm_output_text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  // WHAT: Attempting a direct parse first.
  // WHY: If the model obeyed instructions and returned bare JSON, this is the fastest path.
  try {
    return JSON.parse(stripped_fence_text);
  } catch {
    // Not clean JSON yet — proceed to extraction.
  }

  // WHAT: Finding the first JSON object or array block inside the text.
  // WHY: The model may have written prose before or after the JSON block.
  //      We scan for the first { or [ and attempt to parse from there.
  const first_object_brace_index = stripped_fence_text.indexOf("{");
  const first_array_bracket_index = stripped_fence_text.indexOf("[");

  let extraction_start_index = -1;
  if (first_object_brace_index !== -1 && first_array_bracket_index !== -1) {
    extraction_start_index = Math.min(first_object_brace_index, first_array_bracket_index);
  } else if (first_object_brace_index !== -1) {
    extraction_start_index = first_object_brace_index;
  } else if (first_array_bracket_index !== -1) {
    extraction_start_index = first_array_bracket_index;
  }

  if (extraction_start_index === -1) {
    throw new Error("No JSON object or array found in LLM response text.");
  }

  const json_candidate_substring = stripped_fence_text.slice(extraction_start_index);
  
  // WHAT: Sanitize invalid JSON escapes generated by the LLM (e.g. \a, \c, \s)
  // WHY: Language models occasionally generate unescaped backslashes before characters.
  //      If the character isn't a valid JSON escape (like \n or \"), JSON.parse throws a Bad escaped character SyntaxError.
  const sanitized_json_string = json_candidate_substring.replace(/\\([^"\\/bfnrtu])/g, '\\\\$1');

  // WHAT: Attempting to parse the candidate string, logging it if it fails.
  // WHY: We need to see exactly what is malformed (e.g., unterminated strings) to debug token truncation issues.
  try {
    return JSON.parse(sanitized_json_string);
  } catch (parsing_error) {
    console.error("JSON parsing failed. Raw candidate substring:", json_candidate_substring);
    console.error("Original error:", parsing_error);
    
    // WHAT: Optional: save to a local error file for easier inspection.
    // WHY: The console might truncate long strings (92k characters).
    try {
      const error_log_path = require("path").join(app.getPath("userData"), "json_parse_error_log.txt");
      require("fs").writeFileSync(error_log_path, json_candidate_substring, "utf-8");
      console.error("Saved failing JSON candidate to:", error_log_path);
    } catch (log_error) {
      console.error("Could not save failing JSON to file:", log_error);
    }
    
    throw parsing_error;
  }
}

function dispatch_http_post_request(target_endpoint_url_string, request_payload_object) {
  // WHAT: Returning a promise that wraps the standard node.js HTTP client requests.
  // WHY: Allows using modern async/await patterns inside our IPC handlers.
  return new Promise((resolve_callback_function, reject_callback_function) => {
    try {
      // WHAT: Normalizing the URL before handing it to the Node.js HTTP client.
      // WHY: Defense-in-depth: even if the renderer sends a cached "localhost" URL this ensures
      //      we always connect via the IPv4 loopback so LM Studio responds correctly.
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

        // WHAT: Accumulating incoming stream data buffers.
        // WHY: Node processes large payloads asynchronously in streams.
        native_http_response.on("data", (data_chunk) => {
          concatenated_response_data_chunks += data_chunk;
        });

        // WHAT: Executing callback when stream reading is finished.
        // WHY: Resolves the promise with the fully parsed JSON payload.
        native_http_response.on("end", () => {
          try {
            const parsed_response_json = JSON.parse(concatenated_response_data_chunks);

            // WHAT: Extracting warnings from LM Studio if they exist.
            // WHY: If context limits are exceeded or models fail back, LM Studio might warn the user.
            //      We want to surface these warnings to the UI so the user isn't guessing why it's slow.
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
            if (warning_messages_list.length > 0 && primary_application_window) {
              primary_application_window.webContents.send("system:lm-studio-warning", warning_messages_list.join(" | "));
            }

            resolve_callback_function(parsed_response_json);
          } catch (json_parsing_exception) {
            reject_callback_function(new Error("Failed to parse response JSON: " + json_parsing_exception.message));
          }
        });
      });

      // WHAT: Handling connection failures or network drops.
      // WHY: Prevents stalling if LM Studio is offline or listening on a different port.
      native_http_request.on("error", (connection_network_error) => {
        reject_callback_function(connection_network_error);
      });

      // WHAT: Handling timeouts.
      // WHY: Prevents infinite hanging if the LLM gets stuck.
      native_http_request.on("timeout", () => {
        native_http_request.destroy();
        reject_callback_function(new Error("LM Studio API request timed out after 600 seconds."));
      });

      // WHAT: Flushing the request content payload.
      // WHY: Writes buffer data down the TCP pipe.
      native_http_request.write(stringified_payload);
      native_http_request.end();
    } catch (general_request_execution_exception) {
      reject_callback_function(general_request_execution_exception);
    }
  });
}

// WHAT: Dynamic model tag resolver querying the LM Studio models registry.
// WHY: Auto-resolves loaded models to prevent JSON requests from failing due to hardcoded tags.
function retrieve_currently_loaded_model_tag(lm_studio_base_endpoint_url) {
  return new Promise((resolve_callback_function) => {
    try {
      // WHAT: Normalizing the received URL to avoid IPv6 resolution failures.
      // WHY: Same IPv4 fix as in dispatch_http_post_request. The model-list endpoint
      //      is also an HTTP GET, so it must also avoid the ::1 IPv6 trap.
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
              resolve_callback_function("google/gemma-4-12b");
            }
          } catch {
            resolve_callback_function("google/gemma-4-12b");
          }
        });
      }).on("error", () => {
        resolve_callback_function("google/gemma-4-12b");
      });
    } catch {
      resolve_callback_function("google/gemma-4-12b");
    }
  });
}


// WHAT: Saves raw LLM responses to a dedicated debug log folder within the active project workspace.
// WHY: In complex LLM pipelines, parsing issues or unexpected model outputs can occur.
//      By saving the raw completion text to a physical file, developers can easily audit and cross-reference
//      the exact text returned by the local LLM model prior to any JSON extraction or post-processing operations.
// STYLE: Here is a quick tutorial on this function:
//        We receive the active workspace directory, the project name, a log type identifier (like "cast_discovery"),
//        and the raw response string. We safely join these into an absolute directory path inside the project,
//        proactively create the "debug_logs" folder if it is missing, and then write the raw completion text
//        to disk as a UTF-8 text file.
function save_raw_llm_debug_log(workspace_directory_path, project_name_string, log_type_identifier_string, raw_response_content_string) {
  // WHAT: Guard against missing path values.
  // WHY: If no workspace directory is loaded or provided, we skip file operations to prevent runtime crashes.
  if (!workspace_directory_path || !project_name_string) {
    return;
  }

  try {
    // WHAT: Constructing absolute paths for the debug logs directory.
    // WHY: Absolute path joining ensures clean cross-platform directory referencing.
    const project_absolute_directory_path = path_library.join(workspace_directory_path, project_name_string);
    const debug_logs_absolute_directory_path = path_library.join(project_absolute_directory_path, "debug_logs");

    // WHAT: Proactively creating the debug directory if it doesn't exist yet.
    // WHY: Native node.js filesystem library throws write errors if parent directory trees are missing.
    if (!filesystem_library.existsSync(debug_logs_absolute_directory_path)) {
      filesystem_library.mkdirSync(debug_logs_absolute_directory_path, { recursive: true });
    }

    // WHAT: Defining absolute target file path.
    // WHY: Creates unique filenames corresponding to the active log category type.
    const target_log_file_absolute_path = path_library.join(debug_logs_absolute_directory_path, `${log_type_identifier_string}_raw.txt`);

    // WHAT: Writing raw string data cleanly to disk.
    // WHY: Overwrites previous runs with standard UTF-8 encoding.
    filesystem_library.writeFileSync(target_log_file_absolute_path, raw_response_content_string, "utf8");
  } catch (log_creation_failure_exception) {
    // WHAT: Logging error to main process standard console.
    // WHY: Keeps logging robust without throwing silent crashes in the user application shell.
    console.error("Failed to archive raw LLM response to debug directory:", log_creation_failure_exception);
  }
}

// WHAT: Handler to perform Pass 1: Global Cast Discovery.
// WHY: We call the local LLM to read a segment and extract character profiles.
ipcMain.handle("ai:extract-cast", async (ipc_event_context, request_arguments) => {
  const { book_text_segment, lm_studio_api_url_address, workspace_directory_path, project_name } = request_arguments;

  // WHAT: Preparing system prompts to enforce strict JSON structure.
  // WHY: Instructs LM Studio to respond only with structural profiles, preventing text preambles.
  //      We expand this prompt to extract relationships, visual details (costumes), and key scene objects.
  const system_instructional_prompt = filesystem_library.readFileSync(path_library.join(__dirname, "prompts", "cast_discovery.txt"), "utf8");

  const user_input_content = `Extract characters from this book segment:\n\n${book_text_segment}`;

  // WHAT: Querying LM Studio dynamically to identify the active model tag.
  // WHY: Ensures we target the active model chromadb-context-1 without failing.
  const active_loaded_model_id_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url_address);

  try {
    const api_response_payload = await dispatch_http_post_request(lm_studio_api_url_address, {
      model: active_loaded_model_id_tag,
      messages: [
        { role: "system", content: system_instructional_prompt },
        { role: "user", content: user_input_content }
      ],
      temperature: 0.2,
      max_tokens: 16000
    });

    // WHAT: Validating that the LLM response contains a valid choices block array.
    // WHY: Prevents a TypeError crash if the server returned an error payload instead of a standard completion list.
    if (!api_response_payload.choices || api_response_payload.choices.length === 0) {
      if (api_response_payload.error) {
        // WHAT: Safely extracting the error message regardless of its shape.
        // WHY: LM Studio may return error as a plain string, or as an object with a .message field,
        //      or as a nested object. We use typeof to safely coerce it to a string before throwing.
        const lm_error_description = (typeof api_response_payload.error === "string")
          ? api_response_payload.error
          : (api_response_payload.error.message || JSON.stringify(api_response_payload.error));
        throw new Error(`LM Studio API Error: ${lm_error_description}`);
      }
      throw new Error(`Invalid response structure from LM Studio: ${JSON.stringify(api_response_payload)}`);
    }

    // WHAT: Safely extracting the first choice message block returned by the LLM response choices.
    // WHY: Reading choice messages cleanly lets us inspect both content fields and refusal records.
    const active_choices_message_object = api_response_payload.choices[0].message;

    // WHAT: Verifying if the model refused the incoming parsing request.
    // WHY: Accessing message content without inspecting refusal fields can crash runtime streams if the model blocked the prompt.
    if (active_choices_message_object.refusal) {
      throw new Error(`LM Studio request was refused: ${active_choices_message_object.refusal}`);
    }

    const completion_content_text = active_choices_message_object.content.trim();

    // WHAT: Archiving the raw LLM response string to our local debug folder.
    // WHY: Enables manual auditing of exact JSON generations returned by LM Studio.
    save_raw_llm_debug_log(workspace_directory_path, project_name, "cast_discovery", completion_content_text);

    // WHAT: Routing content through the robust JSON extractor instead of bare JSON.parse.
    // WHY: Without json_object mode, chromadb-context-1 may wrap output in markdown fences or
    //      add preamble text. The extractor handles all of these cases cleanly.
    return extract_json_from_llm_response_text(completion_content_text);
  } catch (api_failure_exception) {
    // WHAT: Returning a fallback payload if LM Studio is offline or throws parsing errors.
    // WHY: Enables continuous operation and lets the application degrade gracefully.
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
// WHY: Splits book text into structured screenplay parts (Narrator vs Character speaker).
ipcMain.handle("ai:attribute-dialogue", async (ipc_event_context, request_arguments) => {
  // WHAT: Normalize typography to help the LLM match the straight-quote examples in the prompt.
  // WHY: Smart quotes (“ ”) confuse LLMs trained on standard JSON/markdown examples.
  const raw_text = request_arguments.book_text_segment || "";
  const book_text_segment = raw_text.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");

  const lm_studio_api_url_address = request_arguments.lm_studio_api_url_address;

  const system_instructional_prompt = filesystem_library.readFileSync(path_library.join(__dirname, "prompts", "script_formatting.txt"), "utf8");

  // WHAT: Querying LM Studio dynamically to identify the active model tag.
  // WHY: Guarantees request is sent to the active model chromadb-context-1 without failing.
  const active_loaded_model_id_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url_address);

  try {
    const api_response_payload = await dispatch_http_post_request(lm_studio_api_url_address, {
      model: active_loaded_model_id_tag,
      messages: [
        { role: "system", content: system_instructional_prompt },
        { role: "user", content: book_text_segment }
      ],
      temperature: 0.2,
      max_tokens: 16000
    });

    // WHAT: Validating that the LLM response contains a valid choices block array.
    // WHY: Prevents a TypeError crash if the server returned an error payload instead of a standard completion list.
    if (!api_response_payload.choices || api_response_payload.choices.length === 0) {
      if (api_response_payload.error) {
        // WHAT: Safely extracting the error message regardless of its shape.
        // WHY: LM Studio may return error as a plain string, or as an object with a .message field,
        //      or as a nested object. We use typeof to safely coerce it to a string before throwing.
        const lm_error_description = (typeof api_response_payload.error === "string")
          ? api_response_payload.error
          : (api_response_payload.error.message || JSON.stringify(api_response_payload.error));
        throw new Error(`LM Studio API Error: ${lm_error_description}`);
      }
      throw new Error(`Invalid response structure from LM Studio: ${JSON.stringify(api_response_payload)}`);
    }

    // WHAT: Safely extracting the message block from the LLM choices.
    // WHY: Inspecting choices allows us to run standard safety and refusal validation checks.
    const active_choices_message_object = api_response_payload.choices[0].message;

    // WHAT: Verifying if the local LLM model refused the dialogue attribution request.
    // WHY: Ensures the application fails gracefully using local fallbacks instead of crashing.
    if (active_choices_message_object.refusal) {
      throw new Error(`LM Studio request was refused: ${active_choices_message_object.refusal}`);
    }

    const completion_content_text = active_choices_message_object.content.trim();
    // WHAT: Routing content through the robust JSON extractor instead of bare JSON.parse.
    // WHY: Without json_object mode, chromadb-context-1 may wrap output in markdown fences or
    //      add preamble text. The extractor handles all of these cases cleanly.
    const parsed_json = extract_json_from_llm_response_text(completion_content_text);
    const extracted_script_blocks = Array.isArray(parsed_json) ? parsed_json : (parsed_json.script_segments || []);
    return { script_segments: extracted_script_blocks };
  } catch (api_failure_exception) {
    console.error("Dialogue attribution failed, executing rule-based local parser.", api_failure_exception);
    
    // WHAT: Rule-based paragraph attribution fallback.
    // WHY: If the LLM is down, we must still split quotes and narration logically.
    const fallback_script_segments = [];
    const paragraphs_list = book_text_segment.split(/\n+/);

    for (let paragraph_index = 0; paragraph_index < paragraphs_list.length; paragraph_index++) {
      const paragraph_string = paragraphs_list[paragraph_index].trim();
      if (!paragraph_string) {
        continue;
      }

      // WHAT: Regex matching segments inside quotes vs outside quotes.
      // WHY: Isolates spoken dialogue blocks from surrounding narration blocks.
      const quotation_regex_pattern = /"([^"]+)"/g;
      let matched_substring_reference = null;
      let last_processed_index_position = 0;

      while ((matched_substring_reference = quotation_regex_pattern.exec(paragraph_string)) !== null) {
        // WHAT: Capturing text before the quote as narrator text.
        // WHY: Any surrounding text outside quotes belongs to standard narrative.
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

        // WHAT: Adding the quote itself as dialogue.
        // WHY: The inside content of the quotes represents spoken text.
        fallback_script_segments.push({
          type: "dialogue",
          speaker: "Character",
          text: matched_substring_reference[1],
          direction: "expressive delivery"
        });

        last_processed_index_position = quotation_regex_pattern.lastIndex;
      }

      // WHAT: Appending trailing narrator text after quotes.
      // WHY: Ensures any narration ending a paragraph is recorded.
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

// WHAT: Handler to split a single mixed dialogue/narrator cell using LM Studio.
// WHY: The regex-based split only handles simple patterns. LM Studio can handle any mix:
//      narrator-first, multiple quotes, embedded attribution tags, mid-sentence dialogue, etc.
ipcMain.handle("ai:split-segment", async (ipc_event_context, request_arguments) => {
  const { cell_text, lm_studio_api_url_address } = request_arguments;

  // WHAT: Normalizing smart quotes to prevent tokenization mismatches.
  // WHY: Book text uses curly quotes which the LLM may not recognize as JSON string delimiters.
  const normalized_cell_text = (cell_text || "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  // WHAT: Building a tight, focused system prompt just for single-cell splitting.
  // WHY: A narrow prompt with only one job produces faster, more reliable results than the full script_formatting.txt prompt
  //      which includes narrator grouping rules that would conflict with splitting instructions.
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
      temperature: 0.1,
      max_tokens: 1024
    });

    if (!api_response_payload.choices || api_response_payload.choices.length === 0) {
      throw new Error("LM Studio returned no choices for segment split.");
    }

    const raw_split_response_text = api_response_payload.choices[0].message.content.trim();
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

// WHAT: Formats relationships structured data to a clean, comma-separated string.
// WHY: We want to ensure that if the relationships are stored as an array of target/dynamic objects
//      (e.g., from the cast discovery LLM schema), we format them beautifully for the user textarea
//      and prevent raw "[object Object]" displaying in the DOM.
function format_relationships_to_readable_string(relationships_input_field) {
  // WHAT: If it is already a plain string, return it immediately.
  // WHY: Simplifies parsing for manual inputs or already processed records.
  if (typeof relationships_input_field === "string") {
    return relationships_input_field;
  }
  // WHAT: If it is null or undefined, return an empty string.
  // WHY: Avoids syntax errors or displaying "undefined" values.
  if (!relationships_input_field) {
    return "";
  }
  // WHAT: If it is a structured array, iterate and compile each relationship description.
  // WHY: Translates raw object arrays like [{"target_id": "kin", "dynamic": "spouse"}] into readable prose.
  if (Array.isArray(relationships_input_field)) {
    const formatted_relationship_parts = [];
    for (let item_index = 0; item_index < relationships_input_field.length; item_index++) {
      const relationship_item = relationships_input_field[item_index];
      if (relationship_item && typeof relationship_item === "object") {
        const target_id_string = relationship_item.target_id || "";
        const relationship_dynamic_string = relationship_item.dynamic || relationship_item.relation || "";
        if (target_id_string && relationship_dynamic_string) {
          formatted_relationship_parts.push(`${relationship_dynamic_string} with ${target_id_string}`);
        } else if (target_id_string) {
          formatted_relationship_parts.push(`connected to ${target_id_string}`);
        } else if (relationship_dynamic_string) {
          formatted_relationship_parts.push(relationship_dynamic_string);
        }
      } else if (typeof relationship_item === "string") {
        formatted_relationship_parts.push(relationship_item);
      }
    }
    return formatted_relationship_parts.join(", ");
  }
  // WHAT: If it is a single object instead of an array, format its parameters.
  // WHY: Adapts to model variations that output single relationship instances.
  if (typeof relationships_input_field === "object") {
    const target_id_string = relationships_input_field.target_id || "";
    const relationship_dynamic_string = relationships_input_field.dynamic || relationships_input_field.relation || "";
    if (target_id_string && relationship_dynamic_string) {
      return `${relationship_dynamic_string} with ${target_id_string}`;
    } else if (target_id_string) {
      return `connected to ${target_id_string}`;
    } else if (relationship_dynamic_string) {
      return relationship_dynamic_string;
    }
  }
  return String(relationships_input_field);
}

// WHAT: Formats general metadata fields (traits, visual details, key objects) to a clean string.
// WHY: Ensures that if an LLM outputs lists or arrays instead of flat strings, the UI parses and
//      renders them elegantly without displaying "[object Object]" or raw arrays.
function format_general_metadata_field_to_string(metadata_field_value) {
  // WHAT: If it is already a plain string, return it immediately.
  // WHY: Reduces processing overhead for standard text structures.
  if (typeof metadata_field_value === "string") {
    return metadata_field_value;
  }
  // WHAT: If it is null or undefined, return an empty string.
  // WHY: Prevents displaying placeholder garbage text.
  if (!metadata_field_value) {
    return "";
  }
  // WHAT: If it is an array, join elements gracefully.
  // WHY: Combines list elements (like ["key", "props"]) into a single, clean text string.
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
  // WHAT: If it is an object, format using standard JSON serialization.
  // WHY: Safely displays the content instead of failing with [object Object].
  if (typeof metadata_field_value === "object") {
    return JSON.stringify(metadata_field_value);
  }
  return String(metadata_field_value);
}

// WHAT: Formats the discovered global cast mapping database into a structured system instructions block.
// WHY: Providing the LLM with direct, predefined character metadata (voice profile, identity, appearance,
//      personality traits) drastically improves its pronoun resolution, dialog attribution accuracy,
//      and performance coaching context. The output mirrors the Qwen3-TTS DesignVoice character card format.
// STYLE: Here is a friendly tutorial on this context compiler:
//        We take the voice mapping dictionary stored in our project state. We loop through all the character keys.
//        For each character, we format their name, voice profile, identity & background, physical appearance,
//        and personality traits into the structured Qwen3 character card layout. We return this cast guide
//        block so it can be prepended directly into the Director AI's instructions!
function compile_global_cast_system_context(voice_mapping_context) {
  // WHAT: Check if cast profile context is empty or undefined.
  // WHY: Returns a basic warning prompt if the user hasn't run the initial Scan Characters pass yet.
  if (!voice_mapping_context || Object.keys(voice_mapping_context).length === 0) {
    return "No predefined cast profiles exist for this project yet. Please parse general speaker identities dynamically.";
  }

  let compiled_cast_guide_string = "PREDEFINED CAST PROFILES FOR THIS STORY:\n\n";
  const character_keys_list = Object.keys(voice_mapping_context);

  for (let character_counter = 0; character_counter < character_keys_list.length; character_counter++) {
    const character_name_string = character_keys_list[character_counter];
    const character_profile_details = voice_mapping_context[character_name_string];

    // WHAT: Resolving voice profile from new fields with backward-compatible fallback to old fields.
    // WHY: Projects created before the Qwen3 DesignVoice schema upgrade store voice info under
    //      "baseVoice" or "designPrompt". We read the new "voiceProfile" first, then fall back.
    const resolved_voice_profile_string = format_general_metadata_field_to_string(
      character_profile_details.voiceProfile || character_profile_details.baseVoice || character_profile_details.designPrompt || "Normal, standard voice."
    );

    // WHAT: Resolving identity & background from new field with fallback to old relationship notes.
    // WHY: Pre-upgrade projects stored role context under "relationships"; now it lives in "identityBackground".
    const resolved_identity_background_string = format_general_metadata_field_to_string(
      character_profile_details.identityBackground || ""
    );

    // WHAT: Resolving physical appearance from new field with fallback to old visual details.
    // WHY: Pre-upgrade projects stored appearance under "visualDetails"; now it lives in "physicalAppearance".
    const resolved_physical_appearance_string = format_general_metadata_field_to_string(
      character_profile_details.physicalAppearance || character_profile_details.visualDetails || ""
    );

    // WHAT: Resolving personality traits from new field with fallback to old traits string.
    // WHY: Pre-upgrade projects stored personality under "traits"; now it lives in "personalityTraits".
    const resolved_personality_traits_string = format_general_metadata_field_to_string(
      character_profile_details.personalityTraits || character_profile_details.traits || ""
    );

    // WHAT: Constructing the Qwen3-style multi-section character card for the Director AI.
    // WHY: Provides deep contextual pointers using the same structural layout that the
    //      Qwen3-TTS DesignVoice engine uses, ensuring consistency between cast analysis and synthesis.
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

// WHAT: Escapes special regular expression characters in a string.
// WHY: Node.js main process does not have a global window object, so we must define
//      a local backend utility to sanitize string inputs for spacing-insensitive regex searching.
// STYLE: Here is a friendly tutorial on how this function works:
//        We receive a segment text that we want to search for in our book text.
//        If the segment text contains punctuation characters (like '.', '*', or '+'), the regex engine
//        would treat them as wildcards. Prepending a backslash to each of them turns them into literal matches.
function escape_regex_characters_for_literal_match(source_string_to_escape) {
  // WHAT: Replacing special characters with escaped backslash alternatives.
  // WHY: Sanitize all punctuation to prevent errors when creating RegExp objects.
  return source_string_to_escape.replace(/[\-\/\\\^\$\*\+\?\.\(\)\|\[\]\{\}]/g, "\\$&");
}


// WHAT: Slices a large block of text into multiple sliding, overlapping windows based on whole sentences.
// WHY: Local LLMs perform much more accurately when context windows are limited. Slicing prevents
//      out-of-memory errors and truncation. Using whole sentences as the division boundary instead of raw
//      words ensures that dialogues and narrator segments are never chopped in half, maintaining structural story coherence.
// STYLE: Here is a friendly tutorial on how this sentence-based chunking algorithm works:
//        1. We split the entire text into whole sentences using a regular expression that captures punctuation markers (. ! ?).
//        2. We compile word counts for each sentence to track sizes dynamically.
//        3. We loop through the sentences, greedily adding them to a chunk until we are close to 'max_chunk_words'.
//        4. For subsequent chunks, we backtrack to find a starting sentence that shares at least 'overlap_words' with the previous chunk,
//           creating a smooth narrative bridge so the AI retains immediate context of the preceding scene.
function divide_text_into_sliding_overlapping_windows(text_content, max_chunk_words = 1500, overlap_words = 150) {
  // WHAT: Segmenting the text content into whole sentences.
  // WHY: Sentence boundaries are high-quality punctuation anchors. Splitting exactly at sentence ends
  //      prevents breaking character dialogues or narrator clauses mid-word or mid-thought.
  const sentence_pattern_regex = /[^.!?]+[.!?]+(?:\s+|$)/g;
  let sentence_matches_list = text_content.match(sentence_pattern_regex);

  // Fallback if no matching standard punctuation sentences are found (e.g. raw unstructured lists)
  if (!sentence_matches_list || sentence_matches_list.length === 0) {
    sentence_matches_list = text_content.split(/\n+/).filter(line_item => line_item.trim().length > 0);
  }
  if (sentence_matches_list.length === 0) {
    sentence_matches_list = [text_content];
  }

  // WHAT: Compile sentence metadata including word counts.
  // WHY: Allows us to advance indices based on exact word targets while maintaining whole sentences.
  const sentences_metadata_list = [];
  for (let index_counter = 0; index_counter < sentence_matches_list.length; index_counter++) {
    const raw_sentence_string = sentence_matches_list[index_counter];
    const sentence_words_count = raw_sentence_string.trim().split(/\s+/).filter(word => word.length > 0).length;
    sentences_metadata_list.push({
      text: raw_sentence_string,
      word_count: sentence_words_count
    });
  }

  // WHAT: Bypasses chunking overhead if the entire text fits comfortably inside standard boundaries.
  // WHY: Simplifies flow and guarantees minimal overhead on short segments.
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

    // WHAT: Greedily accumulate sentences until we reach max_chunk_words.
    // WHY: We guarantee that each chunk contains only whole sentences and stays close to the VRAM/context budget.
    while (end_sentence_index < sentences_metadata_list.length) {
      const next_sentence_word_count = sentences_metadata_list[end_sentence_index].word_count;
      
      // If adding this sentence exceeds max_chunk_words, and we already have at least one sentence, we stop.
      if (current_chunk_words_sum + next_sentence_word_count > max_chunk_words && end_sentence_index > start_sentence_index) {
        break;
      }
      
      current_chunk_words_sum += next_sentence_word_count;
      end_sentence_index++;
    }

    // WHAT: Join the sentences to form the text chunk.
    // WHY: Recombines the segmented sentences back into a continuous passage.
    const chunk_sentences_slice = sentences_metadata_list.slice(start_sentence_index, end_sentence_index);
    const chunk_text_content = chunk_sentences_slice.map(item => item.text).join("");
    chunks_list.push(chunk_text_content);

    // WHAT: Break the loop if we've reached the end of the sentences.
    // WHY: Prevents infinite looping and marks completion of the windowing process.
    if (end_sentence_index >= sentences_metadata_list.length) {
      break;
    }

    // WHAT: Backtrack start index for the next window to create the overlap.
    // WHY: We count backwards from end_sentence_index until we accumulate at least overlap_words.
    //      This preserves chronological narrative context between adjacent rolling cuts.
    let overlap_words_sum = 0;
    let overlap_start_index = end_sentence_index - 1;

    while (overlap_start_index > start_sentence_index && overlap_words_sum < overlap_words) {
      overlap_words_sum += sentences_metadata_list[overlap_start_index].word_count;
      overlap_start_index--;
    }

    // Ensure we actually progress forward even if overlap calculation is large.
    // We must ensure next start index is strictly greater than the current start index.
    const next_start_candidate = overlap_start_index + 1;
    if (next_start_candidate <= start_sentence_index) {
      start_sentence_index = start_sentence_index + 1;
    } else {
      start_sentence_index = next_start_candidate;
    }
  }

  return chunks_list;
}

// WHAT: Generates a rule-based fallback directorial script array using raw regex splits.
// WHY: If the local LLM call fails, we still want the application to operate gracefully by rendering 
//      basic neutral segments in Column 3 instead of crashing.
// STYLE: Here is a quick tutorial on this fallback:
//        We receive the text segment content, split it by newlines, and scan each paragraph for quotes.
//        Text inside quotes is marked as 'dialogue' for character speakers, and text outside quotes
//        is marked as standard 'narrator' prose. All items get a default neutral 8D emotion vector.
function generate_rule_based_directorial_fallback(text_segment_content) {
  const rule_based_fallback_segments = [];
  const split_paragraph_lines_list = text_segment_content.split(/\n+/);

  for (let line_index_counter = 0; line_index_counter < split_paragraph_lines_list.length; line_index_counter++) {
    const paragraph_string_line = split_paragraph_lines_list[line_index_counter].trim();
    if (!paragraph_string_line) {
      continue;
    }

    const matching_quotes_regex_pattern = /"([^"]+)"/g;
    let matched_regex_substring = null;
    let last_scanned_index_pointer = 0;

    while ((matched_regex_substring = matching_quotes_regex_pattern.exec(paragraph_string_line)) !== null) {
      // WHAT: Capture text before the wquote as narration.
      // WHY: Standard storytelling text surrounding quotes belongs to the narrator.
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

      // WHAT: Capture quote itself as dialogue.
      // WHY: Text within quotes represents the spoken line.
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

    // WHAT: Capture post-quote text as narration.
    // WHY: Resolves any remaining narrator lines trailing the quote.
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

// WHAT: Registering the Directorial Script Doctor Pass (Pass 2 & 3 Triple-Input Enrichment).
// WHY: We call the local LLM using a rich directorial system prompt to extract speaker dialogues, 
//      psychological subtext intents, technical voice deliveries, and 8D emotion vectors simultaneously.
ipcMain.handle("ai:generate-directorial-script", async (ipc_event_context, request_arguments) => {
  const { book_text_segment, lm_studio_api_url_address, workspace_directory_path, project_name, voice_mapping_context, forced_speaker_id, sliding_window_context } = request_arguments;

  // WHAT: Compiling active Cast Profiles guide to inject context.
  // WHY: Letting the Director AI know predefined characters (relationships, looks, traits) beforehand
  //      dramatically increases pronoun resolution and emotional intent quality.
  const compiled_cast_guide_context = compile_global_cast_system_context(voice_mapping_context);

  // WHAT: System prompt instructing the LLM to act as a Director and parse text segments.
  // WHY: We want structured screenplay data enriched with intent analysis, delivery notes, and emotion weights.
  const directorial_system_prompt_instructions = filesystem_library.readFileSync(path_library.join(__dirname, "prompts", "directorial_orchestration.txt"), "utf8")
    .replace("{{CAST_GUIDE_CONTEXT}}", compiled_cast_guide_context);

  const active_loaded_model_id_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url_address);

  // WHAT: Slicing the full text segment into overlapping rolling windows.
  // WHY: Slicing protects context sizes, while keeping the overlap ensures the local LLM
  //      has transition histories between paragraphs.
  const text_windows_list = divide_text_into_sliding_overlapping_windows(book_text_segment, 1500, 150);
  const aggregated_script_segments_list = [];

  // Track absolute coordinates in the full text to safely filter out duplicates at overlap margins
  let raw_search_index_pointer = 0;

  try {
    for (let window_counter = 0; window_counter < text_windows_list.length; window_counter++) {
      const window_text_chunk = text_windows_list[window_counter];
      let user_input_content = `Extract and enrich the directorial script from this book segment:\n\n${window_text_chunk}`;

      // WHAT: Applying user-forced speaker context for single-line regeneration.
      // WHY: When a user changes the speaker in the UI, we must force the LLM to respect that choice 
      //      and tailor the generated style/performance to that specific character.
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
        temperature: 0.2
      });

      if (!directorial_api_response_payload.choices || directorial_api_response_payload.choices.length === 0) {
        throw new Error("Invalid response from LM Studio during rolling cut pass.");
      }

      const first_returned_choices_message = directorial_api_response_payload.choices[0].message;
      const completion_content_text = first_returned_choices_message.content.trim();

      // WHAT: Archiving the raw JSON response chunk for debug auditing.
      // WHY: Keeps trace logs perfect for each rolling cuts window.
      save_raw_llm_debug_log(workspace_directory_path, project_name, `directorial_script_chunk_${window_counter + 1}`, completion_content_text);

      const parsed_chunk_json = extract_json_from_llm_response_text(completion_content_text);

      if (parsed_chunk_json && parsed_chunk_json.script_segments) {
        for (let segment_counter = 0; segment_counter < parsed_chunk_json.script_segments.length; segment_counter++) {
          const segment_item = parsed_chunk_json.script_segments[segment_counter];
          
          // WHAT: Parsing Emotional State Updates.
          // WHY: Decouples physical base voice from dynamic psychological state, updating the ledger.
          if (segment_item.type === "state_update") {
            if (segment_item.speaker_id && segment_item.new_current_emotion) {
              if (!voice_mapping_context[segment_item.speaker_id]) {
                voice_mapping_context[segment_item.speaker_id] = {};
              }
              voice_mapping_context[segment_item.speaker_id].currentEmotion = segment_item.new_current_emotion;
            }
            continue; // Skip adding state_update to visual timeline
          }

          // WHAT: Stamping segment with the active emotion ledger snapshot.
          // WHY: Ensures each segment has perfect recall of its emotional context for regeneration later.
          if (segment_item.speaker_id && voice_mapping_context[segment_item.speaker_id] && voice_mapping_context[segment_item.speaker_id].currentEmotion) {
            segment_item.active_emotion_state = voice_mapping_context[segment_item.speaker_id].currentEmotion;
          } else {
            segment_item.active_emotion_state = "neutral and observant.";
          }

          const segment_text = segment_item.text ? segment_item.text.trim() : "";

          if (!segment_text) {
            continue;
          }

          // WHAT: Spacing-insensitive duplicate check inside the raw book text.
          // WHY: Ensures segments from the overlap boundary are not added twice.
          const escaped_segment_text = escape_regex_characters_for_literal_match(segment_text);
          const whitespace_resilient_pattern = escaped_segment_text.replace(/\s+/g, "\\s+");
          const search_regex = new RegExp(whitespace_resilient_pattern);
          const search_haystack = book_text_segment.substring(raw_search_index_pointer);

          const matched_result = search_regex.exec(search_haystack);

          if (matched_result) {
            const absolute_start_index = raw_search_index_pointer + matched_result.index;
            const absolute_end_index = absolute_start_index + matched_result[0].length;

            // WHAT: Deduplication filter using absolute coordinates.
            // WHY: If this coordinate range has already been covered or starts before our current
            //      index pointer, it represents an overlapping duplicate from the previous chunk.
            if (absolute_start_index >= raw_search_index_pointer) {
              aggregated_script_segments_list.push(segment_item);
              raw_search_index_pointer = absolute_end_index;
            }
          } else {
            // Fallback global check starting from 0 to preserve out-of-order edits if regex was strict
            const fallback_match = search_regex.exec(book_text_segment);
            if (fallback_match) {
              const fallback_start = fallback_match.index;
              if (fallback_start >= raw_search_index_pointer) {
                aggregated_script_segments_list.push(segment_item);
                raw_search_index_pointer = fallback_start + fallback_match[0].length;
              }
            } else {
              // Add anyway as safeguard if LLM minorly rephrased
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

// WHAT: Handler to perform Pass 3: Contextual Stage Staging Directions.
// WHY: Analyzes context to extract emotional tags for a single specific targeted script line.
ipcMain.handle("ai:generate-emotional-staging", async (ipc_event_context, request_arguments) => {
  const { preceding_context_lines, target_sentence_text, succeeding_context_lines, lm_studio_api_url_address } = request_arguments;

  const system_instructional_prompt = filesystem_library.readFileSync(path_library.join(__dirname, "prompts", "emotional_staging.txt"), "utf8");

  const user_input_content = `Preceding context: ${preceding_context_lines.join(" | ")}
Target line: "${target_sentence_text}"
Succeeding context: ${succeeding_context_lines.join(" | ")}`;

  // WHAT: Querying LM Studio dynamically to identify the active model tag.
  // WHY: Feeds acting instructions directly to whatever model is active in GUI.
  const active_loaded_model_id_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url_address);

  try {
    const api_response_payload = await dispatch_http_post_request(lm_studio_api_url_address, {
      model: active_loaded_model_id_tag,
      messages: [
        { role: "system", content: system_instructional_prompt },
        { role: "user", content: user_input_content }
      ],
      temperature: 0.3
    });

    // WHAT: Validating that the LLM response contains a valid choices block array.
    // WHY: Prevents a TypeError crash if the server returned an error payload instead of a standard completion list.
    if (!api_response_payload.choices || api_response_payload.choices.length === 0) {
      if (api_response_payload.error) {
        // WHAT: Safely extracting the error message regardless of its shape.
        // WHY: LM Studio may return error as a plain string, or as an object with a .message field,
        //      or as a nested object. We use typeof to safely coerce it to a string before throwing.
        const lm_error_description = (typeof api_response_payload.error === "string")
          ? api_response_payload.error
          : (api_response_payload.error.message || JSON.stringify(api_response_payload.error));
        throw new Error(`LM Studio API Error: ${lm_error_description}`);
      }
      throw new Error(`Invalid response structure from LM Studio: ${JSON.stringify(api_response_payload)}`);
    }

    // WHAT: Safely extracting the message block from the LLM choices list.
    // WHY: Inspecting choices allows us to validate if a refusal event occurred.
    const active_choices_message_object = api_response_payload.choices[0].message;

    // WHAT: Verifying if the LLM coach refused to staged emotional directions.
    // WHY: Prevents reading null content fields, gracefully falling back to natural narration.
    if (active_choices_message_object.refusal) {
      throw new Error(`LM Studio request was refused: ${active_choices_message_object.refusal}`);
    }

    const completion_content_text = active_choices_message_object.content.trim();
    // WHAT: Routing content through the robust JSON extractor instead of bare JSON.parse.
    // WHY: Without json_object mode, chromadb-context-1 may wrap output in markdown fences or
    //      add preamble text. The extractor handles all of these cases cleanly.
    return extract_json_from_llm_response_text(completion_content_text);
  } catch (api_failure_exception) {
    console.error("Contextual staging failed, using neutral fallback.", api_failure_exception);
    return { direction: "natural narration, standard pace" };
  }
});

// WHAT: Registering the Smart Style Merger IPC handler.
// WHY: Queries LM Studio to intelligently combine two screenplay segments' directorial Qwen parameters
//      into a single, unified style configuration, based on explicit user instructions.
// STYLE: We define a strict schema asking the LLM to output ONLY a flat JSON object
//        with the exact 9 fields required by the Qwen3-TTS prompt generation template.
ipcMain.handle("llm:merge-qwen-styles", async (ipc_event_context, request_arguments) => {
  const { cell1_text, cell1_style, cell2_text, cell2_style, transition_instructions, lm_studio_api_url_address } = request_arguments;

  const system_instructional_prompt = filesystem_library.readFileSync(path_library.join(__dirname, "prompts", "style_merger.txt"), "utf8");

  const user_input_content = `Cell 1 Text: "${cell1_text}"
Cell 1 Style: ${JSON.stringify(cell1_style)}

Cell 2 Text: "${cell2_text}"
Cell 2 Style: ${JSON.stringify(cell2_style)}

Director's Transition Instructions: "${transition_instructions}"

Merge the styles of Cell 1 and Cell 2 to create a single, unified directorial style for the combined text, obeying the instructions above. Output raw JSON.`;

  // WHAT: Querying LM Studio dynamically to identify the active model tag.
  const active_loaded_model_id_tag = await retrieve_currently_loaded_model_tag(lm_studio_api_url_address);

  try {
    const api_response_payload = await dispatch_http_post_request(lm_studio_api_url_address, {
      model: active_loaded_model_id_tag,
      messages: [
        { role: "system", content: system_instructional_prompt },
        { role: "user", content: user_input_content }
      ],
      temperature: 0.4
    });

    if (!api_response_payload.choices || api_response_payload.choices.length === 0) {
      if (api_response_payload.error) {
        const lm_error_description = (typeof api_response_payload.error === "string")
          ? api_response_payload.error
          : (api_response_payload.error.message || JSON.stringify(api_response_payload.error));
        throw new Error(`LM Studio API Error: ${lm_error_description}`);
      }
      throw new Error(`Invalid response structure from LM Studio: ${JSON.stringify(api_response_payload)}`);
    }

    const active_choices_message_object = api_response_payload.choices[0].message;

    if (active_choices_message_object.refusal) {
      throw new Error(`LM Studio request was refused: ${active_choices_message_object.refusal}`);
    }

    const completion_content_text = active_choices_message_object.content.trim();
    const parsed_json_response = extract_json_from_llm_response_text(completion_content_text);

    // WHAT: Returning the flattened style direction string.
    // WHY: Keeps the Electron-to-ComfyUI loop standardized with the new schema.
    return parsed_json_response.merged_direction;
  } catch (api_failure_exception) {
    console.error("Smart merge failed.", api_failure_exception);
    throw api_failure_exception;
  }
});


// WHAT: Registering the Character References Discovery IPC handler.
// WHY: Scans the character's reference folder, lists all available emotional audio files,
//      and retrieves their matching transcribed text files (.txt) if present, to show in the UI.
ipcMain.handle("references:get-character-references", async (ipc_event_context, request_arguments) => {
  const { workspace_directory_path, project_name, character_name } = request_arguments;
  
  // WHAT: Standardizing names to safe lowercase filesystem strings.
  // WHY: Standardized character folders are safe for multi-OS compatibility.
  const standardized_character_name_string = character_name.toLowerCase().replace(/\s+/g, "_");

  // WHAT: Building the absolute path to the character's references subdirectory.
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
      // WHAT: Read all file names present in the directory.
      const list_of_folder_contents = filesystem_library.readdirSync(character_reference_subfolder_absolute_path);

      // WHAT: Filtering and collecting audio reference recordings.
      // WHY: We search for .mp3 or .wav files, then look for corresponding .txt files to read the transcripts.
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

// WHAT: Caching resolved path to avoid repeated PowerShell executions.
// WHY: Executing PowerShell shell queries incurs high CPU overhead, so we resolve the installation folder once and reuse it.
let cached_comfyui_base_directory_path = null;

// WHAT: Resolving the absolute base folder path of the ComfyUI installation.
// WHY: We need to stage cloning reference inputs into ComfyUI's 'input/' directory and retrieve completed takes from its 'output/' directory.
//      We check directories in strict order of user preference and structural availability, returning immediately when a valid directory is found.
function resolve_comfyui_base_directory() {
  if (cached_comfyui_base_directory_path) {
    return cached_comfyui_base_directory_path;
  }

  // WHAT: Loading configuration parameters from an external config.json file if present.
  // WHY: Allows custom installations (like ComfyUI path and desktop shortcuts) to be configured dynamically per system.
  let local_configuration_object = {};
  const config_file_path = path_library.join(__dirname, "config.json");
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
  const final_resort_fallback_path = path_library.join(__dirname, "..", "comfyui");

  // WHAT: Prioritizing the user's explicit installation directory.
  // WHY: The user confirmed their active ComfyUI is located here, so checking this first guarantees 100% correct path resolution.
  if (filesystem_library.existsSync(explicit_user_installation_path)) {
    cached_comfyui_base_directory_path = explicit_user_installation_path;
    return cached_comfyui_base_directory_path;
  }

  // WHAT: Secondary check - resolving the target path from the desktop shortcut link.
  // WHY: Allows dynamic resolution if the user runs different ComfyUI environments via standard launchers.
  if (filesystem_library.existsSync(shortcut_link_absolute_path)) {
    try {
      // WHAT: Querying desktop shortcut targets via Windows Script Host shell COM object inside powershell.
      // WHY: Electron has no native .lnk resolver, so we query the shell shortcut interface synchronously using a variable-free pipeline.
      const powershell_query_command = `powershell -ExecutionPolicy Bypass -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('${shortcut_link_absolute_path}').TargetPath"`;
      const resolved_shortcut_output_buffer = child_process_library.execSync(powershell_query_command);
      const cleaned_shortcut_target_path = resolved_shortcut_output_buffer.toString().trim();

      if (cleaned_shortcut_target_path) {
        // WHAT: Extracting the parent directory if target shortcut resolves directly to output folder.
        // WHY: The shortcut points to 'output/', but our handlers need the base directory parent so we can address 'input/' and 'output/' subdirectories.
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
  // WHY: Serves as a resilient fallback for legacy system configurations.
  if (filesystem_library.existsSync(primary_discovered_hardcoded_fallback_path)) {
    cached_comfyui_base_directory_path = primary_discovered_hardcoded_fallback_path;
    return cached_comfyui_base_directory_path;
  }

  // WHAT: Ultimate fallback.
  // WHY: Ensures the queue worker runs even in developer configurations where comfyui sits in a sibling folder.
  cached_comfyui_base_directory_path = final_resort_fallback_path;
  return cached_comfyui_base_directory_path;
}

// =========================================================================
// SEQUENTIAL GENERATION QUEUE & COMFYUI INTEGRATION (PASS 4)
// =========================================================================

// WHAT: Appending a synthesis task into the background generation list.
// WHY: We process synthesis operations sequentially to avoid overloading local CPU/GPU capacities.
ipcMain.handle("audio:enqueue-generation", async (ipc_event_context, request_arguments) => {
  const { workspace_directory_path, project_name, script_segment_data, voice_configuration_mapping, comfyui_api_url_address, take_number } = request_arguments;

  // WHAT: Packaging the task arguments.
  // WHY: The queue worker will consume these details at its own pace.
  const task_item_descriptor = {
    workspace_directory_path: workspace_directory_path,
    project_name: project_name,
    script_segment_data: script_segment_data,
    voice_configuration_mapping: voice_configuration_mapping,
    comfyui_api_url_address: comfyui_api_url_address,
    take_number: Number(take_number || 1)
  };

  audio_generation_task_queue.push(task_item_descriptor);

  // WHAT: Kicking off the queue worker if it's currently idle.
  // WHY: Ensures items are synthesized automatically without requiring manual triggers.
  if (!audio_generation_queue_is_processing) {
    execute_sequential_generation_queue();
  }

  return { queued: true, queueLength: audio_generation_task_queue.length };
});

// WHAT: Registering the Directorial Speech Synthesis Enqueuer IPC handler.
// WHY: Pushes Triple-Input directorial script segments into our sequential task queue.
ipcMain.handle("audio:enqueue-directorial-generation", async (ipc_event_context, request_arguments) => {
  const { workspace_directory_path, project_name, script_segment_data, voice_configuration_mapping, comfyui_api_url_address, take_number } = request_arguments;

  // WHAT: Packaging the task details with a directorial flag.
  // WHY: Tells the queue worker to run dynamic hook matching and compile double-engine payloads.
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
    execute_sequential_generation_queue();
  }

  return { queued: true, queueLength: audio_generation_task_queue.length };
});

// WHAT: Transforming a simple, potentially vague voice emotional state label into a multi-dimensional, descriptive profile.
// WHY: As detailed in the Qwen3-TTS Expressive Voice Engineering & Style Prompting Guidelines in our voices guide, 
//      supplying the model with rich, multi-layered stylistic adjectives (such as "bubbly, energetic, and optimistic" 
//      instead of just a bare "happy") gives the AI model much clearer acoustic targets, yielding extremely stable 
//      and professional-grade audiobook synthesis.
// STYLE: Here is a friendly tutorial on how this mapper function works:
//        We receive a raw emotional label string. We first convert it to standard lowercase and trim whitespace.
//        We then inspect the string using sub-phrase search checks. If we find key indicator terms like "happy", 
//        "sad", or "angry", we return the beautifully compiled, multi-dimensional descriptors. If the label is 
//        already highly specific or custom, we leave it untouched and pass it straight through.
function transform_simple_emotion_label_into_rich_description_string(raw_emotion_label_string) {
  const normalized_emotion_label_string = raw_emotion_label_string.toLowerCase().trim();

  // WHAT: Mapping standard baseline emotion keys to their premium multi-dimensional counterparts.
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

  // WHAT: Catch-all fallback.
  // WHY: If the string is already a unique custom description, we preserve it as is.
  return raw_emotion_label_string;
}

// WHAT: Core worker function that handles the background synthesis queue sequentially.
// WHY: Protects hardware allocations and maintains precise status updates to the UI.
async function execute_sequential_generation_queue() {
  // WHAT: Checking queue length and setting flags.
  // WHY: Clears running state when there are no tasks left to compute.
  if (audio_generation_task_queue.length === 0) {
    audio_generation_queue_is_processing = false;
    return;
  }

  audio_generation_queue_is_processing = true;
  const current_active_task = audio_generation_task_queue.shift();
  
  // WHAT: Setting up structured take directories.
  // WHY: Isolates each line's takes cleanly to keep the workspace uncluttered.
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

  // WHAT: Standard destination path with MP3 suffix by default.
  const target_file_extension_suffix = ".mp3";
  let destination_audio_file_path = path_library.join(
    take_destination_subfolder_path,
    `take_${target_take_number}${target_file_extension_suffix}`
  );

  // WHAT: Sending an "in-progress" status update to the frontend.
  // WHY: Animates progress gauges and shows which exact sentence is currently being read.
  notify_renderer_of_generation_progress({
    index_position: segment_index_position,
    status: "processing",
    is_directorial: current_active_task.is_directorial_segment_flag ? true : false,
    message: `Synthesizing line for: ${current_active_task.script_segment_data.speaker}...`
  });

  // WHAT: Track dynamic cloning references path to clean up staging files later.
  // WHY: Avoids staging directory bloat inside ComfyUI input folder.
  let staged_temporary_reference_audio_absolute_path = null;

  try {
    // WHAT: Proactive ComfyUI Connectivity Pre-Check.
    // WHY: If ComfyUI is offline or crashed, we don't want to dispatch a job and get stuck waiting
    //      10 minutes in the polling loop. We do a rapid ping first, and if it fails, we instantly
    //      fail the generation task so the queue can recover gracefully.
    let comfyui_is_reachable = await new Promise((resolve_ping) => {
      const ping_request = http_client_library.get(`${current_active_task.comfyui_api_url_address}/system_stats`, (http_response_object) => {
        resolve_ping(http_response_object.statusCode === 200);
      }).on('error', () => {
        resolve_ping(false);
      });
      // Short timeout for the ping
      ping_request.setTimeout(2500, () => {
        ping_request.destroy();
        resolve_ping(false);
      });
    });

    if (!comfyui_is_reachable) {
      throw new Error(`ComfyUI server is unreachable at ${current_active_task.comfyui_api_url_address}. Please ensure the server is running.`);
    }

    // WHAT: Resolving selected Qwen workflow settings.
    // WHY: Dynamically maps character-level configs and cell overrides to the REST templates.
    const active_speaker_name = current_active_task.script_segment_data.speaker;
    const global_character_mapping = current_active_task.voice_configuration_mapping[active_speaker_name] || {};
    const cell_override_mapping = current_active_task.script_segment_data.workflowOverride || {};

    let active_workflow_type = cell_override_mapping.workflowType || "inherit";
    if (active_workflow_type === "inherit") {
      // WHAT: Defaulting the active workflow type to the preset Custom Voice pipeline.
      // WHY: VoiceDesign suffers from "Acoustic Context Bleed" — the model re-sculpts the vocal
      //      cords based on the target text content, causing timbre drift across different lines.
      //      We default to "custom" (preset speakers + seed) for stable baseline identity.
      //      Characters with baked anchors or saved voices are auto-rerouted upstream.
      active_workflow_type = global_character_mapping.workflowType || "custom";
    }

    // =========================================================================
    // ANCHOR-AWARE DESIGN→CLONE AUTO-REROUTE
    // =========================================================================
    // WHAT: Checking if the character has a baked master anchor WAV file on disk.
    // WHY: Qwen3-TTS VoiceDesign suffers from timbre drift because the discrete multi-codebook
    //      language model is heavily influenced by the semantic structure of the reading text.
    //      When a master anchor WAV exists, we automatically reroute from the "design" workflow
    //      to the "clone" workflow (In-Context Learning mode), using the anchor as the reference
    //      audio. This structurally locks the character's voice identity across all target texts.
    let is_anchor_rerouted_to_clone_workflow = false;
    let resolved_anchor_wav_absolute_path = null;
    let resolved_anchor_transcript_text = null;

    // WHAT: Checking if the character has a fully saved custom voice in ComfyUI models folder.
    // WHY: If they have a Saved Custom Voice, we skip both design and standard ICL clone workflows,
    //      and use the highly efficient loadCustomVoice_api.json workflow directly.
    let is_saved_voice_rerouted = false;
    let resolved_saved_voice_filename = null;

    // WHAT: Checking if the character profile has a saved custom voice model file mapped.
    // WHY: If they have a pre-saved voice (from the ComfyUI models/voices folder), we bypass standard cloning/design routing and use the loadCustomVoice workflow for optimal speed.
    //      We skip this reroute ONLY if the request explicitly asks for the "design" workflow (e.g. testing new voice traits).
    if (global_character_mapping.savedVoiceFilename && active_workflow_type !== "design") {
      is_saved_voice_rerouted = true;
      active_workflow_type = "load_custom_voice";
      resolved_saved_voice_filename = global_character_mapping.savedVoiceFilename;
      console.log(`[Custom Voice Reroute] Character "${active_speaker_name}" has a globally saved voice model. Rerouting to loadCustomVoice.`);
    }



    // WHAT: Load workflow JSON template from disk.
    let workflow_filename;
    if (active_workflow_type === "load_custom_voice") {
      workflow_filename = "QWEN3-TTS-loadCustomVoice_api.json";
    } else if (active_workflow_type === "design") {
      workflow_filename = "Qwen3-tts-DesignVoice_API.json";
    } else if (active_workflow_type === "clone") {
      workflow_filename = "Qwen3-tts-voiceClone_API.json";
    } else {
      workflow_filename = "Qwen3-tts_CustomVoice_API.json";
    }
    const workflow_template_absolute_path = path_library.join(__dirname, "comfyui_workflows", workflow_filename);

    if (!filesystem_library.existsSync(workflow_template_absolute_path)) {
      throw new Error(`ComfyUI workflow API template not found at: ${workflow_template_absolute_path}`);
    }

    const comfyui_workflow_nodes_payload = JSON.parse(filesystem_library.readFileSync(workflow_template_absolute_path, "utf-8"));

    // WHAT: Constructing a highly structured, multi-dimensional voice style prompt based on the Qwen3-TTS Persona Prompt Template.
    // WHY: Blending Voice Quality, Prosody, Style, and Emotion dimensions ensures the model receives a balanced mix of vocal timbre, speech patterns, and emotional intent.
    let generated_qwen3_style_prompt_string = "";
    
    // WHAT: Extracting character persona attributes if present.
    // WHY: Harvests root characteristics for the Voice Quality and Style layers.
    const speaker_gender_specification = global_character_mapping.gender || "neutral";
    const speaker_age_specification = global_character_mapping.age || "adult";
    const speaker_personality_traits = global_character_mapping.traits || "clear tone";
    
    // WHAT: Resolving the local acting parameters.
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

    // WHAT: Compiling the final structured persona prompt matching the exact template blocks.
    // WHY: Provides balanced instruction sets mapping vocal timbre, prosody, acting persona, and emotional cues.
    let compiled_voice_quality_block = "";
    let compiled_prosody_block = "";
    let compiled_style_block = "";
    let compiled_emotion_block = "";

    if (has_rich_qwen_style_metadata) {
      if (current_active_task.script_segment_data.qwen_style) {
        // WHAT: Harvesting custom inline parameters from the screenplay card.
        // WHY: Ensures the ComfyUI synthesis prompt accurately reflects the user's direct edits in the screenplay view.
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

    // WHAT: Generating a deterministic fallback seed from the speaker's name when no explicit seed is configured.
    // WHY: A random seed on every generation request means every line sounds like a different person.
    //      By hashing the character name into a stable integer, the same character always receives
    //      the same vocal baseline, eliminating the "random voice lottery" problem.
    const character_name_deterministic_hash_value = Array.from(active_speaker_name).reduce(
      (running_hash_accumulator, current_character) =>
        ((running_hash_accumulator << 5) - running_hash_accumulator + current_character.charCodeAt(0)) | 0,
      0
    );
    const deterministic_fallback_seed_value = Math.abs(character_name_deterministic_hash_value) % 90000 + 10000;
    const active_seed_value = Number(cell_override_mapping.seed || global_character_mapping.seed || deterministic_fallback_seed_value);
    const target_dialogue_text = current_active_task.script_segment_data.text;

    let save_node_id_string = "43"; // default for custom

    // WHAT: Injecting workflow parameters dynamically based on selection type.
    if (active_workflow_type === "custom") {
      save_node_id_string = "43";
      // Node 41: WhatToSay text PrimitiveString
      if (comfyui_workflow_nodes_payload["41"]) {
        comfyui_workflow_nodes_payload["41"].inputs.value = target_dialogue_text;
      }
      // Node 42: VoiceStyle emotion PrimitiveString
      if (comfyui_workflow_nodes_payload["42"]) {
        comfyui_workflow_nodes_payload["42"].inputs.value = generated_qwen3_style_prompt_string;
      }
      // Node 39: FB_Qwen3TTSCustomVoice Inference Node
      if (comfyui_workflow_nodes_payload["39"]) {
        // WHAT: Resolving the target preset speaker name from cell overrides, then global profile, then fallback.
        const raw_preset_speaker_name = cell_override_mapping.voice || global_character_mapping.voice || "Eric";

        // WHAT: Validating the resolved speaker name against the actual Qwen3-TTS whitelist.
        // WHY: If stale project data or cached memory contains an invalid speaker name (e.g. old
        //      placeholders like 'Male_Deep_F5'), ComfyUI will silently reject the entire prompt
        //      with a validation error, causing the polling loop to time out after 10 minutes.
        //      This guard ensures we always fall back to 'Eric' if the name is not recognized.
        const validated_qwen3_speaker_whitelist = ["Aiden", "Dylan", "Eric", "Ono_anna", "Ryan", "Serena", "Sohee", "Uncle_fu", "Vivian"];
        const preset_speaker_name = validated_qwen3_speaker_whitelist.includes(raw_preset_speaker_name)
          ? raw_preset_speaker_name
          : "Eric";

        if (preset_speaker_name !== raw_preset_speaker_name) {
          console.warn(`[Voice Validation] Speaker "${raw_preset_speaker_name}" is not in the Qwen3-TTS whitelist. Falling back to "Eric".`);
        }

        comfyui_workflow_nodes_payload["39"].inputs.speaker = preset_speaker_name;
        comfyui_workflow_nodes_payload["39"].inputs.seed = active_seed_value;
        // WHAT: Explicitly setting the language parameter to English as required.
        // WHY: Guarantees that Qwen synthesizes standard English speech structures consistently.
        comfyui_workflow_nodes_payload["39"].inputs.language = "English";
      }
    } else if (active_workflow_type === "design") {
      // WHAT: Setting the proper save node target for Custom Voice Design mode.
      // WHY: Different inference modes pipe out to different structural nodes in ComfyUI; node 41 saves Design output.
      save_node_id_string = "41";
      // Node 42: WhatToSay text PrimitiveString
      if (comfyui_workflow_nodes_payload["42"]) {
        comfyui_workflow_nodes_payload["42"].inputs.value = target_dialogue_text;
      }
      // Node 43: VoiceStyle design prompt PrimitiveString
      if (comfyui_workflow_nodes_payload["43"]) {
        // WHAT: Checking if a pre-compiled full designPrompt already exists (built during cast discovery).
        // WHY: The cast discovery pipeline now compiles the complete multi-section Qwen3 character card
        //      (Character Name + Voice Profile + Identity & Background + Physical Appearance + Personality Traits)
        //      and stores it as the designPrompt. If this rich prompt exists, we use it directly as the
        //      foundation, then append dynamic delivery cues. Cell-level overrides take highest priority.
        const precompiled_design_prompt_string = cell_override_mapping.designPrompt || 
          global_character_mapping.designPrompt || "";

        // WHAT: Resolving individual character card sections for assembly when no precompiled prompt exists.
        // WHY: Backward compatibility — older projects may only have the flat "traits" or "baseVoice" fields.
        //      In that case, we build the full character card dynamically from available individual fields.
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
          // WHAT: Using the pre-compiled multi-section character card directly.
          // WHY: The designPrompt was already built as a full Qwen3 character card during cast discovery.
          //      We just append the dynamic delivery cues for this specific line.
          structured_custom_voice_style_prompt_string = 
            precompiled_design_prompt_string + `\n` +
            `Delivery: ${active_emotional_state}, ${active_pacing_level}, ${active_pitch_level} pitch, ${active_volume_level} volume`;
        } else {
          // WHAT: Building the full multi-section Qwen3 character card from individual fields.
          // WHY: Older projects or manually configured characters may not have the precompiled card.
          //      We assemble it from the resolved individual sections to match the DesignVoice API schema.
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
      // Node 38: FB_Qwen3TTSVoiceDesign Inference Node
      if (comfyui_workflow_nodes_payload["38"]) {
        comfyui_workflow_nodes_payload["38"].inputs.seed = active_seed_value;
        comfyui_workflow_nodes_payload["38"].inputs.control_after_generate = "fixed";
        // WHAT: Explicitly setting the language parameter to English as required.
        // WHY: Guarantees that Qwen designs standard English voice styles consistently.
        comfyui_workflow_nodes_payload["38"].inputs.language = "English";
      }
    } else if (active_workflow_type === "clone") {
      save_node_id_string = "4";
      // Node 6: SayIinCloneVoice target text PrimitiveString
      if (comfyui_workflow_nodes_payload["6"]) {
        comfyui_workflow_nodes_payload["6"].inputs.value = target_dialogue_text;
      }

      // =========================================================================
      // ANCHOR-BASED CLONE PATH (auto-rerouted from design workflow)
      // =========================================================================
      // WHAT: Checking if this clone request was auto-rerouted from the design workflow via a baked anchor.
      // WHY: When an anchor WAV exists, we skip the traditional per-emotion reference folder lookup
      //      and instead use the single master anchor WAV as the permanent structural voice reference.
      //      This ensures perfect timbre consistency regardless of the target text content.
      if (is_anchor_rerouted_to_clone_workflow && resolved_anchor_wav_absolute_path) {
        const standardized_anchor_clone_speaker_name = active_speaker_name.toLowerCase().replace(/\s+/g, "_");
        const anchor_staging_filename = `qwen_anchor_${standardized_anchor_clone_speaker_name}_${Date.now()}.wav`;
        const comfyui_resolved_base_directory_for_anchor = resolve_comfyui_base_directory();
        const absolute_comfyui_anchor_staging_path = path_library.join(
          comfyui_resolved_base_directory_for_anchor, "input", anchor_staging_filename
        );

        // WHAT: Ensuring the ComfyUI input directory exists before staging.
        // WHY: Prevents write failures if ComfyUI's input folder was cleaned or reinstalled.
        const comfyui_anchor_input_parent_directory = path_library.dirname(absolute_comfyui_anchor_staging_path);
        if (!filesystem_library.existsSync(comfyui_anchor_input_parent_directory)) {
          filesystem_library.mkdirSync(comfyui_anchor_input_parent_directory, { recursive: true });
        }

        // WHAT: Copying the baked anchor WAV into ComfyUI's input staging folder.
        // WHY: The LoadAudio node can only read files from ComfyUI's own input directory.
        filesystem_library.copyFileSync(resolved_anchor_wav_absolute_path, absolute_comfyui_anchor_staging_path);
        staged_temporary_reference_audio_absolute_path = absolute_comfyui_anchor_staging_path;

        // WHAT: Binding the anchor WAV filename to the LoadAudio node.
        if (comfyui_workflow_nodes_payload["2"]) {
          comfyui_workflow_nodes_payload["2"].inputs.audio = anchor_staging_filename;
        }
        // WHAT: Binding the anchor transcript to the CloneAudioText node.
        // WHY: Providing the exact transcript of the reference audio prevents the model from hitting
        //      an acoustic bottleneck and dramatically stabilizes the start of audio generation.
        if (comfyui_workflow_nodes_payload["5"]) {
          comfyui_workflow_nodes_payload["5"].inputs.value = resolved_anchor_transcript_text || "";
        }
        // WHAT: Configuring the VoiceClone inference node with tighter generation parameters.
        // WHY: Lower temperature (0.3) enforces stricter auto-regressive path adherence,
        //      preventing the model from wandering away from the anchor's vocal imprint.
        if (comfyui_workflow_nodes_payload["3"]) {
          comfyui_workflow_nodes_payload["3"].inputs.seed = active_seed_value;
          comfyui_workflow_nodes_payload["3"].inputs.control_after_generate = "fixed";
          comfyui_workflow_nodes_payload["3"].inputs.language = "English";
          comfyui_workflow_nodes_payload["3"].inputs.temperature = 0.3;
        }

      } else {
        // =========================================================================
        // TRADITIONAL PER-EMOTION REFERENCE CLONE PATH
        // =========================================================================
        // WHAT: Dynamic selection of the emotional reference audio clip.
        // WHY: We resolve the correct emotional mp3 file from references/[character] subfolder,
        //      copy it to ComfyUI inputs, and parse the transcribed text.
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
        // WHAT: Setting a generic fallback transcript for when no matching .txt file exists.
        // WHY: An inaccurate or missing transcript causes Qwen3's attention alignment mechanism
        //      to map acoustic patterns to the wrong phonemes, resulting in garbled first words,
        //      random pitch spikes, and timing instability. This fallback is a last resort.
        let reference_transcription_text = "The direct path through the valley was covered in thick, dark moss.";
        let is_transcript_missing_warning_flag = true; // Track if we're using the fallback

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
            // WHAT: Dynamic staging of reference audio file.
            // WHY: Copies reference recording to ComfyUI's input directory under a safe, unique name
            //      so the ComfyUI LoadAudio node can load it instantly.
            const unique_comfyui_input_filename = `qwen_staging_${standardized_speaker_name}_${selected_audio_emotion_label}_${Date.now()}.mp3`;
            // WHAT: Resolving the dynamic ComfyUI base folder path.
            // WHY: Since ComfyUI can be installed on external drives, we dynamically query the
            //      base directory path before staging the reference voice cloning recordings.
            const comfyui_resolved_base_directory = resolve_comfyui_base_directory();
            const absolute_comfyui_input_staging_path = path_library.join(
              comfyui_resolved_base_directory, "input", unique_comfyui_input_filename
            );

            // Ensure parent directories for ComfyUI input exist
            const comfyui_input_directory_parent = path_library.dirname(absolute_comfyui_input_staging_path);
            if (!filesystem_library.existsSync(comfyui_input_directory_parent)) {
              filesystem_library.mkdirSync(comfyui_input_directory_parent, { recursive: true });
            }

            filesystem_library.copyFileSync(absolute_source_audio_path_to_use, absolute_comfyui_input_staging_path);
            resolved_reference_audio_filename = unique_comfyui_input_filename;
            staged_temporary_reference_audio_absolute_path = absolute_comfyui_input_staging_path;

            // WHAT: Reading corresponding `.txt` transcription context file.
            // WHY: The exact transcript of the reference audio is critical for Qwen3's attention
            //      alignment mechanism to correctly map sound patterns to phonemes.
            const transcript_text_filepath = path_library.join(references_subfolder_absolute_path, `${selected_audio_emotion_label}.txt`);
            if (filesystem_library.existsSync(transcript_text_filepath)) {
              reference_transcription_text = filesystem_library.readFileSync(transcript_text_filepath, "utf-8").trim();
              is_transcript_missing_warning_flag = false;
            } else {
              console.warn(`[Voice Consistency Warning] No transcript file found at: ${transcript_text_filepath}. Using generic fallback transcript. This WILL cause voice instability. Please create a .txt file with the exact words spoken in the reference audio.`);
            }
          }
        }

        // Node 2: LoadCloneAudio LoadAudio node
        if (comfyui_workflow_nodes_payload["2"] && resolved_reference_audio_filename) {
          comfyui_workflow_nodes_payload["2"].inputs.audio = resolved_reference_audio_filename;
        }
        // Node 5: CloneAudioText PrimitiveString
        if (comfyui_workflow_nodes_payload["5"]) {
          comfyui_workflow_nodes_payload["5"].inputs.value = reference_transcription_text;
        }
        // Node 3: FB_Qwen3TTSVoiceClone Inference Node
        if (comfyui_workflow_nodes_payload["3"]) {
          comfyui_workflow_nodes_payload["3"].inputs.seed = active_seed_value;
          comfyui_workflow_nodes_payload["3"].inputs.control_after_generate = "fixed";
          // WHAT: Explicitly setting the language parameter to English as required.
          // WHY: Guarantees that Qwen clones voices with English language structures consistently.
          comfyui_workflow_nodes_payload["3"].inputs.language = "English";
          // WHAT: Tightening autoregressive generation parameters for voice consistency.
          // WHY: The workflow template defaults to temperature=1.0 (maximum randomness), which
          //      causes dramatic run-to-run variation in pitch contour, pacing, and vocal texture.
          //      Lowering temperature to 0.3 enforces strict adherence to the reference voice's
          //      acoustic profile. Tighter top_p/top_k further constrain the token sampling space.
          comfyui_workflow_nodes_payload["3"].inputs.temperature = 0.3;
          comfyui_workflow_nodes_payload["3"].inputs.top_p = 0.7;
          comfyui_workflow_nodes_payload["3"].inputs.top_k = 15;
          comfyui_workflow_nodes_payload["3"].inputs.repetition_penalty = 1.1;
        }
      }
    } else if (active_workflow_type === "load_custom_voice") {
      save_node_id_string = "99"; // We'll dynamically inject this SaveAudio node

      // WHAT: Configuring target text, seed, and language on Node 10 (FB_Qwen3TTSVoiceClone).
      // WHY: Supplies the sentence we want to synthesize and sets deterministic seeds for generation.
      if (comfyui_workflow_nodes_payload["10"]) {
        comfyui_workflow_nodes_payload["10"].inputs.target_text = target_dialogue_text;
        comfyui_workflow_nodes_payload["10"].inputs.seed = active_seed_value;
        comfyui_workflow_nodes_payload["10"].inputs.language = "English";
        // WHAT: Tightening autoregressive generation parameters for saved custom voice consistency.
        // WHY: The loadCustomVoice workflow template defaults to temperature=1.0 and top_p=0.8,
        //      which allows excessive variation between generations. By constraining these values,
        //      the saved voice's latent profile is followed much more faithfully, producing
        //      near-identical vocal timbre and pacing across all lines in the audiobook.
        comfyui_workflow_nodes_payload["10"].inputs.temperature = 0.3;
        comfyui_workflow_nodes_payload["10"].inputs.top_p = 0.7;
        comfyui_workflow_nodes_payload["10"].inputs.top_k = 15;
        comfyui_workflow_nodes_payload["10"].inputs.repetition_penalty = 1.1;
      }

      // WHAT: Configuring the filename on Node 11 (FB_Qwen3TTSLoadSpeaker).
      // WHY: Instructs the voice loader to read the saved speaker latent profile file directly from ComfyUI voices models.
      if (comfyui_workflow_nodes_payload["11"]) {
        comfyui_workflow_nodes_payload["11"].inputs.filename = `${resolved_saved_voice_filename}.wav`;
      }

      // WHAT: Injecting a dynamic SaveAudio node.
      // WHY: The provided loadCustomVoice API template generates audio but doesn't have a SaveAudio node.
      //      Our backend needs a saved output FLAC/WAV to stitch together. We inject it and hook it to Node 10.
      comfyui_workflow_nodes_payload[save_node_id_string] = {
        inputs: {
          filename_prefix: "audio/ComfyUI",
          audio: ["10", 0]
        },
        class_type: "SaveAudio",
        _meta: { title: "Save Audio (Injected)" }
      };
    }

    // WHAT: Set dynamic take prefix to prevent output file name collisions.
    if (comfyui_workflow_nodes_payload[save_node_id_string]) {
      comfyui_workflow_nodes_payload[save_node_id_string].inputs.filename_prefix = `take/${target_file_prefix_label}_${segment_index_position}_take_${target_take_number}`;
    }

    // Dispatch request
    const comfyui_response = await dispatch_http_post_request(`${current_active_task.comfyui_api_url_address}/prompt`, { prompt: comfyui_workflow_nodes_payload });
    const prompt_execution_id = comfyui_response.prompt_id;

    // Polling ComfyUI history
    let rendering_is_active = true;
    let check_iterations_limit = 0;

    // WHAT: Polling ComfyUI history to check for completed renders.
    // WHY: Voice synthesis pipelines (especially with model warm-ups or complex cloning graphs)
    //      can take longer than 60 seconds. We increase the timeout iteration limit to 600 (10 minutes)
    //      to prevent premature failures during slower rendering phases.
    while (rendering_is_active && check_iterations_limit < 600) {
      await new Promise((resolve_delay) => setTimeout(resolve_delay, 1000));
      
      const queue_status_payload = await fetch_comfyui_queue_history(current_active_task.comfyui_api_url_address, prompt_execution_id);
      if (queue_status_payload && queue_status_payload[prompt_execution_id]) {
        rendering_is_active = false;
        
        const comfyui_history_entry = queue_status_payload[prompt_execution_id];
        
        // WHAT: Parsing the output audio entry and reconstructing the relative path.
        // WHY: ComfyUI splits the saved file path in its history logs into separate 'subfolder'
        //      (e.g., 'take') and 'filename' (e.g., 'line_0_take_3_00001_.mp3') fields. We join
        //      them together to obtain the correct relative path.
        if (!comfyui_history_entry.outputs || !comfyui_history_entry.outputs[save_node_id_string]) {
            throw new Error(`ComfyUI workflow finished but no output found for save node ${save_node_id_string}. The prompt might have failed execution.`);
        }
        
        const audio_output_entry = comfyui_history_entry.outputs[save_node_id_string].audio[0];
        const relative_rendered_audio_path = path_library.join(
          audio_output_entry.subfolder || "",
          audio_output_entry.filename
        );

        // WHAT: Dynamically resolving the target ComfyUI output directory path.
        // WHY: Ensures we look in the active external H-drive directory where ComfyUI renders
        //      takes, preventing file-not-found failures on non-standard installations.
        const comfyui_resolved_base_directory = resolve_comfyui_base_directory();
        const absolute_comfyui_output_wav_path = path_library.join(
          comfyui_resolved_base_directory, "output", relative_rendered_audio_path
        );

        if (filesystem_library.existsSync(absolute_comfyui_output_wav_path)) {
          // WHAT: Dynamic extension update.
          // WHY: If ComfyUI generated MP3, we update destination path extension dynamically.
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

    // WHAT: Notify front-end of success.
    // WHY: Updates editor status overlays to checkmarks.
    notify_renderer_of_generation_progress({
      index_position: current_active_task.script_segment_data.index_position,
      status: "completed",
      filePath: destination_audio_file_path,
      is_directorial: current_active_task.is_directorial_segment_flag ? true : false,
      take_number: current_active_task.take_number || 1,
      message: "Synthesis completed."
    });

  } catch (synthesis_failure_exception) {
    console.error("Queue item synthesis failed.", synthesis_failure_exception);
    notify_renderer_of_generation_progress({
      index_position: current_active_task.script_segment_data.index_position,
      status: "failed",
      is_directorial: current_active_task.is_directorial_segment_flag ? true : false,
      message: `Failed: ${synthesis_failure_exception.message}`
    });
  } finally {
    // WHAT: Safely cleaning up staged dynamic cloning reference files from the ComfyUI server folder.
    // WHY: Prevents the ComfyUI server input directory from growing infinitely over long voice cloning sessions,
    //      avoiding major file index scanning and caching sluggishness.
    if (staged_temporary_reference_audio_absolute_path && filesystem_library.existsSync(staged_temporary_reference_audio_absolute_path)) {
      try {
        filesystem_library.unlinkSync(staged_temporary_reference_audio_absolute_path);
      } catch (cleanup_error) {
        console.error("Failed to clean up staged reference audio file.", cleanup_error);
      }
    }

    // WHAT: Process next queue item.
    // WHY: Keeps sequential flow churning automatically.
    execute_sequential_generation_queue();
  }
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

// WHAT: Send updates back to UI via main IPC window link.
// WHY: Renderer listening bridges can animate state bars based on progress updates.
function notify_renderer_of_generation_progress(progress_update_payload) {
  if (primary_application_window) {
        primary_application_window.webContents.send("audio:generation-status-update", progress_update_payload);
      }
    }

    // =========================================================================
    /// AUDIO STITCHING ENGINE (PASS 5) - HYBRID POST-PRODUCTION CONCATENATOR
    // =========================================================================

    // WHAT: Main project compiler. Merges individual lines into a compiled audiobook track.
    // WHY: Stitches audio in pure JavaScript to remain reliable without ffmpeg binaries,
    //      supporting both MP3 binary stream concatenation and PCM WAV header reconstruction.
        ipcMain.handle("project:save-master-audio", async (event, args) => {
      const { workspace_directory_path, project_name, array_buffer, is_directorial } = args;
      const formatted_project_name = project_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const mixdown_file_prefix_label = is_directorial ? `${formatted_project_name}_directorial_mixdown` : `${formatted_project_name}_classic_mixdown`;
      const compiled_book_output_audio_path = path_library.join(workspace_directory_path, project_name, `${mixdown_file_prefix_label}.wav`);
      filesystem_library.writeFileSync(compiled_book_output_audio_path, Buffer.from(array_buffer));
      return { mixdownAudioPath: compiled_book_output_audio_path };
    });

    // WHAT: Handle native OS context menus for cell manipulation.
    // WHY: Provides a native, reliable popup menu overlaying the Electron window.
    ipcMain.handle("ui:show-context-menu", (event) => {
      return new Promise((resolve) => {
        const template = [
          { label: 'Combine with cell above', click: () => resolve('above') },
          { label: 'Combine with cell below', click: () => resolve('below') },
          { type: 'separator' },
          { label: 'Insert cell above', click: () => resolve('insert_above') },
          { label: 'Insert cell below', click: () => resolve('insert_below') },
          { type: 'separator' },
          { label: 'Split cell at quote (quick)', click: () => resolve('split_at_quote') }
        ];
        
        const menu = Menu.buildFromTemplate(template);
        const window_instance = BrowserWindow.fromWebContents(event.sender);
        
        menu.popup({
          window: window_instance,
          callback: () => {
            // Delay resolution to allow click events to fire first.
            // If the user clicks out, this resolves null.
            setTimeout(() => resolve(null), 50);
          }
        });
      });
    });

// =========================================================================
// QUEUE STATE MANAGEMENT & RECOVERY IPC HANDLERS
// =========================================================================

// WHAT: Retrieves the current status and length of the background audio synthesis queue.
// WHY: Allows the renderer to verify if the queue is healthy and still processing tasks,
//      particularly after reconnecting or refreshing the UI.
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
// WHY: The "manual boop". If a generation gets stuck (e.g., ComfyUI crashed mid-render
//      but hasn't timed out yet), the user can click reset. This clears all pending tasks
//      and resets the processor state so new generation commands work instantly.
ipcMain.handle("audio:reset-queue", async () => {
  // Clear the in-memory array
  audio_generation_task_queue = [];
  // Reset the processing flag so next generation boots instantly
  audio_generation_queue_is_processing = false;
  
  console.log("[Queue Reset] Main process audio generation queue has been manually flushed.");
  
  return { success: true, message: "Queue flushed and reset." };
});

// =========================================================================
// VOICE ANCHOR BAKING PIPELINE (BAKE-ONCE, CLONE-ALWAYS)
// =========================================================================

// WHAT: Registering the Voice Anchor Bake IPC handler.
// WHY: This is Step 1 of the Two-Step Voice Cloning pipeline. It runs the Qwen3-TTS VoiceDesign
//      workflow exactly once with the character's design prompt and seed, then converts the output
//      to a 16-bit Mono WAV at 24kHz using FFmpeg, and saves it as the character's permanent master
//      anchor file. All subsequent generation requests for this character will automatically reroute
//      through the VoiceClone workflow using this anchor as the ICL reference.
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

  // WHAT: Ensuring the anchors directory exists.
  // WHY: First-time bake on older projects may not have this folder yet.
  if (!filesystem_library.existsSync(anchors_directory_absolute_path)) {
    filesystem_library.mkdirSync(anchors_directory_absolute_path, { recursive: true });
  }

  // WHAT: Sending a processing status update to the renderer.
  // WHY: Animates the anchor bake button and status badge in the Voice Matrix UI.
  notify_renderer_of_generation_progress({
    index_position: `anchor_bake_${standardized_character_name_string}`,
    status: "processing",
    is_directorial: false,
    message: `Baking master anchor clip for ${character_name}...`
  });

  // WHAT: Track staged reference audio path for cleanup.
  let staged_anchor_bake_output_path = null;

  try {
    // WHAT: Proactive ComfyUI connectivity pre-check.
    // WHY: Prevents a 10-minute timeout if ComfyUI is offline.
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

    // WHAT: Loading the VoiceDesign API workflow template from disk.
    // WHY: The bake step uses VoiceDesign to generate the master audio clip from the character card prompt.
    const voice_design_workflow_template_path = path_library.join(__dirname, "comfyui_workflows", "Qwen3-tts-DesignVoice_API.json");
    if (!filesystem_library.existsSync(voice_design_workflow_template_path)) {
      throw new Error(`VoiceDesign workflow template not found at: ${voice_design_workflow_template_path}`);
    }
    const anchor_bake_workflow_nodes_payload = JSON.parse(
      filesystem_library.readFileSync(voice_design_workflow_template_path, "utf-8")
    );

    // WHAT: Injecting the anchor phrase (what to say) into the WhatToSay node (ID 42).
    // WHY: The anchor phrase is a neutral, punctuation-balanced ~12 second script designed to
    //      capture the full range of the character's vocal register without emotional bias.
    if (anchor_bake_workflow_nodes_payload["42"]) {
      anchor_bake_workflow_nodes_payload["42"].inputs.value = anchor_phrase;
    }

    // WHAT: Injecting the character's full design prompt into the VoiceStyle node (ID 43).
    // WHY: The design prompt contains the multi-section Qwen3 character card (Character Name,
    //      Voice Profile, Identity & Background, Physical Appearance, Personality Traits)
    //      that defines the voice's acoustic DNA.
    if (anchor_bake_workflow_nodes_payload["43"]) {
      anchor_bake_workflow_nodes_payload["43"].inputs.value = design_prompt;
    }

    // WHAT: Setting the user's chosen seed and locking generation parameters on the inference node (ID 38).
    // WHY: A fixed seed ensures reproducible voice characteristics across bake attempts.
    if (anchor_bake_workflow_nodes_payload["38"]) {
      anchor_bake_workflow_nodes_payload["38"].inputs.seed = Number(seed_value);
      anchor_bake_workflow_nodes_payload["38"].inputs.control_after_generate = "fixed";
      anchor_bake_workflow_nodes_payload["38"].inputs.language = "English";
    }

    // WHAT: Setting a unique output prefix so the baked anchor file doesn't collide with regular takes.
    const anchor_bake_output_prefix = `anchor_bake/${standardized_character_name_string}_anchor`;
    if (anchor_bake_workflow_nodes_payload["41"]) {
      anchor_bake_workflow_nodes_payload["41"].inputs.filename_prefix = anchor_bake_output_prefix;
    }

    // WHAT: Dispatching the VoiceDesign workflow to ComfyUI.
    const comfyui_anchor_bake_response = await dispatch_http_post_request(
      `${comfyui_api_url_address}/prompt`,
      { prompt: anchor_bake_workflow_nodes_payload }
    );
    const anchor_bake_prompt_execution_id = comfyui_anchor_bake_response.prompt_id;

    // WHAT: Polling ComfyUI history until the anchor bake render completes.
    // WHY: VoiceDesign renders typically complete in 10–30 seconds but may take longer on cold starts.
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

        // WHAT: Parsing the output audio entry from the VoiceDesign save node (ID 41).
        const anchor_bake_audio_output_entry = anchor_bake_history_entry.outputs["41"].audio[0];
        const anchor_bake_relative_rendered_path = path_library.join(
          anchor_bake_audio_output_entry.subfolder || "",
          anchor_bake_audio_output_entry.filename
        );

        // WHAT: Constructing absolute path to the rendered anchor MP3 in ComfyUI's output directory.
        const comfyui_resolved_base_directory_for_anchor_bake = resolve_comfyui_base_directory();
        const absolute_comfyui_anchor_bake_output_path = path_library.join(
          comfyui_resolved_base_directory_for_anchor_bake, "output", anchor_bake_relative_rendered_path
        );

        if (!filesystem_library.existsSync(absolute_comfyui_anchor_bake_output_path)) {
          throw new Error(`Baked anchor file was not found in ComfyUI output at: ${absolute_comfyui_anchor_bake_output_path}`);
        }

        staged_anchor_bake_output_path = absolute_comfyui_anchor_bake_output_path;

        // WHAT: Converting the rendered MP3 to 16-bit Mono WAV at 24kHz using FFmpeg.
        // WHY: Qwen3-TTS-Tokenizer-12Hz expects uncompressed Mono audio at 24kHz+ to avoid
        //      voice profile warping caused by compression artifacts or stereo phasing glitches.
        //      The trailing 200ms of digital silence prevents "First-Token Phonic Bleed" where
        //      the last phoneme of the reference audio distorts the first word of generated speech.
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
            // WHAT: Appending 200ms of digital silence to the end of the anchor clip.
            // WHY: Prevents the known Qwen3-TTS "First-Token Phonic Bleed" issue where an
            //      abruptly ending reference clip causes the first word of generated speech
            //      to sound distorted or clipped.
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

        // WHAT: Saving the anchor transcript as a companion .txt file alongside the WAV.
        // WHY: The queue worker reads this transcript at runtime to provide exact text alignment
        //      to the VoiceClone node, which prevents acoustic bottleneck and stabilizes generation.
        const anchor_transcript_file_absolute_path = path_library.join(
          anchors_directory_absolute_path,
          `${standardized_character_name_string}_anchor_transcript.txt`
        );
        filesystem_library.writeFileSync(anchor_transcript_file_absolute_path, anchor_phrase, "utf-8");

        // WHAT: Sending a success status update to the renderer.
        notify_renderer_of_generation_progress({
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

    notify_renderer_of_generation_progress({
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

// =========================================================================
// PEAKS.JS AUDIO EDITOR SUPPORT - FILE SERVING & TIMELINE MARKERS
// =========================================================================

// WHAT: IPC handler to read a raw audio file from disk and return it as a serializable ArrayBuffer.
// WHY: Provides a fallback mechanism for the renderer to obtain audio data when the custom protocol
//      handler is unavailable or when peaks.js needs direct buffer access for waveform generation.
ipcMain.handle("audio:read-file-as-buffer", async (ipc_event_context, request_arguments) => {
  const { file_path } = request_arguments;

  // WHAT: Validating that the requested file exists on the filesystem.
  // WHY: Prevents runtime errors if the audio file was deleted or never generated.
  if (!file_path || !filesystem_library.existsSync(file_path)) {
    throw new Error(`Audio file not found at path: ${file_path}`);
  }

  // WHAT: Reading the entire file into a Node.js Buffer and converting to ArrayBuffer.
  // WHY: The renderer needs raw bytes to feed into the Web Audio API's decodeAudioData() method.
  const raw_file_buffer = filesystem_library.readFileSync(file_path);
  return raw_file_buffer.buffer.slice(
    raw_file_buffer.byteOffset,
    raw_file_buffer.byteOffset + raw_file_buffer.byteLength
  );
});

// WHAT: IPC handler to read and parse the timeline markers CSV file for a given project.
// WHY: After stitching, the app generates a CSV with per-segment timestamps (speaker, text, start time).
//      Peaks.js uses this data to render interactive segment overlays on the waveform, allowing the
//      user to visually identify which character is speaking at any point in the audiobook.
ipcMain.handle("audio:read-timeline-markers", async (ipc_event_context, request_arguments) => {
  const { workspace_directory_path, project_name, is_directorial } = request_arguments;

  // WHAT: Constructing the absolute path to the timeline markers CSV file.
  // WHY: Classic and directorial pipelines produce separate CSV files with different prefixes.
  const csv_file_prefix_label = is_directorial ? "timeline_markers_directorial" : "timeline_markers";
  const timeline_csv_absolute_path = path_library.join(
    workspace_directory_path,
    project_name,
    `${csv_file_prefix_label}.csv`
  );

  // WHAT: Checking if the CSV file exists on disk.
  // WHY: The CSV is only generated after the stitching pass completes successfully.
  if (!filesystem_library.existsSync(timeline_csv_absolute_path)) {
    return { markers: [] };
  }

  // WHAT: Reading and parsing the CSV file line by line into structured marker objects.
  // WHY: Each row contains an index, speaker name, dialogue text, and start timestamp in seconds.
  //      We parse these into a clean array that peaks.js can consume as segment definitions.
  const raw_csv_file_content = filesystem_library.readFileSync(timeline_csv_absolute_path, "utf-8");
  const csv_content_lines = raw_csv_file_content.split("\n").filter(line_text => line_text.trim().length > 0);

  // WHAT: Skipping the CSV header row ("Index,Speaker,Text,StartTimeSeconds").
  // WHY: The first line contains column labels, not data.
  const parsed_timeline_marker_objects = [];
  for (let line_index = 1; line_index < csv_content_lines.length; line_index++) {
    const current_csv_line = csv_content_lines[line_index];

    // WHAT: Parsing CSV fields that may contain quoted strings with commas inside.
    // WHY: Speaker names and dialogue text are wrapped in double quotes and may contain
    //      internal commas or escaped quote characters that a naive split(",") would break.
    const csv_field_extraction_regex = /(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^,]*))/g;
    const extracted_field_values = [];
    let regex_match_result;
    while ((regex_match_result = csv_field_extraction_regex.exec(current_csv_line)) !== null) {
      const field_value = (regex_match_result[1] !== undefined)
        ? regex_match_result[1].replace(/""/g, '"')
        : regex_match_result[2];
      extracted_field_values.push(field_value);
    }

    // WHAT: Mapping extracted CSV fields to named properties.
    // WHY: Creates a clean, structured object for the renderer to consume.
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

// WHAT: Registering the promote test to anchor IPC handler.
// WHY: Allows users to bypass baking by directly promoting a test take to be the master anchor.
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

  // WHAT: Ensuring the anchors directory exists in the project workspace.
  // WHY: If the project doesn't have an anchors subfolder yet, we must create it recursively before copying the WAV file.
  if (!filesystem_library.existsSync(anchors_directory_absolute_path)) {
    filesystem_library.mkdirSync(anchors_directory_absolute_path, { recursive: true });
  }

  const destination_anchor_file_path = path_library.join(
    anchors_directory_absolute_path, `character_voice_${standardized_character_name_string}.wav`
  );

  try {
    // WHAT: Copying the selected test take WAV file to the standard master anchor path.
    // WHY: Overwrites any existing master anchor for this character to promote this specific take as the new reference.
    filesystem_library.copyFileSync(test_take_file_path, destination_anchor_file_path);
    return { success: true, anchor_file_path: destination_anchor_file_path };
  } catch (promote_operation_error) {
    // WHAT: Logging the file copying error and returning a failure report.
    // WHY: Keeps the process stable and notifies the front-end if file permissions or paths caused a copy failure.
    console.error("Failed to promote test take to anchor:", promote_operation_error);
    return { success: false, error: promote_operation_error.message };
  }
});

// WHAT: Programmatic Refresh of ComfyUI model directories and object definitions.
// WHY: Ensures new saved voices are immediately recognized by ComfyUI without a manual restart.
async function refresh_comfyui_models(comfyui_api_url) {
  return new Promise((resolve_refresh_promise, reject_refresh_promise) => {
    // WHAT: Dispatching an asynchronous POST request to ComfyUI's `/free` endpoint.
    // WHY: Forces ComfyUI to unload cached model weights, prompting it to scan the directories for new files.
    const comfyui_post_request_handle = http_client_library.request(`${comfyui_api_url}/free`, { method: 'POST' }, (comfyui_free_response_stream) => {
      // WHAT: Querying ComfyUI's `/object_info` endpoint after the cache clear.
      // WHY: Forces ComfyUI to reload the schema mapping which registers newly discovered voices in dropdown list properties.
      http_client_library.get(`${comfyui_api_url}/object_info`, (comfyui_object_info_response_stream) => {
        // WHAT: Resolving the refresh promise.
        // WHY: Indicates that ComfyUI has finished clearing cache and re-indexing its available node properties.
        resolve_refresh_promise(true);
      }).on('error', reject_refresh_promise);
    });
    
    // WHAT: Handling POST request errors during model refresh.
    // WHY: Rejects the promise to surface networking or connectivity failures to the caller.
    comfyui_post_request_handle.on('error', reject_refresh_promise);
    comfyui_post_request_handle.end();
  });
}

// WHAT: Registering the Save Custom Voice IPC handler.
// WHY: Executes the QWEN3-TTS-saveCustomVoice_api.json workflow to save a character's voice to ComfyUI models.
ipcMain.handle("audio:save-custom-voice", async (ipc_event_context, request_arguments) => {
  const { workspace_directory_path, project_name, character_name, anchor_file_path, anchor_phrase } = request_arguments;
  const comfyui_api_url_address = "http://127.0.0.1:8188"; // standard fallback

  try {
    const workflow_template_absolute_path = path_library.join(__dirname, "comfyui_workflows", "QWEN3-TTS-saveCustomVoice_api.json");
    
    // WHAT: Validating that the ComfyUI workflow JSON template exists on disk before reading.
    // WHY: If the file is missing, we must abort early with a descriptive error to prevent execution failure later.
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
    
    // Ensure the ComfyUI input directory exists
    if (!filesystem_library.existsSync(comfyui_input_folder)) {
      filesystem_library.mkdirSync(comfyui_input_folder, { recursive: true });
    }
    
    // Copy the anchor file to ComfyUI's input directory to comply with standard security policies
    const staging_filename = `anchor_save_${uuid_string}.wav`;
    const destination_path = path_library.join(comfyui_input_folder, staging_filename);
    filesystem_library.copyFileSync(anchor_file_path, destination_path);

    // WHAT: Configuring ComfyUI Node "1" with the staged filename of the character's anchor WAV audio file.
    // WHY: The VoiceClone node requires the source reference audio file path to load its vocal features.
    if (comfyui_workflow_nodes_payload["1"]) {
      comfyui_workflow_nodes_payload["1"].inputs.audio = staging_filename;
    }
    
    // WHAT: Setting the reference text on Node "2" to match the anchor phrase.
    // WHY: The TTS model needs the textual transcription of the anchor audio for accurate clone mapping.
    if (comfyui_workflow_nodes_payload["2"]) {
      comfyui_workflow_nodes_payload["2"].inputs.ref_text = anchor_phrase || "";
    }
    
    // WHAT: Setting target text, reference text, and a random seed on the Qwen3-TTS VoiceClone node (Node 3).
    // WHY: We feed in the anchor phrase as both source reference text and destination target text to clone the baseline tone.
    if (comfyui_workflow_nodes_payload["3"]) {
      comfyui_workflow_nodes_payload["3"].inputs.target_text = anchor_phrase;
      comfyui_workflow_nodes_payload["3"].inputs.ref_text = anchor_phrase;
      comfyui_workflow_nodes_payload["3"].inputs.seed = Math.floor(Math.random() * 90000) + 10000;
    }

    // WHAT: Deleting unnecessary output nodes that cause validation failures.
    // WHY: The save custom voice template contains a VoiceClone and SaveAudio node which are unnecessary and fail validation.
    delete comfyui_workflow_nodes_payload["3"];
    delete comfyui_workflow_nodes_payload["4"];
    
    // WHAT: Configuring the output filename and reference transcription on the SaveVoice node (Node 5).
    // WHY: Directs ComfyUI to write the computed latent vocal embeddings file to disk using the specific target filename format.
    if (comfyui_workflow_nodes_payload["5"]) {
      comfyui_workflow_nodes_payload["5"].inputs.filename = target_filename;
      comfyui_workflow_nodes_payload["5"].inputs.ref_text = anchor_phrase || "";
    }

    const payload_data_string = JSON.stringify({
      prompt: comfyui_workflow_nodes_payload,
      client_id: "audiobooks_save_voice_client"
    });

    // WHAT: Submitting the populated ComfyUI workflow JSON structure to the local ComfyUI server `/prompt` endpoint.
    // WHY: We execute this network POST request asynchronously to schedule the voice cloning task on ComfyUI's internal queue.
    const execution_response = await new Promise((resolve_request, reject_request) => {
      const post_request = http_client_library.request(`${comfyui_api_url_address}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload_data_string) }
      }, (comfyui_prompt_response_stream) => {
        let comfyui_prompt_response_body = '';
        
        // WHAT: Collecting chunks of binary buffer data from the HTTP response stream.
        // WHY: The response payload is streamed from the ComfyUI API, so we assemble it incrementally.
        comfyui_prompt_response_stream.on('data', (response_data_chunk) => {
          comfyui_prompt_response_body += response_data_chunk;
        });
        
        // WHAT: Parsing the completed response body into JSON when the stream closes.
        // WHY: We resolve the main execution promise with the parsed response object (containing the prompt_id) to verify submission status.
        comfyui_prompt_response_stream.on('end', () => {
          resolve_request(JSON.parse(comfyui_prompt_response_body));
        });
      });
      
      // WHAT: Handling connection failures or network drops.
      // WHY: If the local ComfyUI instance isn't running or rejects the connection, we reject the promise to alert the user.
      post_request.on('error', reject_request);
      post_request.write(payload_data_string);
      post_request.end();
    });

    // WHAT: Checking if the ComfyUI server encountered issues parsing or scheduling the workflow prompt payload.
    // WHY: If an error is returned in the response object, we immediately throw an exception to stop execution.
    if (execution_response.error) {
      console.error("ComfyUI Prompt Validation Error Details:", JSON.stringify(execution_response.error, null, 2));
      throw new Error(`ComfyUI rejected prompt: ${execution_response.error.message || execution_response.error.type}`);
    }

    const prompt_execution_id = execution_response.prompt_id;
    let is_execution_completed = false;
    let polling_loop_limit_counter = 0;

    // WHAT: Polling the ComfyUI server history queue every 2 seconds to check if our prompt execution has completed.
    // WHY: ComfyUI processing is asynchronous; we must wait until the voice generation and file saving finish before we try to refresh models.
    while (!is_execution_completed && polling_loop_limit_counter < 60) {
      // WHAT: Introducing a 2-second sleep duration between each polling request.
      // WHY: Avoids flooding the local server with excessive API requests in a tight loop.
      await new Promise((resolve_wait_timeout_promise) => {
        setTimeout(resolve_wait_timeout_promise, 2000);
      });
      
      // WHAT: Querying ComfyUI queue history to see if our generated voice is registered as done.
      // WHY: When our prompt ID is present in the history records, we know the generation is complete.
      const queue_history = await fetch_comfyui_queue_history(comfyui_api_url_address, prompt_execution_id);
      
      // WHAT: Checking if our specific prompt execution ID exists in the retrieved ComfyUI history list.
      // WHY: If it exists, the file has been successfully written to disk.
      if (queue_history && queue_history[prompt_execution_id]) {
        is_execution_completed = true;
      }
      polling_loop_limit_counter++;
    }

    // WHAT: Checking if the polling limit was reached without the custom voice being saved.
    // WHY: If the loop finishes without confirming success, we abort and report a timeout error.
    if (!is_execution_completed) {
      throw new Error("ComfyUI timed out while saving custom voice.");
    }

    // WHAT: Programmatically calling the ComfyUI reload route to refresh the backend model registry.
    // WHY: Registers the newly created voice file in the list of options without requiring a manual ComfyUI server reboot.
    await refresh_comfyui_models(comfyui_api_url_address);

    return { success: true, saved_filename: target_filename };
  } catch (voice_saving_execution_error) {
    // WHAT: Catching and logging any exceptions that occur during the voice saving execution.
    // WHY: Ensures the main process doesn't crash, and reports a clean failure message to the frontend UI.
    console.error("Save custom voice failed:", voice_saving_execution_error);
    return { success: false, error: voice_saving_execution_error.message };
  }
});

// =========================================================================
// AI AUDIOBOOK SCREENPLAY GENERATOR & SYNTHESIZER - MAIN PROCESS
// =========================================================================
// WHAT: Electron root orchestrator. Manages application window lifecycle,
//       registers privileged media streaming protocols (peaksaudio://), and delegates
//       IPC domains to modular service handlers.
// WHY: Decomposed from a monolithic architecture into specialized service modules:
//      - services/workspace_service.js: Project lifecycle, file dialogs, context menus
//      - services/audio_ffmpeg_service.js: Native timeline stitching, metadata, peaks markers
//      - services/laya_clm_service.js: Sub-25ms fast attribution, CLM System One, QC calibration
//      - services/ai_pipeline_service.js: LLM extraction, screenplay formatting, style merging
//      - services/audio_queue_service.js: Sequential ComfyUI queue, voice cloning, anchor baking
//      - services/auk_postprod_service.js: AuK audio editing suite (whisper, pitch, denoise)
//      - services/service_health_service.js: On-demand AI server lifecycle & VRAM arbitration

const { app, BrowserWindow, ipcMain, protocol } = require("electron");
const path_library = require("path");
const filesystem_library = require("fs");

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

// WHAT: Importing service registrars.
const { register_workspace_handlers } = require("./services/workspace_service");
const { register_audio_ffmpeg_handlers } = require("./services/audio_ffmpeg_service");
const { register_laya_clm_handlers } = require("./services/laya_clm_service");
const { register_ai_pipeline_handlers, detect_unmarked_spans, detect_unmarked_spans_joint } = require("./services/ai_pipeline_service");
const { register_audio_queue_handlers } = require("./services/audio_queue_service");
const { register_auk_postprod_handlers } = require("./services/auk_postprod_service");

// WHAT: Primary desktop window reference.
let primary_application_window = null;

function get_primary_window() {
  return primary_application_window;
}

// WHAT: Creating the main desktop application window.
// WHY: This initiates the visual environment for the user, pointing to index.html in the renderer.
function create_primary_desktop_window() {
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

  primary_application_window.loadFile(path_library.join(__dirname, "renderer", "index.html"));

  primary_application_window.on("closed", () => {
    primary_application_window = null;
  });
}

// WHAT: Handling application boot lifecycle.
app.whenReady().then(() => {
  // WHAT: Registering the peaksaudio:// protocol handler to serve local audio files to the renderer.
  // WHY: Peaks.js in the sandboxed renderer uses fetch() to download audio data for waveform decoding.
  protocol.handle("peaksaudio", (incoming_protocol_request) => {
    const requested_url_object = new URL(incoming_protocol_request.url);
    let decoded_file_system_path = decodeURIComponent(requested_url_object.pathname);

    if (process.platform === "win32" && requested_url_object.hostname && requested_url_object.hostname.length === 1) {
      decoded_file_system_path = `${requested_url_object.hostname}:${decoded_file_system_path}`;
    }

    if (process.platform === "win32" && decoded_file_system_path.startsWith("/")) {
      decoded_file_system_path = decoded_file_system_path.substring(1);
    }

    if (!filesystem_library.existsSync(decoded_file_system_path)) {
      return new Response("Audio file not found on disk.", { status: 404 });
    }

    const file_extension_lowercase = path_library.extname(decoded_file_system_path).toLowerCase();
    const mime_type_lookup_table = {
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".flac": "audio/flac",
      ".m4a": "audio/mp4"
    };
    const resolved_content_type_string = mime_type_lookup_table[file_extension_lowercase] || "application/octet-stream";

    const audio_file_raw_buffer = filesystem_library.readFileSync(decoded_file_system_path);
    return new Response(audio_file_raw_buffer, {
      status: 200,
      headers: {
        "Content-Type": resolved_content_type_string,
        "Content-Length": String(audio_file_raw_buffer.length)
      }
    });
  });

  // WHAT: Registering modular IPC handlers across all domain services.
  register_workspace_handlers(ipcMain, get_primary_window);
  register_audio_ffmpeg_handlers(ipcMain);
  register_laya_clm_handlers(ipcMain, () => detect_unmarked_spans, () => detect_unmarked_spans_joint);
  register_ai_pipeline_handlers(ipcMain, get_primary_window);
  register_audio_queue_handlers(ipcMain, get_primary_window);
  register_auk_postprod_handlers(ipcMain);

  create_primary_desktop_window();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      create_primary_desktop_window();
    }
  });
});

// WHAT: Handling standard application close events across all platforms.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

module.exports = {
  create_primary_desktop_window,
  get_primary_window
};

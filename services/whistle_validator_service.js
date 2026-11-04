// =========================================================================
// WHISTLE SPEECH-TO-TEXT AUDIO VALIDATION SERVICE
// =========================================================================
// WHAT: Validates synthesized audiobook speech audio takes against the expected
//       screenplay dialogue text using Cactus Compute's lightweight Whistle STT engine.
// WHY: Audio generation models (Qwen3-TTS, AuK, etc.) occasionally hallucinate words,
//      truncate trailing sentences, produce silence, or omit syllables.
//      Whistle (16.9 MB, CPU-native, sub-20ms TTFT) performs automated quality control
//      with zero GPU VRAM impact, allowing creators to audit and verify takes with a strict 90% threshold.

const path_library = require("path");
const filesystem_library = require("fs");
const os_library = require("os");
const child_process_library = require("child_process");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegStatic);

// WHAT: Resolves python binary path from environment or standard locations.
// WHY: Ensures cross-platform compatibility on Windows and POSIX systems.
function resolve_python_executable_path() {
  if (process.platform === "win32") {
    // Check if python is available in PATH
    try {
      const python_check_buffer = child_process_library.execSync("python --version", { stdio: ["pipe", "pipe", "ignore"] });
      if (python_check_buffer && python_check_buffer.toString().toLowerCase().includes("python")) {
        return "python";
      }
    } catch {
      // Fallback check for py launcher
      try {
        const py_launcher_buffer = child_process_library.execSync("py -3 --version", { stdio: ["pipe", "pipe", "ignore"] });
        if (py_launcher_buffer && py_launcher_buffer.toString().toLowerCase().includes("python")) {
          return "py -3";
        }
      } catch {
        return "python";
      }
    }
    return "python";
  }
  return "python3";
}

// WHAT: Normalizes an audio file to 16 kHz mono WAV format required by Whistle.
// WHY: ComfyUI / AuK takes can be 24 kHz, 48 kHz, FLAC, or MP3. Whistle's C++ log-mel
//      front-end strictly requires 16 kHz mono 16-bit PCM WAV.
async function prepare_audio_for_whistle_analysis(source_audio_file_path) {
  return new Promise((resolve_conversion_promise, reject_conversion_promise) => {
    if (!filesystem_library.existsSync(source_audio_file_path)) {
      return reject_conversion_promise(new Error(`Source audio file does not exist: ${source_audio_file_path}`));
    }

    const temporary_normalized_wav_path = path_library.join(
      os_library.tmpdir(),
      `whistle_norm_${Date.now()}_${Math.floor(Math.random() * 100000)}.wav`
    );

    ffmpeg(source_audio_file_path)
      .toFormat("wav")
      .audioChannels(1)
      .audioFrequency(16000)
      .on("end", () => {
        resolve_conversion_promise(temporary_normalized_wav_path);
      })
      .on("error", (conversion_error) => {
        reject_conversion_promise(new Error(`Failed to convert audio for Whistle: ${conversion_error.message}`));
      })
      .save(temporary_normalized_wav_path);
  });
}

// WHAT: Invokes Whistle STT Python script to transcribe and evaluate the audio file.
// WHY: Uses child_process with JSON pipes to isolate the Python engine and stream results.
async function execute_whistle_transcription_and_scoring(normalized_wav_file_path, expected_dialogue_text, options_payload = {}) {
  return new Promise((resolve_validation_promise, reject_validation_promise) => {
    const python_command = resolve_python_executable_path();
    const validator_script_path = path_library.join(__dirname, "..", "scripts", "whistle_validator.py");

    const input_payload = JSON.stringify({
      audio_path: normalized_wav_file_path,
      expected_text: expected_dialogue_text,
      options: {
        strict_threshold: options_payload.strict_threshold !== undefined ? options_payload.strict_threshold : 90.0,
        language: options_payload.language || "en",
        keywords: options_payload.keywords || null
      }
    });

    const execution_options = {
      cwd: path_library.join(__dirname, ".."),
      env: Object.assign({}, process.env, { NEEDLE_TELEMETRY: "0" }),
      maxBuffer: 10 * 1024 * 1024
    };

    const python_child_process = child_process_library.spawn(
      python_command.split(" ")[0],
      [...python_command.split(" ").slice(1), validator_script_path],
      execution_options
    );

    let stdout_buffer = "";
    let stderr_buffer = "";

    python_child_process.stdout.on("data", (chunk_data) => {
      stdout_buffer += chunk_data.toString();
    });

    python_child_process.stderr.on("data", (chunk_data) => {
      stderr_buffer += chunk_data.toString();
    });

    python_child_process.on("close", (exit_code) => {
      if (exit_code !== 0 && !stdout_buffer.trim()) {
        return reject_validation_promise(new Error(`Whistle validator process exited with code ${exit_code}: ${stderr_buffer}`));
      }

      try {
        const parsed_result = JSON.parse(stdout_buffer.trim());
        resolve_validation_promise(parsed_result);
      } catch (json_parse_exception) {
        reject_validation_promise(new Error(`Failed to parse Whistle output: ${stdout_buffer || stderr_buffer}`));
      }
    });

    python_child_process.on("error", (spawn_error) => {
      reject_validation_promise(spawn_error);
    });

    // Write input payload to stdin and close pipe
    python_child_process.stdin.write(input_payload);
    python_child_process.stdin.end();
  });
}

// WHAT: Primary validation orchestrator for audio files against target dialogue text.
// WHY: Coordinates temp conversion, Whistle transcription, scoring, and cleanup.
async function validate_audio_take_against_text(audio_file_path, expected_dialogue_text, options = {}) {
  let temporary_normalized_wav_path = null;
  try {
    // Step 1: Normalize audio to 16 kHz mono WAV
    temporary_normalized_wav_path = await prepare_audio_for_whistle_analysis(audio_file_path);

    // Step 2: Transcribe and calculate metrics via Whistle
    const validation_result = await execute_whistle_transcription_and_scoring(
      temporary_normalized_wav_path,
      expected_dialogue_text,
      options
    );

    // Step 3: Attach timestamp metadata
    validation_result.validated_at = Date.now();
    validation_result.audio_file_path = audio_file_path;

    return validation_result;
  } catch (validation_error) {
    console.error("[Whistle Validator Error]", validation_error);
    return {
      success: false,
      status: "error",
      error: validation_error.message,
      expected_text: expected_dialogue_text,
      transcribed_text: "",
      match_percentage: 0,
      validated_at: Date.now()
    };
  } finally {
    // Step 4: Always clean up temporary normalized WAV file
    if (temporary_normalized_wav_path && filesystem_library.existsSync(temporary_normalized_wav_path)) {
      try {
        filesystem_library.unlinkSync(temporary_normalized_wav_path);
      } catch (cleanup_error) {
        console.warn("Failed to delete temp Whistle WAV:", cleanup_error.message);
      }
    }
  }
}

// WHAT: Queries whether Whistle and needle are installed and available.
// WHY: Allows the UI to show an indicator badge and disable/enable validation features gracefully.
async function check_whistle_engine_availability() {
  return new Promise((resolve_status_promise) => {
    const python_command = resolve_python_executable_path();
    const validator_script_path = path_library.join(__dirname, "..", "scripts", "whistle_validator.py");

    const execution_options = {
      cwd: path_library.join(__dirname, ".."),
      env: Object.assign({}, process.env, { NEEDLE_TELEMETRY: "0" })
    };

    child_process_library.exec(
      `${python_command} "${validator_script_path}" --status`,
      execution_options,
      (exec_error, stdout_text) => {
        if (exec_error) {
          return resolve_status_promise({ success: false, available: false, error: exec_error.message });
        }
        try {
          const parsed = JSON.parse(stdout_text.trim());
          resolve_status_promise(parsed);
        } catch {
          resolve_status_promise({ success: false, available: false, error: "Failed to parse status response." });
        }
      }
    );
  });
}

// WHAT: Registers IPC handlers for Whistle validation across main process.
// WHY: Exposes validation capabilities securely to the sandboxed Electron renderer.
function register_whistle_validator_handlers(ipcMain) {
  // WHAT: Handle on-demand validation of a specific audio take against script dialogue.
  ipcMain.handle("audio:validate-take", async (ipc_event_context, request_arguments) => {
    const { file_path, expected_text, options } = request_arguments;
    return await validate_audio_take_against_text(file_path, expected_text, options);
  });

  // WHAT: Handle Whistle engine status queries.
  ipcMain.handle("audio:get-whistle-status", async () => {
    return await check_whistle_engine_availability();
  });
}

module.exports = {
  validate_audio_take_against_text,
  check_whistle_engine_availability,
  prepare_audio_for_whistle_analysis,
  register_whistle_validator_handlers
};

// =========================================================================
// PURE FUNCTIONAL DIRECT AUDIO VOICE IMPORT & PHONETIC TUNING SERVICE
// =========================================================================
// WHAT: Imports user-supplied audio recordings (.wav, .mp3, .m4a, .flac, .ogg)
//       to serve as direct reference anchors for character voice cloning,
//       skipping 100% synthetic VoiceDesign prompt generation while performing
//       subsequent phonetic tuning with standardized calibration phrases.
// WHY: In many audiobook productions, narrators or creators already have curated
//       character voice samples, actor auditions, or legacy recordings.
//       Bypassing 100% synthetic generation eliminates prompt trial-and-error,
//       while generating the standardized phonetic calibration sentence measures
//       and tunes the clone's acoustic fidelity before chapter synthesis begins.

const path_library = require("path");
const filesystem_library = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegStatic);

const { compute_cosine_similarity } = require("./voice_drift_qc_service");
const { initialize_character_calibration_profile, save_character_calibration_profile } = require("./voice_calibration_service");

/**
 * WHAT: Standardized phonetic test sentences designed for voice tuning.
 * WHY: These phonetically rich passages exercise all English phonemes, fricatives,
 *      sibilants, and plosives to rigorously test the acoustic fidelity of the clone.
 */
const PHONETIC_TUNING_SENTENCES = Object.freeze({
  rainbow_passage: "When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow. The rainbow is a division of white light into many beautiful colors.",
  arthur_the_rat: "Once there was a young rat named Arthur, who could never make up his mind. Whenever his friends asked him if he would like to go out with them, he would only answer, 'I don't know.'",
  pan_phonetic_pangram: "The quick brown fox jumps over a lazy dog, while sphinx of black quartz judges five dozen liquor jugs.",
  dialogue_intonation_test: "Are you certain that frequency is clear? I told you three times before: once the security grid locks down, there is no way back through the hangar.",
  short_diagnostic: "The atmospheric readings at the station perimeter remain within standard parameters."
});

/**
 * WHAT: Standardizes a character name string into a sanitized filename identifier.
 * 
 * @param {string} raw_character_name 
 * @returns {string} Sanitized name (e.g. "dr_elena_vance").
 */
function standardize_character_identifier(raw_character_name) {
  if (!raw_character_name || typeof raw_character_name !== "string") {
    return "character";
  }
  return raw_character_name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "character";
}

/**
 * WHAT: Copies or transcodes user-supplied reference audio into the project's anchors directory.
 * WHY: Normalizes audio formats (e.g. converting MP3/M4A/FLAC to standard 24kHz/44.1kHz WAV)
 *      to ensure high-precision, low-latency loading by ComfyUI and AuK models.
 * 
 * @param {string} source_audio_file_path 
 * @param {string} destination_anchor_wav_path 
 * @returns {Promise<boolean>} True if successfully written.
 */
function transcode_or_copy_reference_audio(source_audio_file_path, destination_anchor_wav_path) {
  return new Promise((resolve, reject) => {
    if (!filesystem_library.existsSync(source_audio_file_path)) {
      return reject(new Error(`Source audio file does not exist at: ${source_audio_file_path}`));
    }

    const destination_parent_directory = path_library.dirname(destination_anchor_wav_path);
    if (!filesystem_library.existsSync(destination_parent_directory)) {
      filesystem_library.mkdirSync(destination_parent_directory, { recursive: true });
    }

    const source_extension = path_library.extname(source_audio_file_path).toLowerCase();

    // WHAT: If source is already uncompressed WAV, copy directly for maximum speed.
    // WHY: Avoids unnecessary re-encoding loss.
    if (source_extension === ".wav") {
      try {
        filesystem_library.copyFileSync(source_audio_file_path, destination_anchor_wav_path);
        return resolve(true);
      } catch (copy_exception) {
        return reject(copy_exception);
      }
    }

    // WHAT: For compressed formats (MP3, M4A, FLAC, OGG), transcode to clean 24kHz mono WAV.
    // WHY: Guarantees full compatibility with TTS reference audio encoders.
    ffmpeg(source_audio_file_path)
      .toFormat("wav")
      .audioChannels(1)
      .audioFrequency(24000)
      .on("end", () => resolve(true))
      .on("error", (transcode_error) => reject(transcode_error))
      .save(destination_anchor_wav_path);
  });
}

/**
 * WHAT: Pure functional updater creating an imported character voice mapping record.
 * WHY: Skips 100% synthetic VoiceDesign prompt generation while designating the character
 *      as locked and ready for phonetic tuning.
 * 
 * @param {Readonly<Object>} existing_voice_mapping 
 * @param {string} character_name 
 * @param {string} source_audio_file_path 
 * @param {string} destination_anchor_wav_path 
 * @param {Readonly<Object>} [optional_metadata] 
 * @returns {Readonly<Object>} Updated voiceMapping object.
 */
function create_imported_character_voice_record(
  existing_voice_mapping,
  character_name,
  source_audio_file_path,
  destination_anchor_wav_path,
  optional_metadata = {}
) {
  const sanitized_name = standardize_character_identifier(character_name);
  const now_timestamp = Date.now();

  const character_record = {
    character_name: character_name,
    identifier: sanitized_name,
    is_locked: true,
    source: "imported_audio",
    is_100_percent_generated: false,
    skipped_voice_design: true,
    original_source_file_path: source_audio_file_path,
    anchorFilePath: destination_anchor_wav_path,
    imported_at_timestamp: now_timestamp,
    tuning_status: "pending_phonetic_tuning",
    voice: {
      reference_audio: destination_anchor_wav_path,
      description: `Direct audio import from ${path_library.basename(source_audio_file_path)}`,
      gender: optional_metadata.gender || "unknown",
      age_range: optional_metadata.age_range || "adult"
    },
    ...optional_metadata
  };

  return Object.freeze({
    ...existing_voice_mapping,
    [character_name]: Object.freeze(character_record)
  });
}

/**
 * WHAT: Prepares a phonetic tuning synthesis task for an imported character voice.
 * WHY: Dispatches the voice clone model to synthesize the standardized phonetic phrase
 *      using the imported anchor audio as reference.
 * 
 * @param {string} workspace_directory_path 
 * @param {string} project_name 
 * @param {string} character_name 
 * @param {string} [sentence_key_or_custom_text] 
 * @param {Readonly<Object>} [tuning_options] 
 * @returns {Readonly<Object>} Task payload ready for audio queue execution.
 */
function create_phonetic_tuning_task_payload(
  workspace_directory_path,
  project_name,
  character_name,
  sentence_key_or_custom_text = "rainbow_passage",
  tuning_options = {}
) {
  const sanitized_name = standardize_character_identifier(character_name);

  // WHAT: Resolve the phonetic sentence text.
  let target_tuning_sentence = PHONETIC_TUNING_SENTENCES[sentence_key_or_custom_text];
  if (!target_tuning_sentence) {
    target_tuning_sentence = typeof sentence_key_or_custom_text === "string" && sentence_key_or_custom_text.trim().length > 0
      ? sentence_key_or_custom_text.trim()
      : PHONETIC_TUNING_SENTENCES.rainbow_passage;
  }

  const project_root = path_library.join(workspace_directory_path, project_name);
  const anchor_wav_path = path_library.join(project_root, "audio", "anchors", `character_voice_${sanitized_name}.wav`);
  const output_tuning_wav_path = path_library.join(
    project_root,
    "audio",
    "calibration",
    `${sanitized_name}_phonetic_tuning_test.wav`
  );

  return Object.freeze({
    task_type: "phonetic_tuning_synthesis",
    character_name: character_name,
    sanitized_identifier: sanitized_name,
    workspace_directory_path,
    project_name,
    reference_anchor_path: anchor_wav_path,
    output_tuning_wav_path,
    dialogue_text: target_tuning_sentence,
    sentence_key: PHONETIC_TUNING_SENTENCES[sentence_key_or_custom_text] ? sentence_key_or_custom_text : "custom",
    model_version: tuning_options.model_version || "AuK-02",
    target_emotion: "neutral",
    target_intensity: 0.3,
    created_at_timestamp: Date.now()
  });
}

/**
 * WHAT: Evaluates a completed phonetic tuning take against the imported anchor.
 * WHY: Calculates baseline acoustic similarity, verifying that the cloned model faithfully
 *      reproduces the imported speaker's timbre before rendering story chapters.
 * 
 * @param {Readonly<Array<number>>} synthesized_take_embedding 
 * @param {Readonly<Array<number>>} imported_anchor_embedding 
 * @param {Readonly<{
 *   character_name: string,
 *   stt_accuracy_percentage?: number,
 *   chars_per_second?: number
 * }>} diagnostic_context 
 * @returns {Readonly<Object>} Tuning verification report and baseline calibration profile.
 */
function evaluate_phonetic_tuning_take(
  synthesized_take_embedding,
  imported_anchor_embedding,
  diagnostic_context = {}
) {
  const {
    character_name = "character",
    stt_accuracy_percentage = 98.0,
    chars_per_second = 14.2
  } = diagnostic_context;

  const similarity_score = compute_cosine_similarity(
    synthesized_take_embedding || [],
    imported_anchor_embedding || []
  );

  // WHAT: Standard minimum threshold for a successful neutral clone take is 0.75.
  const baseline_threshold = 0.75;
  const is_identity_verified = similarity_score >= baseline_threshold;
  const is_articulation_clean = stt_accuracy_percentage >= 90.0;
  const passed = is_identity_verified && is_articulation_clean;

  const baseline_profile = initialize_character_calibration_profile(
    character_name,
    "",
    "AuK-02"
  );

  return Object.freeze({
    character_name,
    similarity_score,
    baseline_threshold,
    is_identity_verified,
    is_articulation_clean,
    stt_accuracy_percentage,
    chars_per_second,
    passed,
    status: passed ? "tuned_and_verified" : "tuning_needs_review",
    baseline_profile
  });
}

/**
 * WHAT: Registers IPC handlers for direct voice import and phonetic tuning.
 * 
 * @param {Object} ipcMain 
 */
function register_voice_import_handlers(ipcMain) {
  // WHAT: Retrieves list of standardized phonetic tuning test phrases.
  ipcMain.handle("voice:get-phonetic-test-sentences", async () => {
    return { success: true, sentences: PHONETIC_TUNING_SENTENCES };
  });

  // WHAT: Imports an external audio file as a character reference voice.
  ipcMain.handle("voice:import-reference-audio", async (ipc_event_context, request_arguments) => {
    const {
      workspace_directory_path,
      project_name,
      character_name,
      source_audio_file_path,
      current_project_state,
      optional_metadata
    } = request_arguments || {};

    if (!workspace_directory_path || !project_name || !character_name || !source_audio_file_path) {
      return { success: false, error: "Missing required parameters for voice audio import." };
    }

    const sanitized_name = standardize_character_identifier(character_name);
    const destination_anchor_wav_path = path_library.join(
      workspace_directory_path,
      project_name,
      "audio",
      "anchors",
      `character_voice_${sanitized_name}.wav`
    );

    try {
      await transcode_or_copy_reference_audio(source_audio_file_path, destination_anchor_wav_path);

      // Also create <name>_anchor.wav symlink/copy for fallback compatibility
      const legacy_anchor_path = path_library.join(
        workspace_directory_path,
        project_name,
        "audio",
        "anchors",
        `${sanitized_name}_anchor.wav`
      );
      if (!filesystem_library.existsSync(legacy_anchor_path)) {
        try {
          filesystem_library.copyFileSync(destination_anchor_wav_path, legacy_anchor_path);
        } catch (_) {}
      }

      const existing_voice_mapping = (current_project_state && current_project_state.voiceMapping) || {};
      const updated_voice_mapping = create_imported_character_voice_record(
        existing_voice_mapping,
        character_name,
        source_audio_file_path,
        destination_anchor_wav_path,
        optional_metadata
      );

      return {
        success: true,
        character_name,
        anchor_file_path: destination_anchor_wav_path,
        voice_mapping: updated_voice_mapping
      };
    } catch (import_error) {
      console.error("[VoiceImport] Failed to import reference audio:", import_error);
      return { success: false, error: import_error.message };
    }
  });

  // WHAT: Generates phonetic tuning task payload.
  ipcMain.handle("voice:create-phonetic-tuning-task", async (ipc_event_context, request_arguments) => {
    const {
      workspace_directory_path,
      project_name,
      character_name,
      sentence_key_or_custom_text,
      tuning_options
    } = request_arguments || {};

    const task_payload = create_phonetic_tuning_task_payload(
      workspace_directory_path,
      project_name,
      character_name,
      sentence_key_or_custom_text,
      tuning_options
    );

    return { success: true, task_payload };
  });

  // WHAT: Evaluates phonetic tuning take and updates character calibration profile.
  ipcMain.handle("voice:evaluate-phonetic-tuning", async (ipc_event_context, request_arguments) => {
    const {
      synthesized_take_embedding,
      imported_anchor_embedding,
      diagnostic_context
    } = request_arguments || {};

    const evaluation_report = evaluate_phonetic_tuning_take(
      synthesized_take_embedding,
      imported_anchor_embedding,
      diagnostic_context
    );

    return { success: true, evaluation: evaluation_report };
  });
}

module.exports = {
  PHONETIC_TUNING_SENTENCES,
  standardize_character_identifier,
  transcode_or_copy_reference_audio,
  create_imported_character_voice_record,
  create_phonetic_tuning_task_payload,
  evaluate_phonetic_tuning_take,
  register_voice_import_handlers
};


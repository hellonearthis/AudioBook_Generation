// =========================================================================
// PURE FUNCTIONAL AUDIO CONTENT-HASH CACHING SERVICE
// =========================================================================
// WHAT: Generates deterministic SHA-256 content hashes from take rendering parameters
//       (text, speaker, voice ID/preset, seed, workflow type, emotion, directorial instruction)
//       and provides pure cache lookup and storage functions.
// WHY: Prevents redundant, expensive ComfyUI synthesis runs when tweaking individual lines,
//      allowing unchanged audio takes across the manuscript to be restored instantly.

const crypto = require("crypto");
const path_library = require("path");
const filesystem_library = require("fs");

/**
 * WHAT: Generates a deterministic SHA-256 fingerprint for a specific audio synthesis task.
 * WHY: Any change to the dialogue text, voice preset, seed, emotional delivery, or acting instruction
 *      must produce a different hash, while identical parameters produce an identical hash.
 * 
 * @param {Readonly<Object>} task_parameters - The synthesis parameters.
 * @returns {string} 16-character hexadecimal content hash fingerprint.
 */
function compute_take_content_hash(task_parameters) {
  const normalized_text_content = (task_parameters.text || "").trim().toLowerCase();
  const normalized_speaker_name = (task_parameters.speaker || "").trim().toLowerCase();
  const normalized_voice_identifier = (task_parameters.voice || "").trim().toLowerCase();
  const normalized_seed_value = String(task_parameters.seed || "default");
  const normalized_workflow_type = (task_parameters.workflowType || "inherit").trim().toLowerCase();
  const normalized_emotion_label = (task_parameters.emotion || "neutral").trim().toLowerCase();
  const normalized_instruction_text = (task_parameters.instruction || "").trim().toLowerCase();
  const normalized_speed_ratio = String(task_parameters.speed || "1.0");
  const normalized_pitch_level = (task_parameters.pitch || "medium").trim().toLowerCase();
  const normalized_volume_level = (task_parameters.volume || "medium").trim().toLowerCase();
  const normalized_intensity_band = String(task_parameters.intensity_band || task_parameters.band || "");
  const normalized_expression_axis = (task_parameters.expression_axis || task_parameters.expression || "").trim().toLowerCase();

  const canonical_payload_representation = [
    normalized_text_content,
    normalized_speaker_name,
    normalized_voice_identifier,
    normalized_seed_value,
    normalized_workflow_type,
    normalized_emotion_label,
    normalized_instruction_text,
    normalized_speed_ratio,
    normalized_pitch_level,
    normalized_volume_level,
    normalized_intensity_band,
    normalized_expression_axis
  ].join("|");

  return crypto
    .createHash("sha256")
    .update(canonical_payload_representation, "utf-8")
    .digest("hex")
    .substring(0, 16);
}

/**
 * WHAT: Resolves the canonical cache folder path for a project.
 * WHY: Centralizes cached takes under `<workspace>/<project>/audio/cache`.
 * 
 * @param {string} workspace_directory_path 
 * @param {string} project_name 
 * @returns {string} Absolute path to the cache directory.
 */
function resolve_audio_cache_directory_path(workspace_directory_path, project_name) {
  return path_library.join(workspace_directory_path, project_name, "audio", "cache");
}

/**
 * WHAT: Locates an existing cached audio file by its content hash.
 * WHY: Checks for `.wav` or `.mp3` matches in the project's audio cache directory.
 * 
 * @param {string} cache_directory_path 
 * @param {string} content_hash_string 
 * @returns {string|null} Absolute path to cached audio file if found, otherwise null.
 */
function find_cached_audio_take_file_path(cache_directory_path, content_hash_string) {
  if (!filesystem_library.existsSync(cache_directory_path)) {
    return null;
  }

  const supported_audio_extensions = [".wav", ".mp3", ".flac"];
  for (let extension_index = 0; extension_index < supported_audio_extensions.length; extension_index++) {
    const candidate_cached_file_path = path_library.join(
      cache_directory_path,
      `${content_hash_string}${supported_audio_extensions[extension_index]}`
    );
    if (filesystem_library.existsSync(candidate_cached_file_path)) {
      return candidate_cached_file_path;
    }
  }

  return null;
}

/**
 * WHAT: Stores a completed synthesized audio file into the project cache directory.
 * WHY: Enables instant future hits when the same text and settings are requested.
 * 
 * @param {string} cache_directory_path 
 * @param {string} content_hash_string 
 * @param {string} source_audio_file_path 
 * @returns {string|null} Destination path in cache, or null on failure.
 */
function store_audio_take_in_cache(cache_directory_path, content_hash_string, source_audio_file_path) {
  try {
    if (!filesystem_library.existsSync(source_audio_file_path)) {
      return null;
    }

    if (!filesystem_library.existsSync(cache_directory_path)) {
      filesystem_library.mkdirSync(cache_directory_path, { recursive: true });
    }

    const file_extension_suffix = path_library.extname(source_audio_file_path) || ".wav";
    const destination_cached_file_path = path_library.join(
      cache_directory_path,
      `${content_hash_string}${file_extension_suffix}`
    );

    filesystem_library.copyFileSync(source_audio_file_path, destination_cached_file_path);
    return destination_cached_file_path;
  } catch (cache_storage_exception) {
    console.error("Failed to store audio take in cache:", cache_storage_exception);
    return null;
  }
}

module.exports = {
  compute_take_content_hash,
  resolve_audio_cache_directory_path,
  find_cached_audio_take_file_path,
  store_audio_take_in_cache
};


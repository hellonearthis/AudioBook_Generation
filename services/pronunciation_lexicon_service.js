// =========================================================================
// PURE FUNCTIONAL PRONUNCIATION LEXICON SERVICE
// =========================================================================
// WHAT: Maintains project-level pronunciation overrides and phonetic respellings
//       for fantasy names, rare words, acronyms, and technical jargon before dispatching to TTS.
// WHY: Prevents TTS mispronunciations (e.g. "Maren" sounding like "marine", or "CMBR"
//      being read as a jumbled word instead of phonetic expansion).

const path_library = require("path");
const filesystem_library = require("fs");

/**
 * WHAT: Validates and normalizes an individual pronunciation replacement entry.
 * WHY: Enforces consistent schema and sanitizes input strings to prevent regex corruption.
 * 
 * @param {Readonly<Object>} raw_lexicon_entry
 * @returns {Readonly<Object>|null} Normalized entry or null if invalid.
 */
function normalize_lexicon_entry(raw_lexicon_entry) {
  if (!raw_lexicon_entry || typeof raw_lexicon_entry !== "object") {
    return null;
  }

  const raw_target_word = (raw_lexicon_entry.target_word || raw_lexicon_entry.key || "").trim();
  const raw_replacement_text = (raw_lexicon_entry.replacement || raw_lexicon_entry.value || "").trim();

  if (raw_target_word.length === 0 || raw_replacement_text.length === 0) {
    return null;
  }

  const normalized_replacement_type = ["respelling", "phoneme", "expansion"].includes(raw_lexicon_entry.type)
    ? raw_lexicon_entry.type
    : "respelling";

  return {
    target_word: raw_target_word,
    replacement: raw_replacement_text,
    type: normalized_replacement_type,
    case_sensitive: Boolean(raw_lexicon_entry.case_sensitive),
    notes: (raw_lexicon_entry.notes || "").trim()
  };
}

/**
 * WHAT: Escapes special characters for safe inclusion inside a regular expression.
 * WHY: Avoids syntax errors or unintended wildcard matching when names contain punctuation.
 * 
 * @param {string} text_string 
 * @returns {string} Regex-escaped string.
 */
function escape_regular_expression_characters(text_string) {
  return text_string.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * WHAT: Pure functional text transformation applying a lexicon dictionary to a text passage.
 * WHY: Scans the target text, finds all whole-word and phrase occurrences of lexicon keys,
 *      and replaces them with phonetic respellings or expansions.
 * 
 * @param {string} original_text_passage - The raw script segment text.
 * @param {ReadonlyArray<Object>|Readonly<Record<string, any>>} lexicon_collection - Array of entries or key-value map.
 * @returns {{ readonly transformed_text: string, readonly applied_replacements_list: ReadonlyArray<Object> }}
 */
function apply_pronunciation_lexicon(original_text_passage, lexicon_collection) {
  if (!original_text_passage || typeof original_text_passage !== "string") {
    return {
      transformed_text: "",
      applied_replacements_list: []
    };
  }

  let normalized_entries_list = [];

  if (Array.isArray(lexicon_collection)) {
    normalized_entries_list = lexicon_collection
      .map(normalize_lexicon_entry)
      .filter(Boolean);
  } else if (lexicon_collection && typeof lexicon_collection === "object") {
    normalized_entries_list = Object.keys(lexicon_collection).map((key_string) => {
      const raw_value = lexicon_collection[key_string];
      if (typeof raw_value === "string") {
        return normalize_lexicon_entry({ target_word: key_string, replacement: raw_value });
      }
      return normalize_lexicon_entry({ target_word: key_string, ...raw_value });
    }).filter(Boolean);
  }

  if (normalized_entries_list.length === 0) {
    return {
      transformed_text: original_text_passage,
      applied_replacements_list: []
    };
  }

  let working_transformed_text = original_text_passage;
  const applied_replacements_list = [];

  // WHAT: Processing replacements in order of descending target word length.
  // WHY: Longer compound phrases (e.g., "Doctor John") must take precedence over single words ("Doctor").
  const sorted_entries_list = [...normalized_entries_list].sort(
    (entry_alpha, entry_beta) => entry_beta.target_word.length - entry_alpha.target_word.length
  );

  for (let entry_index = 0; entry_index < sorted_entries_list.length; entry_index++) {
    const current_entry = sorted_entries_list[entry_index];
    const escaped_target_pattern = escape_regular_expression_characters(current_entry.target_word);
    const regex_flags_string = current_entry.case_sensitive ? "g" : "gi";

    // WHAT: Using word boundaries if the target starts and ends with alphanumeric characters.
    // WHY: Prevents partial-word accidental replacements (e.g., replacing "the" inside "brother").
    const starts_with_word_char = /^\w/.test(current_entry.target_word);
    const ends_with_word_char = /\w$/.test(current_entry.target_word);
    const boundary_prefix = starts_with_word_char ? "\\b" : "";
    const boundary_suffix = ends_with_word_char ? "\\b" : "";

    const search_regular_expression = new RegExp(
      `${boundary_prefix}${escaped_target_pattern}${boundary_suffix}`,
      regex_flags_string
    );

    let match_count = 0;
    working_transformed_text = working_transformed_text.replace(search_regular_expression, (matched_substring) => {
      match_count += 1;
      return current_entry.replacement;
    });

    if (match_count > 0) {
      applied_replacements_list.push({
        target_word: current_entry.target_word,
        replacement: current_entry.replacement,
        type: current_entry.type,
        occurrences_replaced_count: match_count
      });
    }
  }

  return {
    transformed_text: working_transformed_text,
    applied_replacements_list
  };
}

/**
 * WHAT: Loads the persistent pronunciation lexicon from `<project>/lexicon.json`.
 * WHY: Preserves custom dictionary definitions across project editing sessions.
 * 
 * @param {string} project_root_directory_path 
 * @returns {Array<Object>} Loaded lexicon entries array.
 */
function load_project_lexicon_from_disk(project_root_directory_path) {
  const lexicon_file_storage_path = path_library.join(project_root_directory_path, "lexicon.json");
  if (!filesystem_library.existsSync(lexicon_file_storage_path)) {
    return [];
  }

  try {
    const serialized_lexicon_content = filesystem_library.readFileSync(lexicon_file_storage_path, "utf-8");
    const parsed_lexicon_payload = JSON.parse(serialized_lexicon_content);
    if (Array.isArray(parsed_lexicon_payload)) {
      return parsed_lexicon_payload.map(normalize_lexicon_entry).filter(Boolean);
    }
    if (parsed_lexicon_payload && Array.isArray(parsed_lexicon_payload.entries)) {
      return parsed_lexicon_payload.entries.map(normalize_lexicon_entry).filter(Boolean);
    }
    return [];
  } catch (file_read_exception) {
    console.error("Failed to load project lexicon from disk:", file_read_exception);
    return [];
  }
}

/**
 * WHAT: Saves the pronunciation lexicon into `<project>/lexicon.json`.
 * WHY: Persists user-defined vocabulary rules to disk.
 * 
 * @param {string} project_root_directory_path 
 * @param {Array<Object>} lexicon_entries_list 
 * @returns {boolean} True if saved successfully.
 */
function save_project_lexicon_to_disk(project_root_directory_path, lexicon_entries_list) {
  try {
    if (!filesystem_library.existsSync(project_root_directory_path)) {
      filesystem_library.mkdirSync(project_root_directory_path, { recursive: true });
    }

    const lexicon_file_storage_path = path_library.join(project_root_directory_path, "lexicon.json");
    const sanitized_entries_list = (Array.isArray(lexicon_entries_list) ? lexicon_entries_list : [])
      .map(normalize_lexicon_entry)
      .filter(Boolean);

    const serialized_payload = JSON.stringify(
      {
        version: "1.0.0",
        last_updated_timestamp: Date.now(),
        entries: sanitized_entries_list
      },
      null,
      2
    );

    filesystem_library.writeFileSync(lexicon_file_storage_path, serialized_payload, "utf-8");
    return true;
  } catch (file_write_exception) {
    console.error("Failed to save project lexicon to disk:", file_write_exception);
    return false;
  }
}

/**
 * WHAT: Common high-frequency English stopwords ignored during rare token discovery.
 */
const COMMON_ENGLISH_STOPWORDS_SET = new Set([
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "i",
  "it", "for", "not", "on", "with", "he", "as", "you", "do", "at",
  "this", "but", "his", "by", "from", "they", "we", "say", "her", "she",
  "or", "an", "will", "my", "one", "all", "would", "there", "their", "what",
  "so", "up", "out", "if", "about", "who", "get", "which", "go", "me",
  "when", "make", "can", "like", "time", "no", "just", "him", "know", "take",
  "people", "into", "year", "your", "good", "some", "could", "them", "see", "other",
  "than", "then", "now", "look", "only", "come", "its", "over", "think", "also"
]);

/**
 * WHAT: Scans manuscript text to identify rare capitalized tokens, acronyms, and proper nouns.
 * WHY: Auto-suggests candidates for the pronunciation lexicon before synthesis begins.
 * 
 * @param {string} raw_manuscript_text 
 * @param {Readonly<Object>} options 
 * @returns {ReadonlyArray<{ token: string, frequency: number, sample_context: string, is_acronym: boolean }>}
 */
function scan_manuscript_for_rare_tokens(raw_manuscript_text, options = {}) {
  if (!raw_manuscript_text || typeof raw_manuscript_text !== "string") {
    return [];
  }

  const minimum_occurrences = options.minimum_occurrences || 1;
  const token_frequency_map = new Map();
  const token_context_map = new Map();

  // WHAT: Matches capitalized words or acronyms.
  const token_regex = /\b([A-Z][a-zA-Z0-9'-]{1,30})\b/g;
  let match_result;

  while ((match_result = token_regex.exec(raw_manuscript_text)) !== null) {
    const candidate_token = match_result[1];
    const lowercase_candidate = candidate_token.toLowerCase();

    // Skip pure stopwords
    if (COMMON_ENGLISH_STOPWORDS_SET.has(lowercase_candidate)) {
      continue;
    }

    const current_count = token_frequency_map.get(candidate_token) || 0;
    token_frequency_map.set(candidate_token, current_count + 1);

    if (!token_context_map.has(candidate_token)) {
      const match_index = match_result.index;
      const context_start = Math.max(0, match_index - 30);
      const context_end = Math.min(raw_manuscript_text.length, match_index + candidate_token.length + 30);
      const excerpt = raw_manuscript_text.substring(context_start, context_end).replace(/\s+/g, " ").trim();
      token_context_map.set(candidate_token, `...${excerpt}...`);
    }
  }

  const discovered_tokens_list = [];
  for (const [token, frequency] of token_frequency_map.entries()) {
    if (frequency >= minimum_occurrences) {
      const is_acronym = /^[A-Z]{2,8}$/.test(token);
      discovered_tokens_list.push({
        token,
        frequency,
        sample_context: token_context_map.get(token) || "",
        is_acronym
      });
    }
  }

  // Sort descending by frequency
  return discovered_tokens_list.sort((a, b) => b.frequency - a.frequency);
}

/**
 * WHAT: Registers IPC handlers for pronunciation lexicon operations.
 * WHY: Allows the front-end to inspect, edit, save, and preview lexicon transformations.
 * 
 * @param {Object} ipcMain 
 */
function register_pronunciation_lexicon_handlers(ipcMain) {
  ipcMain.handle("lexicon:get-project-lexicon", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name } = request_arguments;
    const project_root_directory_path = path_library.join(workspace_directory_path, project_name);
    const loaded_lexicon_entries = load_project_lexicon_from_disk(project_root_directory_path);
    return { success: true, entries: loaded_lexicon_entries };
  });

  ipcMain.handle("lexicon:save-project-lexicon", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, entries } = request_arguments;
    const project_root_directory_path = path_library.join(workspace_directory_path, project_name);
    const save_success = save_project_lexicon_to_disk(project_root_directory_path, entries);
    return { success: save_success };
  });

  ipcMain.handle("lexicon:preview-replacements", async (ipc_event_context, request_arguments) => {
    const { text, entries } = request_arguments;
    const transformation_result = apply_pronunciation_lexicon(text, entries);
    return {
      success: true,
      original_text: text,
      transformed_text: transformation_result.transformed_text,
      applied_replacements: transformation_result.applied_replacements_list
    };
  });

  ipcMain.handle("lexicon:scan-manuscript-tokens", async (ipc_event_context, request_arguments) => {
    const { text, options } = request_arguments;
    const rare_tokens = scan_manuscript_for_rare_tokens(text, options);
    return { success: true, tokens: rare_tokens };
  });
}

module.exports = {
  normalize_lexicon_entry,
  escape_regular_expression_characters,
  apply_pronunciation_lexicon,
  load_project_lexicon_from_disk,
  save_project_lexicon_to_disk,
  scan_manuscript_for_rare_tokens,
  register_pronunciation_lexicon_handlers
};


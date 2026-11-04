// =========================================================================
// PURE FUNCTIONAL CHARACTER ALIAS & COREFERENCE RESOLUTION SERVICE
// =========================================================================
// WHAT: Maps nicknames, honorifics, surnames, and conversational aliases
//       (e.g., "Mare", "Ms. Hale", "the captain") to single canonical character identities.
// WHY: Nickname and coreference ambiguity is one of the most common causes of wrong
//      voice casting during LLM and rule-based attribution.

/**
 * WHAT: Standard English honorific titles stripped or mapped during alias resolution.
 */
const COMMON_HONORIFIC_PREFIXES = [
  "dr.", "dr", "doctor",
  "mr.", "mr", "mister",
  "mrs.", "mrs", "miss", "ms.", "ms",
  "captain", "capt.", "capt",
  "detective", "det.", "det",
  "sergeant", "sgt.", "sgt",
  "professor", "prof.", "prof",
  "lord", "lady", "sir", "madam"
];

/**
 * WHAT: Normalizes an alias string for insensitive lookup.
 * WHY: Eliminates punctuation variations and whitespace mismatches.
 * 
 * @param {string} raw_name_string 
 * @returns {string} Lowercase normalized name key.
 */
function normalize_alias_key(raw_name_string) {
  return (raw_name_string || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * WHAT: Builds an alias-to-canonical-name lookup dictionary from cast profiles.
 * WHY: Provides O(1) instantaneous resolution from any known nickname or title.
 * 
 * @param {ReadonlyArray<{ name: string, aliases?: ReadonlyArray<string> }>} cast_profiles_list 
 * @returns {Record<string, string>} Normalized alias lookup dictionary.
 */
function build_character_alias_index(cast_profiles_list) {
  if (!Array.isArray(cast_profiles_list) || cast_profiles_list.length === 0) {
    return {};
  }

  const alias_index = {};

  for (let cast_index = 0; cast_index < cast_profiles_list.length; cast_index++) {
    const character_profile = cast_profiles_list[cast_index];
    const canonical_name = (character_profile.name || "").trim();
    if (!canonical_name) continue;

    // Self mapping
    alias_index[normalize_alias_key(canonical_name)] = canonical_name;

    // First name and last name individual mappings if multi-word name
    const name_tokens = canonical_name.split(/\s+/).filter(Boolean);
    if (name_tokens.length > 1) {
      const first_name = name_tokens[0];
      const last_name = name_tokens[name_tokens.length - 1];
      alias_index[normalize_alias_key(first_name)] = canonical_name;
      alias_index[normalize_alias_key(last_name)] = canonical_name;
    }

    // Explicit declared aliases
    const declared_aliases = character_profile.aliases || character_profile.alternate_names || [];
    for (let alias_index_pos = 0; alias_index_pos < declared_aliases.length; alias_index_pos++) {
      const alias_string = declared_aliases[alias_index_pos];
      if (alias_string && typeof alias_string === "string") {
        alias_index[normalize_alias_key(alias_string)] = canonical_name;
      }
    }
  }

  return alias_index;
}

/**
 * WHAT: Resolves a candidate speaker string against the alias dictionary.
 * WHY: Translates "Mare" or "Ms. Hale" to "Maren" before attribution scoring.
 * 
 * @param {string} candidate_speaker_name 
 * @param {Readonly<Record<string, string>>} alias_index 
 * @returns {string} Resolved canonical character name or original string if unmapped.
 */
function resolve_speaker_alias(candidate_speaker_name, alias_index) {
  if (!candidate_speaker_name || typeof candidate_speaker_name !== "string") {
    return "unknown";
  }

  const raw_trimmed = candidate_speaker_name.trim();
  const normalized_key = normalize_alias_key(raw_trimmed);

  // Exact alias match
  if (alias_index[normalized_key]) {
    return alias_index[normalized_key];
  }

  // Strip common honorific prefix (e.g. "Doctor Robert" -> "Robert")
  for (let h_index = 0; h_index < COMMON_HONORIFIC_PREFIXES.length; h_index++) {
    const prefix = COMMON_HONORIFIC_PREFIXES[h_index];
    if (normalized_key.startsWith(`${prefix} `)) {
      const stripped_key = normalized_key.substring(prefix.length + 1).trim();
      if (alias_index[stripped_key]) {
        return alias_index[stripped_key];
      }
    }
  }

  return raw_trimmed;
}

/**
 * WHAT: Scans manuscript text to auto-discover potential nicknames or honorifics for cast members.
 * WHY: Helps the creator seed the alias dictionary automatically from text evidence.
 * 
 * @param {string} manuscript_prose_text 
 * @param {ReadonlyArray<string>} established_character_names 
 * @returns {ReadonlyArray<{ canonical_name: string, suggested_alias: string, occurrence_count: number }>}
 */
function discover_potential_character_aliases(manuscript_prose_text, established_character_names) {
  if (!manuscript_prose_text || !Array.isArray(established_character_names) || established_character_names.length === 0) {
    return [];
  }

  const discovered_suggestions = [];

  for (let char_index = 0; char_index < established_character_names.length; char_index++) {
    const canonical_name = established_character_names[char_index];
    const name_parts = canonical_name.split(/\s+/).filter(Boolean);

    // If character has a surname (e.g., "Maren Hale"), look for "Ms. Hale", "Mrs. Hale", "Doctor Hale", etc.
    if (name_parts.length > 1) {
      const surname = name_parts[name_parts.length - 1];
      for (let h_index = 0; h_index < COMMON_HONORIFIC_PREFIXES.length; h_index++) {
        const prefix = COMMON_HONORIFIC_PREFIXES[h_index];
        const search_pattern = new RegExp(`\\b${prefix}\\s+${surname}\\b`, "gi");
        const match_occurrences = (manuscript_prose_text.match(search_pattern) || []).length;
        if (match_occurrences > 0) {
          discovered_suggestions.push({
            canonical_name,
            suggested_alias: `${prefix.charAt(0).toUpperCase() + prefix.slice(1)} ${surname}`,
            occurrence_count: match_occurrences
          });
        }
      }
    }
  }

  return discovered_suggestions;
}

module.exports = {
  COMMON_HONORIFIC_PREFIXES,
  normalize_alias_key,
  build_character_alias_index,
  resolve_speaker_alias,
  discover_potential_character_aliases
};


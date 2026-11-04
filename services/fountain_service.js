"use strict";

// =========================================================================
// FOUNTAIN INTERMEDIATE SPECIFICATION ENGINE — CLEAN-ROOM IMPLEMENTATION
// =========================================================================
// WHAT: Bi-directional serializer and parser for the open Fountain screenplay
//       format (https://fountain.io/syntax), paired with Beat-inspired script
//       analytics, index card outlines, and revision-diff audio caching.
// WHY: Plain-text Fountain bridges the gap between raw prose, human proofreading
//       (in editors like Beat or VS Code), and AI speech synthesis (TTS).
//       Parentheticals map directly to delivery cues, scene headings provide
//       relational checkpoints, and stable line hashing enables surgical
//       re-rendering of only edited lines instead of whole chapters.
// NOTE: 100% clean-room implementation strictly adhering to the public Fountain 1.1
//       open specification. No code from external proprietary or GPL software.

const crypto = require("crypto");

// -------------------------------------------------------------------------
// CONSTANTS & REGEX DEFINITIONS (FOUNTAIN SPEC 1.1)
// -------------------------------------------------------------------------

// WHAT: Common scene heading prefixes according to Fountain specification.
// WHY: Identifies sluglines like INT., EXT., INT./EXT., I/E.
const FOUNTAIN_SCENE_PREFIXES_REGEX = /^(INT|EXT|INT\/EXT|INT\.\/EXT\.|I\/E)\b[\s.]/i;

// WHAT: Forced scene heading indicator (begins with a single period followed by non-period).
// WHY: Fountain allows any line starting with a dot to force a scene heading (e.g. ".CABIN - NIGHT").
const FOUNTAIN_FORCED_SCENE_REGEX = /^\.[a-zA-Z0-9]/;

// WHAT: Section header depth matches (#, ##, ###, etc.).
// WHY: Fountain uses Markdown-style hashes to denote Act, Chapter, and Scene outline tiers.
const FOUNTAIN_SECTION_REGEX = /^(#{1,6})\s*(.*)$/;

// WHAT: Synopsis line starting with an equals sign.
// WHY: Fountain synopses summarize the preceding or succeeding scene without rendering in script.
const FOUNTAIN_SYNOPSIS_REGEX = /^=\s*(.*)$/;

// WHAT: Character parenthetical delivery cue (enclosed in parentheses).
// WHY: Specifies performance, emotion, or acoustic instructions (e.g. "(whispering, clipped)").
const FOUNTAIN_PARENTHETICAL_REGEX = /^\((.*)\)$/;

// WHAT: Forced character indicator starting with an at-sign (@).
// WHY: Fountain allows character cues with mixed case or unusual punctuation via "@NAME".
const FOUNTAIN_FORCED_CHARACTER_REGEX = /^@([^\n]+)$/;

// WHAT: Boneyard comments (/* ... */) used for non-rendering metadata.
// WHY: Enables lossless storage of segment IDs, confidence scores, and relationship matrices.
const FOUNTAIN_BONEYARD_START_REGEX = /^\/\*/;
const FOUNTAIN_BONEYARD_END_REGEX = /\*\//;

// WHAT: Estimated speaking rate for audio runtime calculations.
// WHY: Standard audiobooks average 150 words per minute plus pauses between scene transitions.
const ESTIMATED_WORDS_PER_MINUTE = 150;
const ESTIMATED_PAUSE_SECONDS_PER_SPEAKER_SWITCH = 0.45;
const ESTIMATED_PAUSE_SECONDS_PER_SCENE_TRANSITION = 1.8;

// -------------------------------------------------------------------------
// LINE HASHING & REVISION IDENTIFIERS
// -------------------------------------------------------------------------

// WHAT: Computes a deterministic SHA-256 fingerprint for a script segment.
// WHY: Allows the audio engine to detect whether line text, delivery cues,
//      or voice mappings changed between revisions, preventing redundant TTS renders.
function compute_deterministic_segment_hash({
  speaker_name = "Narrator",
  delivery_direction = "",
  spoken_text = "",
  assigned_voice_id = "default",
  post_process_profile = "standard"
}) {
  const normalized_payload_string = [
    (speaker_name || "Narrator").trim().toLowerCase(),
    (delivery_direction || "").trim().toLowerCase(),
    (spoken_text || "").trim(),
    (assigned_voice_id || "default").trim(),
    (post_process_profile || "standard").trim()
  ].join("||");

  return crypto
    .createHash("sha256")
    .update(normalized_payload_string, "utf8")
    .digest("hex")
    .substring(0, 16);
}

// -------------------------------------------------------------------------
// FOUNTAIN SERIALIZER (SEGMENTS -> FOUNTAIN TEXT)
// -------------------------------------------------------------------------

// WHAT: Serializes script segments and book metadata into clean Fountain plain text.
// WHY: Produces standard .fountain documents that can be opened in Beat,
//      hand-edited by human directors, or archived under version control.
function serialize_segments_to_fountain(script_segments_list = [], options = {}) {
  const safe_segments_list = Array.isArray(script_segments_list) ? script_segments_list : [];
  const lines_output_buffer = [];

  const document_title = options.title || "Audiobook Screenplay";
  const document_author = options.author || "Unknown Author";
  const document_source = options.source || "Generated via AudioBooks Engine";
  const document_date = options.date || new Date().toISOString().split("T")[0];

  // 1. Title Page Header (Fountain Key-Value pairs)
  lines_output_buffer.push(`Title: ${document_title}`);
  if (options.credit) lines_output_buffer.push(`Credit: ${options.credit}`);
  lines_output_buffer.push(`Author: ${document_author}`);
  lines_output_buffer.push(`Source: ${document_source}`);
  lines_output_buffer.push(`Draft date: ${document_date}`);
  lines_output_buffer.push(""); // Title page boundary required by Fountain
  lines_output_buffer.push("=== "); // Separator between title page and body
  lines_output_buffer.push("");

  let current_open_scene_heading = null;

  for (let segment_index = 0; segment_index < safe_segments_list.length; segment_index++) {
    const current_segment = safe_segments_list[segment_index];
    if (!current_segment) continue;

    const segment_type = (current_segment.type || "narrator").toLowerCase();
    const segment_speaker = current_segment.speaker || (segment_type === "dialogue" ? "Character" : "Narrator");
    const segment_text = (current_segment.text || "").trim();
    const segment_direction = (current_segment.direction || "").trim();
    const segment_line_id = current_segment.id || current_segment.line_id || `line_${segment_index + 1}`;
    const segment_hash = current_segment.hash || compute_deterministic_segment_hash({
      speaker_name: segment_speaker,
      delivery_direction: segment_direction,
      spoken_text: segment_text,
      assigned_voice_id: current_segment.voice_id || current_segment.voice_model_id || "default"
    });

    // Handle structural section markers (Chapter / Part headers)
    if (current_segment.chapter_title && current_segment.is_chapter_start) {
      lines_output_buffer.push("");
      lines_output_buffer.push(`# ${current_segment.chapter_title}`);
      lines_output_buffer.push("");
    }

    // Handle scene headings & synopses
    if (current_segment.scene_heading && current_segment.scene_heading !== current_open_scene_heading) {
      current_open_scene_heading = current_segment.scene_heading;
      lines_output_buffer.push("");
      
      const formatted_slugline = FOUNTAIN_SCENE_PREFIXES_REGEX.test(current_open_scene_heading)
        ? current_open_scene_heading.toUpperCase()
        : `.${current_open_scene_heading.toUpperCase()}`;

      lines_output_buffer.push(formatted_slugline);

      if (current_segment.scene_synopsis) {
        lines_output_buffer.push(`= ${current_segment.scene_synopsis}`);
      }

      // If scene has an active relationship snapshot, serialize into boneyard comment
      if (current_segment.relationship_snapshot && Object.keys(current_segment.relationship_snapshot).length > 0) {
        lines_output_buffer.push(`/* [[relationship_snapshot: ${JSON.stringify(current_segment.relationship_snapshot)}]] */`);
      }
      lines_output_buffer.push("");
    }

    // Embed line-level metadata for lossless round-trip
    const line_metadata_object = {
      id: segment_line_id,
      hash: segment_hash
    };
    if (typeof current_segment.confidence === "number") {
      line_metadata_object.conf = Math.round(current_segment.confidence * 100) / 100;
    }
    if (current_segment.acoustic_cues) {
      line_metadata_object.acoustic = current_segment.acoustic_cues;
    }
    if (current_segment.audioPath) {
      line_metadata_object.audio = current_segment.audioPath;
    }

    if (segment_type === "dialogue") {
      // Fountain Dialogue Block: Character Cue -> Optional Parenthetical -> Spoken Line
      lines_output_buffer.push("");
      
      // Use forced character syntax @NAME to support spaces, accents, and mixed case names safely
      const clean_character_name = segment_speaker.trim();
      const needs_forced_character_cue = /[a-z]/.test(clean_character_name) || clean_character_name.includes(" ");
      const formatted_character_cue = needs_forced_character_cue
        ? `@${clean_character_name}`
        : clean_character_name.toUpperCase();

      lines_output_buffer.push(formatted_character_cue);

      // Parenthetical delivery cue
      if (segment_direction) {
        const clean_parenthetical_text = segment_direction.replace(/^\(+|\)+$/g, "").trim();
        lines_output_buffer.push(`(${clean_parenthetical_text})`);
      }

      // Spoken dialogue text
      lines_output_buffer.push(segment_text);
      lines_output_buffer.push(`/* [[meta: ${JSON.stringify(line_metadata_object)}]] */`);
      lines_output_buffer.push("");
    } else {
      // Narrator / Action paragraph
      lines_output_buffer.push("");
      lines_output_buffer.push(segment_text);
      lines_output_buffer.push(`/* [[meta: ${JSON.stringify(line_metadata_object)}]] */`);
      lines_output_buffer.push("");
    }
  }

  return lines_output_buffer.join("\n");
}

// -------------------------------------------------------------------------
// FOUNTAIN PARSER (FOUNTAIN TEXT -> SEGMENTS)
// -------------------------------------------------------------------------

// WHAT: Parses Fountain plain text into a structured script_segments array.
// WHY: Allows importing screenplay files directly from Beat or human editors
//      while extracting character cues, parentheticals, scene headings, and metadata.
function parse_fountain_to_segments(fountain_text_content = "", parsing_options = {}) {
  if (!fountain_text_content || typeof fountain_text_content !== "string") {
    return {
      title_metadata: {},
      script_segments: []
    };
  }

  const raw_lines = fountain_text_content.replace(/\r\n/g, "\n").split("\n");
  const extracted_script_segments = [];
  const extracted_title_metadata = {};

  let is_parsing_title_page = true;
  let current_active_chapter_title = null;
  let current_active_scene_heading = null;
  let current_active_scene_synopsis = null;
  let current_active_relationship_snapshot = null;

  let pending_character_speaker_name = null;
  let pending_parenthetical_direction = null;
  let pending_boneyard_metadata = null;
  let inside_multi_line_boneyard = false;
  let accumulated_boneyard_text = "";

  let line_index_counter = 0;

  while (line_index_counter < raw_lines.length) {
    const raw_line = raw_lines[line_index_counter];
    const trimmed_line = raw_line.trim();

    // 1. Multi-line Boneyard Comment Handler (/* ... */)
    if (inside_multi_line_boneyard) {
      if (FOUNTAIN_BONEYARD_END_REGEX.test(trimmed_line)) {
        inside_multi_line_boneyard = false;
        accumulated_boneyard_text += " " + trimmed_line.replace(/\*\//g, "").trim();
        parse_boneyard_payload(accumulated_boneyard_text);
        accumulated_boneyard_text = "";
      } else {
        accumulated_boneyard_text += " " + trimmed_line;
      }
      line_index_counter++;
      continue;
    }

    if (FOUNTAIN_BONEYARD_START_REGEX.test(trimmed_line)) {
      if (FOUNTAIN_BONEYARD_END_REGEX.test(trimmed_line)) {
        // Single line boneyard comment
        const comment_content = trimmed_line.replace(/^\/\*|\*\/$/g, "").trim();
        parse_boneyard_payload(comment_content);
      } else {
        inside_multi_line_boneyard = true;
        accumulated_boneyard_text = trimmed_line.replace(/^\/\*/, "").trim();
      }
      line_index_counter++;
      continue;
    }

    // 2. Title Page Key-Value Parsing
    if (is_parsing_title_page) {
      if (trimmed_line === "===" || trimmed_line.startsWith("=== ")) {
        is_parsing_title_page = false;
        line_index_counter++;
        continue;
      }

      const title_property_match = /^([a-zA-Z\s]+):\s*(.*)$/.exec(trimmed_line);
      if (title_property_match) {
        const property_key = title_property_match[1].trim().toLowerCase();
        extracted_title_metadata[property_key] = title_property_match[2].trim();
        line_index_counter++;
        continue;
      }

      // If we encounter a section header or scene heading before title page ends, end title page
      if (FOUNTAIN_SECTION_REGEX.test(trimmed_line) || FOUNTAIN_SCENE_PREFIXES_REGEX.test(trimmed_line) || FOUNTAIN_FORCED_SCENE_REGEX.test(trimmed_line)) {
        is_parsing_title_page = false;
      } else if (trimmed_line === "") {
        // Blank line during title page might just separate properties
        line_index_counter++;
        continue;
      } else {
        // Unrecognized text means title page has concluded
        is_parsing_title_page = false;
      }
    }

    // 3. Blank line: resets dialogue sequence state
    if (trimmed_line === "") {
      line_index_counter++;
      continue;
    }

    // 4. Section Heading (# Chapter 1, ## Act 1)
    const section_match = FOUNTAIN_SECTION_REGEX.exec(trimmed_line);
    if (section_match) {
      current_active_chapter_title = section_match[2].trim();
      line_index_counter++;
      continue;
    }

    // 5. Synopsis Line (= The journey begins)
    const synopsis_match = FOUNTAIN_SYNOPSIS_REGEX.exec(trimmed_line);
    if (synopsis_match) {
      current_active_scene_synopsis = synopsis_match[1].trim();
      line_index_counter++;
      continue;
    }

    // 6. Scene Heading (.INT. or INT. or EXT.)
    const is_standard_scene = FOUNTAIN_SCENE_PREFIXES_REGEX.test(trimmed_line);
    const is_forced_scene = FOUNTAIN_FORCED_SCENE_REGEX.test(trimmed_line);
    if (is_standard_scene || is_forced_scene) {
      current_active_scene_heading = is_forced_scene
        ? trimmed_line.replace(/^\./, "").trim()
        : trimmed_line.trim();
      current_active_scene_synopsis = null;
      current_active_relationship_snapshot = null;
      line_index_counter++;
      continue;
    }

    // 7. Character Cue (@NAME or UPPERCASE with lookahead)
    const forced_character_match = FOUNTAIN_FORCED_CHARACTER_REGEX.exec(trimmed_line);
    const is_all_uppercase_cue = /^[A-Z0-9_\-.' ]+(\s*\(.*\))?$/.test(trimmed_line) &&
      trimmed_line.length < 50 &&
      !trimmed_line.endsWith(".") &&
      !is_standard_scene;

    if (forced_character_match || is_all_uppercase_cue) {
      const raw_character_name = forced_character_match
        ? forced_character_match[1].trim()
        : trimmed_line.replace(/\s*\(.*\)$/, "").trim(); // Strip extensions like (V.O.)

      pending_character_speaker_name = raw_character_name;
      pending_parenthetical_direction = null;
      line_index_counter++;

      // Check next line for parenthetical
      if (line_index_counter < raw_lines.length) {
        const next_line_trimmed = raw_lines[line_index_counter].trim();
        const parenthetical_match = FOUNTAIN_PARENTHETICAL_REGEX.exec(next_line_trimmed);
        if (parenthetical_match) {
          pending_parenthetical_direction = parenthetical_match[1].trim();
          line_index_counter++;
        }
      }

      // Collect spoken dialogue lines until blank line or next character/scene
      const collected_dialogue_lines = [];
      while (line_index_counter < raw_lines.length) {
        const dialogue_line = raw_lines[line_index_counter].trim();
        if (dialogue_line === "") break;

        // Check for line-level boneyard metadata
        if (FOUNTAIN_BONEYARD_START_REGEX.test(dialogue_line)) {
          const comment_content = dialogue_line.replace(/^\/\*|\*\/$/g, "").trim();
          parse_boneyard_payload(comment_content);
          line_index_counter++;
          continue;
        }

        collected_dialogue_lines.push(dialogue_line);
        line_index_counter++;
      }

      if (collected_dialogue_lines.length > 0) {
        const spoken_text_content = collected_dialogue_lines.join(" ");
        const dialogue_segment = {
          id: (pending_boneyard_metadata && pending_boneyard_metadata.id) || `seg_${extracted_script_segments.length + 1}`,
          type: "dialogue",
          speaker: pending_character_speaker_name,
          text: spoken_text_content,
          direction: pending_parenthetical_direction || (pending_boneyard_metadata && pending_boneyard_metadata.direction) || "expressive dialogue",
          scene_heading: current_active_scene_heading,
          chapter_title: current_active_chapter_title,
          scene_synopsis: current_active_scene_synopsis
        };

        if (pending_boneyard_metadata) {
          if (pending_boneyard_metadata.hash) dialogue_segment.hash = pending_boneyard_metadata.hash;
          if (typeof pending_boneyard_metadata.conf === "number") dialogue_segment.confidence = pending_boneyard_metadata.conf;
          if (pending_boneyard_metadata.acoustic) dialogue_segment.acoustic_cues = pending_boneyard_metadata.acoustic;
          if (pending_boneyard_metadata.audio) dialogue_segment.audioPath = pending_boneyard_metadata.audio;
        }

        if (current_active_relationship_snapshot) {
          dialogue_segment.relationship_snapshot = current_active_relationship_snapshot;
        }

        extracted_script_segments.push(dialogue_segment);
        pending_character_speaker_name = null;
        pending_parenthetical_direction = null;
        pending_boneyard_metadata = null;
      }
      continue;
    }

    // 8. Action / Narrative Paragraph (Narrator text)
    const collected_narrative_lines = [trimmed_line];
    line_index_counter++;

    while (line_index_counter < raw_lines.length) {
      const next_narrative_line = raw_lines[line_index_counter].trim();
      if (next_narrative_line === "") break;

      if (FOUNTAIN_BONEYARD_START_REGEX.test(next_narrative_line)) {
        const comment_content = next_narrative_line.replace(/^\/\*|\*\/$/g, "").trim();
        parse_boneyard_payload(comment_content);
        line_index_counter++;
        continue;
      }

      // If next line is a scene heading or character cue, stop narrative block
      if (
        FOUNTAIN_SCENE_PREFIXES_REGEX.test(next_narrative_line) ||
        FOUNTAIN_FORCED_SCENE_REGEX.test(next_narrative_line) ||
        FOUNTAIN_FORCED_CHARACTER_REGEX.test(next_narrative_line) ||
        FOUNTAIN_SECTION_REGEX.test(next_narrative_line)
      ) {
        break;
      }

      collected_narrative_lines.push(next_narrative_line);
      line_index_counter++;
    }

    const narrative_text_content = collected_narrative_lines.join(" ");
    const narrator_segment = {
      id: (pending_boneyard_metadata && pending_boneyard_metadata.id) || `seg_${extracted_script_segments.length + 1}`,
      type: "narrator",
      speaker: "Narrator",
      text: narrative_text_content,
      direction: "calm, steady narration",
      scene_heading: current_active_scene_heading,
      chapter_title: current_active_chapter_title,
      scene_synopsis: current_active_scene_synopsis
    };

    if (pending_boneyard_metadata) {
      if (pending_boneyard_metadata.hash) narrator_segment.hash = pending_boneyard_metadata.hash;
      if (pending_boneyard_metadata.audio) narrator_segment.audioPath = pending_boneyard_metadata.audio;
    }

    extracted_script_segments.push(narrator_segment);
    pending_boneyard_metadata = null;
  }

  function parse_boneyard_payload(payload_string) {
    try {
      const meta_json_match = /\[\[(?:meta|segment_meta):\s*(\{.*\})\]\]/.exec(payload_string);
      if (meta_json_match && meta_json_match[1]) {
        pending_boneyard_metadata = JSON.parse(meta_json_match[1]);
        return;
      }

      const relationship_json_match = /\[\[relationship_snapshot:\s*(\{.*\})\]\]/.exec(payload_string);
      if (relationship_json_match && relationship_json_match[1]) {
        current_active_relationship_snapshot = JSON.parse(relationship_json_match[1]);
        return;
      }
    } catch (parse_error) {
      // Ignored malformed boneyard metadata gracefully
    }
  }

  return {
    title_metadata: extracted_title_metadata,
    script_segments: extracted_script_segments
  };
}

// -------------------------------------------------------------------------
// SCRIPT ANALYTICS & SANITY CHECKER (BEAT-STYLE METRICS)
// -------------------------------------------------------------------------

// WHAT: Generates high-level screenplay analytics and attribution sanity audits.
// WHY: Replicates Beat's statistical breakdown (dialogue share, pacing, runtimes)
//      while catching AI audiobook issues like attribution failures or orphan voices.
function compute_script_analytics(script_segments_list = [], voice_mapping = {}) {
  const safe_segments_list = Array.isArray(script_segments_list) ? script_segments_list : [];

  let total_words_count = 0;
  let total_dialogue_words_count = 0;
  let total_narrator_words_count = 0;
  let total_dialogue_lines_count = 0;
  let total_narrator_lines_count = 0;

  const character_statistics_map = new Map();
  const scene_headings_set = new Set();
  let interior_scenes_count = 0;
  let exterior_scenes_count = 0;

  for (let segment_index = 0; segment_index < safe_segments_list.length; segment_index++) {
    const segment = safe_segments_list[segment_index];
    if (!segment) continue;

    const segment_text = segment.text || "";
    const word_tokens = segment_text.trim().split(/\s+/).filter(Boolean);
    const word_count = word_tokens.length;
    total_words_count += word_count;

    if (segment.scene_heading) {
      scene_headings_set.add(segment.scene_heading);
    }

    const is_dialogue = (segment.type || "").toLowerCase() === "dialogue";
    const speaker_name = segment.speaker || (is_dialogue ? "Character" : "Narrator");

    if (is_dialogue) {
      total_dialogue_words_count += word_count;
      total_dialogue_lines_count++;

      let character_stat = character_statistics_map.get(speaker_name);
      if (!character_stat) {
        character_stat = {
          speaker: speaker_name,
          line_count: 0,
          word_count: 0,
          confidence_scores_list: [],
          has_assigned_voice: Boolean(voice_mapping[speaker_name]),
          assigned_voice_id: voice_mapping[speaker_name] || null
        };
        character_statistics_map.set(speaker_name, character_stat);
      }

      character_stat.line_count++;
      character_stat.word_count += word_count;
      if (typeof segment.confidence === "number") {
        character_stat.confidence_scores_list.push(segment.confidence);
      }
    } else {
      total_narrator_words_count += word_count;
      total_narrator_lines_count++;
    }
  }

  for (const scene_heading of scene_headings_set) {
    if (/^INT\b/i.test(scene_heading)) {
      interior_scenes_count++;
    } else if (/^EXT\b/i.test(scene_heading)) {
      exterior_scenes_count++;
    }
  }

  // Format character dialogue breakdown list
  const character_breakdown_list = Array.from(character_statistics_map.values()).map((stat) => {
    const dialogue_line_percentage = total_dialogue_lines_count > 0
      ? Math.round((stat.line_count / total_dialogue_lines_count) * 1000) / 10
      : 0;

    const average_confidence = stat.confidence_scores_list.length > 0
      ? Math.round((stat.confidence_scores_list.reduce((acc, score) => acc + score, 0) / stat.confidence_scores_list.length) * 100) / 100
      : 1.0;

    // Casting Tier Recommendation
    let casting_tier = "Incidental / Minor";
    if (dialogue_line_percentage >= 20) {
      casting_tier = "Lead / Primary Cast (Dedicated Cloned Voice)";
    } else if (dialogue_line_percentage >= 5) {
      casting_tier = "Supporting Cast (High-Quality Character Voice)";
    } else if (stat.line_count <= 2) {
      casting_tier = "One-Off / Cameo (Candidate for Attribution Sanity Audit)";
    }

    return {
      speaker: stat.speaker,
      line_count: stat.line_count,
      word_count: stat.word_count,
      dialogue_line_percentage,
      average_confidence,
      has_assigned_voice: stat.has_assigned_voice,
      assigned_voice_id: stat.assigned_voice_id,
      casting_tier
    };
  });

  // Sort descending by line count
  character_breakdown_list.sort((a, b) => b.line_count - a.line_count);

  // Attribution Sanity Flags
  const sanity_flags_list = [];
  for (const character_entry of character_breakdown_list) {
    if (character_entry.line_count <= 2) {
      sanity_flags_list.push({
        type: "SUSPICIOUS_LOW_LINE_COUNT",
        severity: "low",
        speaker: character_entry.speaker,
        message: `Character "${character_entry.speaker}" has only ${character_entry.line_count} dialogue line(s). Check if this is an attribution alias mistake.`
      });
    }
    if (character_entry.average_confidence < 0.70) {
      sanity_flags_list.push({
        type: "LOW_CONFIDENCE_ATTRIBUTION",
        severity: "medium",
        speaker: character_entry.speaker,
        message: `Attribution confidence for "${character_entry.speaker}" averages ${character_entry.average_confidence}. Verification recommended.`
      });
    }
  }

  // Audio runtime estimation
  const dialogue_seconds = (total_dialogue_words_count / ESTIMATED_WORDS_PER_MINUTE) * 60;
  const narrator_seconds = (total_narrator_words_count / ESTIMATED_WORDS_PER_MINUTE) * 60;
  const speaker_switch_pauses = total_dialogue_lines_count * ESTIMATED_PAUSE_SECONDS_PER_SPEAKER_SWITCH;
  const scene_transition_pauses = scene_headings_set.size * ESTIMATED_PAUSE_SECONDS_PER_SCENE_TRANSITION;
  const total_estimated_audio_runtime_seconds = Math.round(dialogue_seconds + narrator_seconds + speaker_switch_pauses + scene_transition_pauses);

  return {
    summary: {
      total_segments_count: safe_segments_list.length,
      total_words_count,
      total_dialogue_lines_count,
      total_narrator_lines_count,
      total_unique_characters_count: character_statistics_map.size,
      total_scenes_count: scene_headings_set.size,
      interior_scenes_count,
      exterior_scenes_count,
      estimated_runtime_seconds: total_estimated_audio_runtime_seconds,
      estimated_runtime_formatted: format_seconds_to_human_time(total_estimated_audio_runtime_seconds)
    },
    character_dialogue_distribution: character_breakdown_list,
    sanity_flags: sanity_flags_list
  };
}

// -------------------------------------------------------------------------
// OUTLINE & SCENE INDEX CARDS GENERATOR
// -------------------------------------------------------------------------

// WHAT: Aggregates segments into discrete scene index cards with relationship state.
// WHY: Gives the user a visual overview (characters present, synopsis, dynamics, runtime)
//      before committing to batch audio rendering.
function generate_scene_outline_cards(script_segments_list = []) {
  const safe_segments_list = Array.isArray(script_segments_list) ? script_segments_list : [];
  const scene_cards_list = [];

  let current_card = null;
  let scene_index_counter = 0;

  for (let segment_index = 0; segment_index < safe_segments_list.length; segment_index++) {
    const segment = safe_segments_list[segment_index];
    if (!segment) continue;

    const segment_scene_heading = segment.scene_heading || "SCENE 1 (DEFAULT)";

    // Start a new scene card if heading changes or first segment
    if (!current_card || current_card.scene_heading !== segment_scene_heading) {
      if (current_card) {
        finalize_card_metrics(current_card);
        scene_cards_list.push(current_card);
      }

      scene_index_counter++;
      current_card = {
        scene_number: scene_index_counter,
        scene_heading: segment_scene_heading,
        chapter_title: segment.chapter_title || "Chapter",
        synopsis: segment.scene_synopsis || "No synopsis recorded.",
        characters_present_set: new Set(),
        relationship_snapshot: segment.relationship_snapshot || {},
        dialogue_lines_count: 0,
        narrator_lines_count: 0,
        word_count: 0,
        start_segment_id: segment.id,
        end_segment_id: segment.id
      };
    }

    // Tally metrics for this scene
    current_card.end_segment_id = segment.id;
    const words_in_segment = (segment.text || "").trim().split(/\s+/).filter(Boolean).length;
    current_card.word_count += words_in_segment;

    if ((segment.type || "").toLowerCase() === "dialogue") {
      current_card.dialogue_lines_count++;
      if (segment.speaker) current_card.characters_present_set.add(segment.speaker);
    } else {
      current_card.narrator_lines_count++;
    }

    if (segment.relationship_snapshot && Object.keys(segment.relationship_snapshot).length > 0) {
      current_card.relationship_snapshot = {
        ...current_card.relationship_snapshot,
        ...segment.relationship_snapshot
      };
    }
  }

  if (current_card) {
    finalize_card_metrics(current_card);
    scene_cards_list.push(current_card);
  }

  function finalize_card_metrics(card_object) {
    card_object.characters_present = Array.from(card_object.characters_present_set);
    delete card_object.characters_present_set;
    const scene_audio_seconds = Math.round((card_object.word_count / ESTIMATED_WORDS_PER_MINUTE) * 60 + (card_object.dialogue_lines_count * 0.45));
    card_object.estimated_runtime_seconds = scene_audio_seconds;
    card_object.estimated_runtime_formatted = format_seconds_to_human_time(scene_audio_seconds);
  }

  return scene_cards_list;
}

// -------------------------------------------------------------------------
// REVISION TRACKING & INCREMENTAL AUDIO DIFF PLANNER
// -------------------------------------------------------------------------

// WHAT: Analyzes changes between script revisions and existing audio cache entries.
// WHY: Avoids regenerating audio for unaltered lines, saving immense TTS compute.
function compute_revision_diff_and_cache_plan(previous_segments_list = [], current_segments_list = [], audio_cache_index = {}) {
  const safe_previous_list = Array.isArray(previous_segments_list) ? previous_segments_list : [];
  const safe_current_list = Array.isArray(current_segments_list) ? current_segments_list : [];

  const previous_segments_map = new Map();
  for (const prev_segment of safe_previous_list) {
    if (prev_segment && prev_segment.id) {
      previous_segments_map.set(prev_segment.id, prev_segment);
    }
  }

  const reusable_segments_list = [];
  const dirty_rerender_segments_list = [];
  const new_segments_list = [];

  for (let current_index = 0; current_index < safe_current_list.length; current_index++) {
    const current_segment = safe_current_list[current_index];
    if (!current_segment) continue;

    const segment_id = current_segment.id || `seg_${current_index + 1}`;
    const calculated_hash = compute_deterministic_segment_hash({
      speaker_name: current_segment.speaker,
      delivery_direction: current_segment.direction,
      spoken_text: current_segment.text,
      assigned_voice_id: current_segment.voice_id || "default"
    });

    current_segment.hash = calculated_hash;

    const matched_previous_segment = previous_segments_map.get(segment_id);
    const has_cached_audio_file = Boolean(audio_cache_index[calculated_hash] || current_segment.audioPath);

    if (!matched_previous_segment) {
      // Completely new segment added to script
      new_segments_list.push({
        segment_id,
        reason: "NEW_SEGMENT_ADDED",
        segment: current_segment
      });
      dirty_rerender_segments_list.push(current_segment);
    } else {
      const previous_hash = matched_previous_segment.hash || compute_deterministic_segment_hash({
        speaker_name: matched_previous_segment.speaker,
        delivery_direction: matched_previous_segment.direction,
        spoken_text: matched_previous_segment.text,
        assigned_voice_id: matched_previous_segment.voice_id || "default"
      });

      if (previous_hash === calculated_hash && has_cached_audio_file) {
        // Line is identical and audio artifact is already cached
        reusable_segments_list.push({
          segment_id,
          cached_hash: calculated_hash,
          audio_path: audio_cache_index[calculated_hash] || current_segment.audioPath,
          segment: current_segment
        });
      } else {
        // Content, speaker, or direction changed
        dirty_rerender_segments_list.push(current_segment);
      }
    }
  }

  const total_active_segments = safe_current_list.length;
  const reused_percentage = total_active_segments > 0
    ? Math.round((reusable_segments_list.length / total_active_segments) * 1000) / 10
    : 0;

  return {
    summary: {
      total_segments_count: total_active_segments,
      reusable_cached_count: reusable_segments_list.length,
      dirty_rerender_count: dirty_rerender_segments_list.length,
      new_added_count: new_segments_list.length,
      compute_savings_percentage: reused_percentage
    },
    reusable_segments: reusable_segments_list,
    dirty_segments_to_render: dirty_rerender_segments_list
  };
}

// -------------------------------------------------------------------------
// UTILITY HELPERS
// -------------------------------------------------------------------------

function format_seconds_to_human_time(total_seconds = 0) {
  const rounded_seconds = Math.max(0, Math.round(total_seconds));
  const minutes = Math.floor(rounded_seconds / 60);
  const remaining_seconds = rounded_seconds % 60;
  return `${minutes}m ${remaining_seconds.toString().padStart(2, "0")}s`;
}

// -------------------------------------------------------------------------
// ELECTRON IPC HANDLER REGISTRATION
// -------------------------------------------------------------------------

// WHAT: Registers Fountain IPC handlers for Electron's main process.
// WHY: Allows renderer to export/import .fountain files via OS dialogs,
//      calculate screenplay analytics, view scene outline cards, and run revision diffs.
function register_fountain_handlers(ipcMain, getMainWindow) {
  if (!ipcMain) return;

  let electron_dialog_module = null;
  try {
    const electron = require("electron");
    electron_dialog_module = electron.dialog;
  } catch (dialog_require_err) {
    // Graceful fallback for non-Electron test runs
  }

  ipcMain.handle("fountain:export-script", async (event, request_payload = {}) => {
    const { script_segments, options = {}, file_path, save_dialog } = request_payload;
    const fountain_text = serialize_segments_to_fountain(script_segments, options);

    if (save_dialog && electron_dialog_module) {
      const parent_window = typeof getMainWindow === "function" ? getMainWindow() : null;
      const save_result = await electron_dialog_module.showSaveDialog(parent_window, {
        title: "Export Script to Fountain",
        defaultPath: options.default_filename || "screenplay.fountain",
        filters: [
          { name: "Fountain Screenplay", extensions: ["fountain", "spmd", "txt"] }
        ]
      });

      if (!save_result.canceled && save_result.filePath) {
        const fs = require("fs");
        fs.writeFileSync(save_result.filePath, fountain_text, "utf8");
        return { success: true, file_path: save_result.filePath, fountain_text };
      }
      return { success: false, canceled: true, fountain_text };
    }

    if (file_path) {
      const fs = require("fs");
      fs.writeFileSync(file_path, fountain_text, "utf8");
      return { success: true, file_path, fountain_text };
    }

    return { success: true, fountain_text };
  });

  ipcMain.handle("fountain:import-script", async (event, request_payload = {}) => {
    let raw_fountain_text = request_payload.fountain_text;
    let target_file_path = request_payload.file_path;

    if (request_payload.open_dialog && electron_dialog_module) {
      const parent_window = typeof getMainWindow === "function" ? getMainWindow() : null;
      const open_result = await electron_dialog_module.showOpenDialog(parent_window, {
        title: "Import Fountain Screenplay",
        properties: ["openFile"],
        filters: [
          { name: "Fountain Screenplay", extensions: ["fountain", "spmd", "txt"] }
        ]
      });

      if (!open_result.canceled && open_result.filePaths.length > 0) {
        target_file_path = open_result.filePaths[0];
        const fs = require("fs");
        raw_fountain_text = fs.readFileSync(target_file_path, "utf8");
      } else {
        return { success: false, canceled: true };
      }
    } else if (target_file_path) {
      const fs = require("fs");
      if (fs.existsSync(target_file_path)) {
        raw_fountain_text = fs.readFileSync(target_file_path, "utf8");
      }
    }

    const parse_result = parse_fountain_to_segments(raw_fountain_text || "");
    return {
      success: true,
      file_path: target_file_path || null,
      title_metadata: parse_result.title_metadata,
      script_segments: parse_result.script_segments
    };
  });

  ipcMain.handle("fountain:compute-analytics", async (event, request_payload = {}) => {
    const { script_segments, voice_mapping } = request_payload;
    return compute_script_analytics(script_segments, voice_mapping);
  });

  ipcMain.handle("fountain:generate-outline-cards", async (event, request_payload = {}) => {
    const { script_segments } = request_payload;
    return generate_scene_outline_cards(script_segments);
  });

  ipcMain.handle("fountain:compute-revision-diff", async (event, request_payload = {}) => {
    const { previous_segments, current_segments, audio_cache_index } = request_payload;
    return compute_revision_diff_and_cache_plan(previous_segments, current_segments, audio_cache_index);
  });
}

// Export public service interface
module.exports = {
  serialize_segments_to_fountain,
  parse_fountain_to_segments,
  compute_script_analytics,
  generate_scene_outline_cards,
  compute_revision_diff_and_cache_plan,
  compute_deterministic_segment_hash,
  register_fountain_handlers
};

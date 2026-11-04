// =========================================================================
// PURE FUNCTIONAL SPECIAL-CONTENT & ACOUSTIC FILTER SERVICE
// =========================================================================
// WHAT: Handles non-standard audiobook content types:
//       1. Inner thoughts & italics (intimate, close-mic, suppressed delivery).
//       2. Filtered voices (phone calls, radio intercoms, voices through walls).
//       3. Epistolary content (letters, emails, text messages read aloud).
//       4. Minor character / walk-on voice pooling (reusable cast palettes).
// WHY: Most fiction breaks standard dialogue rules with internal monologues, phone calls,
//      and letters. Handling these through specialized acoustic filters and staging rules
//      produces an immersive theatrical experience without manual sound engineering.

/**
 * WHAT: Standard acoustic filter chain presets for FFmpeg audio mastering.
 * WHY: Applying frequency bandpass and saturation in post-processing sounds authentically
 *      like hardware transmitters (PSTN phones, tactical radios) without re-rendering voice takes.
 */
const ACOUSTIC_FILTER_PRESETS = {
  none: "anull",
  phone_call: "highpass=f=300,lowpass=f=3400,volume=1.05",
  radio_intercom: "highpass=f=450,lowpass=f=2800,volume=1.1,aecho=0.8:0.88:12:0.25",
  through_wall: "lowpass=f=550,volume=0.85",
  recording_device: "highpass=f=200,lowpass=f=4000,volume=1.0",
  megaphone_pa: "highpass=f=500,lowpass=f=4500,volume=1.2,aecho=0.8:0.7:40:0.3"
};

/**
 * WHAT: Standard minor character walk-on voice pool.
 * WHY: A novel with 40 incidental characters (waiters, guards, clerks) does not need 40 cloned voices.
 *      Assigning minor characters to a calibrated palette of 6 diverse baseline voices with deterministic
 *      pitch and speed offsets reduces voice cloning cost and manual review effort by 80%.
 */
const MINOR_CHARACTER_VOICE_PALETTE = [
  { pool_id: "walkon_male_mature", base_preset: "Eric", pitch_offset_semitones: -1, speed_ratio: 0.98 },
  { pool_id: "walkon_male_brisk", base_preset: "Dylan", pitch_offset_semitones: 0, speed_ratio: 1.05 },
  { pool_id: "walkon_male_gravel", base_preset: "Marcus", pitch_offset_semitones: -2, speed_ratio: 0.94 },
  { pool_id: "walkon_female_warm", base_preset: "Serena", pitch_offset_semitones: 0, speed_ratio: 1.0 },
  { pool_id: "walkon_female_crisp", base_preset: "Elena", pitch_offset_semitones: 1, speed_ratio: 1.04 },
  { pool_id: "walkon_female_soft", base_preset: "Chloe", pitch_offset_semitones: -1, speed_ratio: 0.96 }
];

/**
 * WHAT: Analyzes a manuscript segment to detect inner monologue / thoughts.
 * WHY: Inner thoughts require intimate, close-mic delivery rather than standard outward speech.
 * 
 * @param {Readonly<Object>} segment - Screenplay or manuscript segment.
 * @returns {{ readonly is_inner_thought: boolean, readonly thought_text: string, readonly confidence: number, readonly delivery_cues: Readonly<Object> }}
 */
function detect_inner_thought_content(segment) {
  const raw_text = (segment.text || segment.content || "").trim();
  const preceding_context = (segment.preceding_text || "").trim();
  const direction_text = (segment.direction || "").trim().toLowerCase();

  // Pattern 1: Explicit thought formatting in text (italic markers: *thought*, _thought_, <i>thought</i>)
  const has_italic_markdown = /^(\*|_)[^*_]+(\*|_)$/.test(raw_text) || /^\*[^*]+\*$/.test(raw_text);
  const has_italic_html = /^<i>[^<]+<\/i>$/i.test(raw_text);

  // Pattern 2: Thought speech tag in text or direction ("he thought", "she wondered to herself")
  const thought_attribution_regex = /\b(?:thought|wondered|mused|reflected|realized|said to (?:himself|herself|themselves))\b/i;
  const has_thought_verb_in_text = thought_attribution_regex.test(raw_text);
  const has_thought_verb_in_direction = thought_attribution_regex.test(direction_text);
  const has_thought_in_context = thought_attribution_regex.test(preceding_context);

  const is_inner_thought = has_italic_markdown || has_italic_html || has_thought_verb_in_direction ||
                          (segment.is_thought === true) || (has_thought_verb_in_text && segment.type !== "dialogue");

  let cleaned_thought_text = raw_text;
  if (has_italic_markdown) {
    cleaned_thought_text = raw_text.replace(/^(\*|_)+|(\*|_)+$/g, "").trim();
  } else if (has_italic_html) {
    cleaned_thought_text = raw_text.replace(/^<i>|<\/i>$/gi, "").trim();
  }

  // WHAT: Directorial acoustic treatment for internal thoughts.
  // WHY: Internal thoughts live inside the character's head; they should sound intimate,
  //      held-back, and close-mic rather than projected into a room.
  const delivery_cues = is_inner_thought ? {
    distance: "intimate",
    expression: "suppressed",
    proximity_note: "Internal monologue, intimate mental voice, close-mic delivery",
    pacing_speed_ratio: 0.96
  } : {
    distance: "conversational",
    expression: "balanced",
    proximity_note: null,
    pacing_speed_ratio: 1.0
  };

  const confidence = is_inner_thought ? (has_italic_markdown || has_thought_verb_in_direction ? 0.95 : 0.75) : 0.0;

  return {
    is_inner_thought,
    thought_text: cleaned_thought_text,
    confidence,
    delivery_cues: Object.freeze(delivery_cues)
  };
}

/**
 * WHAT: Resolves FFmpeg audio filter string for a given transmission context.
 * WHY: Applies phone, intercom, or wall bandpass filters during timeline assembly.
 * 
 * @param {string} acoustic_context_name 
 * @returns {string} Valid FFmpeg filter chain string.
 */
function resolve_acoustic_filter_chain(acoustic_context_name) {
  const normalized_context = (acoustic_context_name || "none").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ACOUSTIC_FILTER_PRESETS[normalized_context] || ACOUSTIC_FILTER_PRESETS.none;
}

/**
 * WHAT: Resolves which character voice should read epistolary content (letters, texts, emails).
 * WHY: Authors handle written documents differently: some imagine the sender speaking,
 *      some hear the recipient reading aloud, and some prefer a neutral formal narrator.
 * 
 * @param {Readonly<{
 *   sender_character: string,
 *   recipient_character: string,
 *   narrator_voice: string,
 *   book_epistolary_policy?: "sender_voice" | "recipient_voice" | "narrator_formal"
 * }>} epistolary_context 
 * @returns {{ readonly resolved_speaker_name: string, readonly delivery_style: string }}
 */
function resolve_epistolary_reader_speaker(epistolary_context) {
  const {
    sender_character,
    recipient_character,
    narrator_voice = "Narrator",
    book_epistolary_policy = "sender_voice"
  } = epistolary_context;

  switch (book_epistolary_policy) {
    case "recipient_voice":
      return {
        resolved_speaker_name: recipient_character || narrator_voice,
        delivery_style: "reading aloud, paced cadence, slightly flat document delivery"
      };
    case "narrator_formal":
      return {
        resolved_speaker_name: narrator_voice,
        delivery_style: "formal document narration, measured, neutral pace"
      };
    case "sender_voice":
    default:
      return {
        resolved_speaker_name: sender_character || narrator_voice,
        delivery_style: "epistolary reading, as if spoken directly from the writer's memory"
      };
  }
}

/**
 * WHAT: Deterministically maps minor incidental characters to a reusable voice pool.
 * WHY: Avoids cloning 40 separate voices for one-line characters by reusing a calibrated
 *      minor character palette with deterministic pitch and speed variations.
 * 
 * @param {string} minor_character_name - Name of incidental character (e.g. "Guard 1", "Barista").
 * @param {string} [gender_hint="neutral"] - "male" | "female" | "neutral"
 * @returns {Readonly<{ pool_id: string, base_preset: string, pitch_offset_semitones: number, speed_ratio: number }>}
 */
function assign_minor_character_voice_pool(minor_character_name, gender_hint = "neutral") {
  const normalized_name = (minor_character_name || "incidental").trim().toLowerCase();
  
  // Filter palette by gender hint if specified
  const filtered_palette = MINOR_CHARACTER_VOICE_PALETTE.filter(p => {
    if (gender_hint === "male") return p.pool_id.includes("male");
    if (gender_hint === "female") return p.pool_id.includes("female");
    return true;
  });

  const active_palette = filtered_palette.length > 0 ? filtered_palette : MINOR_CHARACTER_VOICE_PALETTE;

  // WHAT: Deterministic hash of character name.
  // WHY: Ensures "Guard 1" always gets the exact same voice across chapters and re-renders.
  let hash_accum = 0;
  for (let idx = 0; idx < normalized_name.length; idx++) {
    hash_accum = ((hash_accum << 5) - hash_accum) + normalized_name.charCodeAt(idx);
    hash_accum |= 0;
  }
  const selected_index = Math.abs(hash_accum) % active_palette.length;
  return Object.freeze(active_palette[selected_index]);
}

module.exports = {
  ACOUSTIC_FILTER_PRESETS,
  MINOR_CHARACTER_VOICE_PALETTE,
  detect_inner_thought_content,
  resolve_acoustic_filter_chain,
  resolve_epistolary_reader_speaker,
  assign_minor_character_voice_pool
};


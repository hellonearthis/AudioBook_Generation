// =========================================================================
// UNIT TESTS: AUDIO PIPELINE ENHANCEMENTS
// =========================================================================
// WHAT: Tests content-hash audio caching, pronunciation lexicon substitutions,
//       and audio mastering pause/loudnorm filter generation.
// WHY: Verifies that core domain transformations are pure, deterministic, and total.

const {
  compute_take_content_hash,
  resolve_audio_cache_directory_path
} = require("../services/audio_cache_service");

const {
  normalize_lexicon_entry,
  escape_regular_expression_characters,
  apply_pronunciation_lexicon
} = require("../services/pronunciation_lexicon_service");

const {
  DEFAULT_PAUSE_CONFIGURATIONS,
  compute_inter_segment_pause_duration,
  generate_ffmetadata_file_content,
  build_ffmpeg_filter_chain
} = require("../services/audio_mastering_service");

describe("Feature A: Content-Hash Audio Caching", () => {
  const base_payload = {
    text: "The path was dark and winding.",
    speaker: "Narrator",
    voice: "Eric",
    seed: 42424,
    workflowType: "custom",
    emotion: "calm",
    instruction: "Read naturally",
    speed: "1.0",
    pitch: "medium",
    volume: "medium"
  };

  test("computes deterministic identical hashes for identical payloads", () => {
    const hash_one = compute_take_content_hash(base_payload);
    const hash_two = compute_take_content_hash({ ...base_payload });
    expect(hash_one).toBe(hash_two);
    expect(hash_one).toHaveLength(16);
  });

  test("generates different hash when text content changes", () => {
    const original_hash = compute_take_content_hash(base_payload);
    const modified_hash = compute_take_content_hash({
      ...base_payload,
      text: "The path was bright and open."
    });
    expect(modified_hash).not.toBe(original_hash);
  });

  test("generates different hash when emotional delivery or acting instruction changes", () => {
    const original_hash = compute_take_content_hash(base_payload);
    const modified_hash = compute_take_content_hash({
      ...base_payload,
      emotion: "furious"
    });
    expect(modified_hash).not.toBe(original_hash);
  });

  test("generates different hash when seed or voice preset changes", () => {
    const original_hash = compute_take_content_hash(base_payload);
    const seed_changed_hash = compute_take_content_hash({
      ...base_payload,
      seed: 99999
    });
    const voice_changed_hash = compute_take_content_hash({
      ...base_payload,
      voice: "Aiden"
    });
    expect(seed_changed_hash).not.toBe(original_hash);
    expect(voice_changed_hash).not.toBe(original_hash);
  });

  test("resolves canonical audio cache directory path", () => {
    const cache_path = resolve_audio_cache_directory_path("C:\\Projects", "BookOne");
    expect(cache_path).toContain("audio");
    expect(cache_path).toContain("cache");
  });
});

describe("Feature B: Pronunciation Lexicon & Phonetic Overrides", () => {
  test("normalizes raw lexicon entries correctly", () => {
    const valid_entry = normalize_lexicon_entry({
      target_word: "  Maren  ",
      replacement: "  MAIR-in  ",
      type: "respelling",
      case_sensitive: true
    });

    expect(valid_entry).toEqual({
      target_word: "Maren",
      replacement: "MAIR-in",
      type: "respelling",
      case_sensitive: true,
      notes: ""
    });

    const invalid_entry = normalize_lexicon_entry({ target_word: "", replacement: "" });
    expect(invalid_entry).toBeNull();
  });

  test("escapes regex special characters safely", () => {
    expect(escape_regular_expression_characters("Dr. Smith-Jones (Jr.)")).toBe("Dr\\.\\ Smith\\-Jones\\ \\(Jr\\.\\)");
  });

  test("substitutes whole words while preserving surrounding text", () => {
    const dictionary = [
      { target_word: "Maren", replacement: "MAIR-in" },
      { target_word: "CMBR", replacement: "Cosmic Microwave Background" }
    ];

    const input_text = "Maren observed the strange fluctuations in the CMBR signal.";
    const result = apply_pronunciation_lexicon(input_text, dictionary);

    expect(result.transformed_text).toBe("MAIR-in observed the strange fluctuations in the Cosmic Microwave Background signal.");
    expect(result.applied_replacements_list).toHaveLength(2);
  });

  test("protects against partial word matches", () => {
    const dictionary = [
      { target_word: "cat", replacement: "feline" }
    ];

    const input_text = "The concatenation process was catastrophic for the cat.";
    const result = apply_pronunciation_lexicon(input_text, dictionary);

    // "concatenation" and "catastrophic" must NOT be modified
    expect(result.transformed_text).toBe("The concatenation process was catastrophic for the feline.");
  });

  test("handles case sensitivity flags strictly", () => {
    const case_sensitive_dict = [
      { target_word: "Lead", replacement: "Metal-Element", case_sensitive: true }
    ];

    const input_text = "Lead pipes lead to poisoning.";
    const result = apply_pronunciation_lexicon(input_text, case_sensitive_dict);

    expect(result.transformed_text).toBe("Metal-Element pipes lead to poisoning.");
  });

  test("prioritizes longer compound phrases before single words", () => {
    const dictionary = [
      { target_word: "New York", replacement: "The Big Apple" },
      { target_word: "York", replacement: "Ancient Fortress" }
    ];

    const input_text = "Traveling to New York was exciting.";
    const result = apply_pronunciation_lexicon(input_text, dictionary);

    expect(result.transformed_text).toBe("Traveling to The Big Apple was exciting.");
  });
});

describe("Feature C: Audio Mastering & Assembly (No Room Tone)", () => {
  test("computes calibrated pauses across different conversational boundaries", () => {
    const seg_one = { speaker: "Narrator", text: "Chapter One: The Crossing.", type: "scene_heading" };
    const seg_two = { speaker: "Narrator", text: "The wind howled across the plain." };
    const seg_three = { speaker: "Maren", text: "We need to keep moving." };
    const seg_four = { speaker: "Maren", text: "Before the storm hits." };
    const seg_five = { speaker: "Josh", text: "I agree.", gap_before: 0.8 };

    // Initial segment has 0s pause
    expect(compute_inter_segment_pause_duration(null, seg_one)).toBe(0.0);

    // Scene heading break
    expect(compute_inter_segment_pause_duration(seg_one, { ...seg_one, is_scene_break: true })).toBe(1.0);

    // Speaker transition (Narrator -> Maren)
    expect(compute_inter_segment_pause_duration(seg_two, seg_three)).toBe(DEFAULT_PAUSE_CONFIGURATIONS.speaker_transition_seconds);

    // Same speaker continuation (Maren -> Maren)
    expect(compute_inter_segment_pause_duration(seg_three, seg_four)).toBe(DEFAULT_PAUSE_CONFIGURATIONS.same_speaker_continuation_seconds);

    // Explicit gap_before override
    expect(compute_inter_segment_pause_duration(seg_four, seg_five)).toBe(0.8);
  });

  test("generates valid FFMETADATA chapter definitions", () => {
    const project_meta = {
      title: "The Stellar Path",
      author: "Arthur Vance",
      chapters: [
        { title: "Chapter 1: The Ascent", start_seconds: 0.0, end_seconds: 120.5 },
        { title: "Chapter 2: The Void", start_seconds: 120.5, end_seconds: 350.0 }
      ]
    };

    const ffmetadata = generate_ffmetadata_file_content(project_meta);

    expect(ffmetadata).toContain(";FFMETADATA1");
    expect(ffmetadata).toContain("title=The Stellar Path");
    expect(ffmetadata).toContain("[CHAPTER]");
    expect(ffmetadata).toContain("START=0");
    expect(ffmetadata).toContain("END=120500");
    expect(ffmetadata).toContain("title=Chapter 1: The Ascent");
    expect(ffmetadata).toContain("START=120500");
    expect(ffmetadata).toContain("END=350000");
    expect(ffmetadata).toContain("title=Chapter 2: The Void");
  });

  test("generates FFmpeg filter chain with EBU R128 loudnorm (-19 LUFS) and no room noise", () => {
    const clips = [
      { filePath: "line_0.wav", pause_duration_seconds: 0.0 },
      { filePath: "line_1.wav", pause_duration_seconds: 0.45 },
      { filePath: "line_2.wav", pause_duration_seconds: 0.25 }
    ];

    const { filter_chain_string, output_label } = build_ffmpeg_filter_chain(clips, -19);

    expect(output_label).toBe("master_audio_out");
    expect(filter_chain_string).toContain("apad=pad_dur=0.45");
    expect(filter_chain_string).toContain("apad=pad_dur=0.25");
    expect(filter_chain_string).toContain("concat=n=3:v=0:a=1");
    expect(filter_chain_string).toContain("loudnorm=I=-19:TP=-1.5:LRA=11");
    // Strictly assert NO room noise / anoisesrc is generated
    expect(filter_chain_string).not.toContain("anoisesrc");
    expect(filter_chain_string).not.toContain("room_tone");
  });
});


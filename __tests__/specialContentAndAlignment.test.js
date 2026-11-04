// =========================================================================
// UNIT TESTS: SPECIAL CONTENT, FORCED ALIGNMENT & PIPELINE METRICS
// =========================================================================
// WHAT: Unit tests for:
//       1. Inner thoughts & italics detection.
//       2. Filtered voice acoustic presets (phone, radio, wall).
//       3. Epistolary reader resolution (sender vs recipient vs narrator).
//       4. Minor character walk-on voice pooling.
//       5. Word-level timestamps, WebVTT, and EPUB3 SMIL media overlays.
//       6. Production telemetry metrics (review mins/hr, false positive rate).
// WHY: Proves that special literary content, word-level forced alignment, and production
//      telemetry are accurately computed according to pure functional domain invariants.

const path_library = require("path");
const filesystem_library = require("fs");
const os_library = require("os");

const {
  ACOUSTIC_FILTER_PRESETS,
  detect_inner_thought_content,
  resolve_acoustic_filter_chain,
  resolve_epistolary_reader_speaker,
  assign_minor_character_voice_pool
} = require("../services/special_content_service");

const {
  compute_word_level_timestamps,
  format_seconds_to_webvtt_timestamp,
  export_webvtt_cues,
  export_epub3_smil_media_overlay
} = require("../services/forced_alignment_service");

const {
  calculate_pipeline_telemetry_metrics,
  save_pipeline_metrics,
  load_pipeline_metrics
} = require("../services/pipeline_metrics_service");

describe("Special Content 1: Inner Thoughts & Italics Detection", () => {
  test("detects italicized inner thoughts with intimate delivery cues", () => {
    const thought_segment = {
      text: "*I cannot let them find the terminal coordinates.*",
      direction: "(nervous)"
    };

    const result = detect_inner_thought_content(thought_segment);
    expect(result.is_inner_thought).toBe(true);
    expect(result.thought_text).toBe("I cannot let them find the terminal coordinates.");
    expect(result.delivery_cues.distance).toBe("intimate");
    expect(result.delivery_cues.expression).toBe("suppressed");
  });

  test("detects thought speech verbs in direction or text", () => {
    const thought_segment = {
      text: "This is a trap, Marcus thought to himself.",
      direction: "(whispered thought)"
    };

    const result = detect_inner_thought_content(thought_segment);
    expect(result.is_inner_thought).toBe(true);
    expect(result.delivery_cues.distance).toBe("intimate");
  });

  test("returns standard conversational cues for ordinary dialogue", () => {
    const dialogue_segment = {
      type: "dialogue",
      text: "Hand me the wrench right now.",
      direction: "(direct)"
    };

    const result = detect_inner_thought_content(dialogue_segment);
    expect(result.is_inner_thought).toBe(false);
    expect(result.delivery_cues.distance).toBe("conversational");
  });
});

describe("Special Content 2: Acoustic Filter Chains (Phone, Radio, Wall)", () => {
  test("resolves authentic bandpass filter strings for transmission contexts", () => {
    const phone_filter = resolve_acoustic_filter_chain("phone_call");
    expect(phone_filter).toContain("highpass=f=300");
    expect(phone_filter).toContain("lowpass=f=3400");

    const radio_filter = resolve_acoustic_filter_chain("radio_intercom");
    expect(radio_filter).toContain("highpass=f=450");
    expect(radio_filter).toContain("lowpass=f=2800");

    const wall_filter = resolve_acoustic_filter_chain("through_wall");
    expect(wall_filter).toContain("lowpass=f=550");

    const fallback_filter = resolve_acoustic_filter_chain("unknown_filter");
    expect(fallback_filter).toBe("anull");
  });
});

describe("Special Content 3: Epistolary Documents & Minor Character Pooling", () => {
  test("resolves epistolary reader according to book policy", () => {
    const context = {
      sender_character: "Captain Harris",
      recipient_character: "Elena",
      narrator_voice: "Narrator"
    };

    const sender_reading = resolve_epistolary_reader_speaker({
      ...context,
      book_epistolary_policy: "sender_voice"
    });
    expect(sender_reading.resolved_speaker_name).toBe("Captain Harris");

    const recipient_reading = resolve_epistolary_reader_speaker({
      ...context,
      book_epistolary_policy: "recipient_voice"
    });
    expect(recipient_reading.resolved_speaker_name).toBe("Elena");

    const narrator_reading = resolve_epistolary_reader_speaker({
      ...context,
      book_epistolary_policy: "narrator_formal"
    });
    expect(narrator_reading.resolved_speaker_name).toBe("Narrator");
  });

  test("deterministically maps minor walk-on characters to reusable pool", () => {
    const guard_voice_1 = assign_minor_character_voice_pool("Guard 1", "male");
    const guard_voice_2 = assign_minor_character_voice_pool("Guard 1", "male");
    // Must be deterministic across calls
    expect(guard_voice_1.pool_id).toBe(guard_voice_2.pool_id);
    expect(guard_voice_1.base_preset).toBe(guard_voice_2.base_preset);

    const clerk_voice = assign_minor_character_voice_pool("Desk Clerk", "female");
    expect(clerk_voice.pool_id.includes("female")).toBe(true);
  });
});

describe("Forced Alignment & Timestamps", () => {
  test("computes proportional word-level timestamps across take duration", () => {
    const text = "We have to leave now.";
    const total_duration = 1.6; // seconds

    const word_intervals = compute_word_level_timestamps(text, total_duration);
    expect(word_intervals.length).toBe(5);
    expect(word_intervals[0].word).toBe("We");
    expect(word_intervals[0].start_seconds).toBe(0.0);
    expect(word_intervals[4].word).toBe("now.");
    expect(word_intervals[4].end_seconds).toBeCloseTo(1.6, 2);
  });

  test("formats timestamps to WebVTT format", () => {
    const formatted = format_seconds_to_webvtt_timestamp(65.42);
    expect(formatted).toBe("00:01:05.420");
  });

  test("exports valid WebVTT subtitle track cues", () => {
    const word_intervals = [
      { word: "Stop", start_seconds: 0.0, end_seconds: 0.4 },
      { word: "there", start_seconds: 0.4, end_seconds: 0.9 }
    ];

    const vtt_output = export_webvtt_cues(word_intervals, 0);
    expect(vtt_output).toContain("WEBVTT");
    expect(vtt_output).toContain("00:00:00.000 --> 00:00:00.400");
    expect(vtt_output).toContain("Stop");
    expect(vtt_output).toContain("00:00:00.400 --> 00:00:00.900");
    expect(vtt_output).toContain("there");
  });

  test("exports EPUB3 SMIL Media Overlays XML document", () => {
    const smil = export_epub3_smil_media_overlay({
      chapter_id: "chapter_01",
      xhtml_content_document_path: "chapter01.xhtml",
      audio_file_relative_path: "audio/ch01.mp3",
      word_intervals: [
        { word: "Hello", start_seconds: 0.0, end_seconds: 0.5 }
      ]
    });

    expect(smil).toContain('<smil xmlns="http://www.w3.org/ns/SMIL"');
    expect(smil).toContain('epub:textref="chapter01.xhtml"');
    expect(smil).toContain('<audio src="audio/ch01.mp3" clipBegin="0s" clipEnd="0.5s"/>');
  });
});

describe("Pipeline Telemetry & QC Efficiency Metrics", () => {
  test("calculates review minutes per hour, false positive rate, and re-render rate", () => {
    const telemetry_payload = {
      total_screenplay_segments_count: 500,
      total_audio_runtime_seconds: 7200, // 2.0 hours
      flagged_segments_count: 40,        // 40 lines flagged
      human_modified_after_flag_count: 30, // 30 were real errors
      human_accepted_without_edit_count: 10, // 10 were false positives
      total_takes_generated_count: 560,  // 60 re-renders
      defect_counts: {
        stt_mismatch: 22,
        timbre_drift: 12,
        pacing_anomaly: 6
      }
    };

    const metrics = calculate_pipeline_telemetry_metrics(telemetry_payload);

    expect(metrics.total_screenplay_segments).toBe(500);
    expect(metrics.total_audio_runtime_hours).toBe(2.0);
    // Estimated review time: 40 flags * 1.5 min = 60 min total = 30 min/hr of audio
    expect(metrics.review_minutes_per_hour).toBe(30.0);
    expect(metrics.flagged_line_rate_percentage).toBe(8.0); // 40 / 500 = 8%
    expect(metrics.false_positive_qc_rate).toBe(25.0); // 10 / 40 = 25%
    expect(metrics.re_render_rate_percentage).toBe(12.0); // 60 / 500 = 12%
    expect(metrics.defect_breakdown.stt_mismatch).toBe(22);
  });

  test("persists and retrieves pipeline metrics to disk", () => {
    const temp_dir = path_library.join(os_library.tmpdir(), "metrics_test_" + Date.now());
    const project_name = "test_telemetry_book";

    const payload = calculate_pipeline_telemetry_metrics({
      total_screenplay_segments_count: 100,
      total_audio_runtime_seconds: 1800,
      flagged_segments_count: 5,
      human_modified_after_flag_count: 4,
      human_accepted_without_edit_count: 1,
      total_takes_generated_count: 105
    });

    const saved = save_pipeline_metrics(temp_dir, project_name, payload);
    expect(saved).toBe(true);

    const loaded = load_pipeline_metrics(temp_dir, project_name);
    expect(loaded).not.toBeNull();
    expect(loaded.total_screenplay_segments).toBe(100);
    expect(loaded.flagged_line_rate_percentage).toBe(5.0);

    // Clean up
    if (filesystem_library.existsSync(temp_dir)) {
      filesystem_library.rmSync(temp_dir, { recursive: true, force: true });
    }
  });
});


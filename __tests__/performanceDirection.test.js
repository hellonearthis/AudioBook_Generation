// =========================================================================
// UNIT TESTS: PERFORMANCE DIRECTION & SUBTEXT STAGING SERVICE
// =========================================================================
// WHAT: Tests subtext (displayed vs felt emotion), acoustic distance (intimate vs projected),
//       physical states, word emphasis, human director notes, and dramatic pause timing.
// WHY: Proves that vocal acting nuance underneath and between dialogue lines is
//      faithfully translated into audio instructions and timeline assembly pauses.

const {
  ACOUSTIC_DISTANCE_LEVELS,
  create_dialogue_performance_direction,
  compile_advanced_auk_performance_instruction,
  compute_deterministic_timing_jitter,
  derive_dramatic_pause_timing
} = require("../services/performance_direction_service");

const {
  generate_prompt_ablation_ladder
} = require("../scripts/ablation_prompt_tester");

const {
  compute_inter_segment_pause_duration
} = require("../services/audio_mastering_service");

describe("Performance Direction 1: Subtext & Layered Prompt Compilation", () => {
  test("compiles prompt with surface calm and underlying seething anger subtext", () => {
    const direction_record = {
      speakingCharacterIdentifier: "josh",
      addresseeCharacterIdentifier: "maren",
      distanceBetweenSpeakerAndListener: ACOUSTIC_DISTANCE_LEVELS.CONVERSATIONAL,
      displayedEmotion: { emotion: "calm", intensityBand: 1 },
      feltEmotion: { emotion: "angry", intensityBand: 4 },
      expressionMode: "suppressed",
      physicalStateTags: ["tired"],
      emphasizedWordsInLine: ["you"],
      directorNoteFromHuman: "quieter, she is holding back tears"
    };

    const compiled_instruction = compile_advanced_auk_performance_instruction(
      direction_record,
      "I told you everything I knew."
    );

    // Verify all layers are present in instruction
    expect(compiled_instruction).toContain("Speaking to maren");
    expect(compiled_instruction).toContain("Surface delivery is steady");
    expect(compiled_instruction).toContain("underlying suppressed furious subtext");
    expect(compiled_instruction).toContain("tightly held-back, suppressed cadence");
    expect(compiled_instruction).toContain("Physical state: tired");
    expect(compiled_instruction).toContain("emphasizing the word(s) 'you'");
    expect(compiled_instruction).toContain("[Director: quieter, she is holding back tears]");
    expect(compiled_instruction).toContain("'I told you everything I knew.'");
  });

  test("compiles prompt for intimate whispered proximity", () => {
    const direction_record = {
      speakingCharacterIdentifier: "elena",
      addresseeCharacterIdentifier: "marcus",
      distanceBetweenSpeakerAndListener: ACOUSTIC_DISTANCE_LEVELS.INTIMATE,
      displayedEmotion: { emotion: "fearful", intensityBand: 2 },
      feltEmotion: { emotion: "fearful", intensityBand: 2 },
      expressionMode: "suppressed"
    };

    const compiled = compile_advanced_auk_performance_instruction(
      direction_record,
      "Don't turn around."
    );

    expect(compiled).toContain("close, intimate proximity");
    expect(compiled).toContain("Delivery is anxious");
  });

  test("compiles prompt for projected voice across distance", () => {
    const direction_record = {
      speakingCharacterIdentifier: "marcus",
      addresseeCharacterIdentifier: "crew",
      distanceBetweenSpeakerAndListener: ACOUSTIC_DISTANCE_LEVELS.PROJECTED,
      displayedEmotion: { emotion: "angry", intensityBand: 4 },
      feltEmotion: { emotion: "angry", intensityBand: 4 },
      expressionMode: "released"
    };

    const compiled = compile_advanced_auk_performance_instruction(
      direction_record,
      "Everyone to the airlock now!"
    );

    expect(compiled).toContain("Projecting voice across distance to crew");
    expect(compiled).toContain("open, uninhibited vocal release");
  });
});

describe("Performance Direction 2: Dramatic Pause & Timing Derivation", () => {
  test("derives zero pause before line when previous speaker was cut off / interrupted", () => {
    const preceding_segment = {
      speaker: "Josh",
      text: "I was only trying to protect--"
    };
    const current_segment = {
      speaker: "Maren",
      text: "You were trying to protect yourself!"
    };

    const timing = derive_dramatic_pause_timing(current_segment, preceding_segment);
    expect(timing.seconds_before).toBe(0.0); // Clean interruption snap
  });

  test("derives extended hesitation pause when subtext tension gap is large", () => {
    const current_segment = {
      speaker: "Elena",
      text: "Yes. I understand.",
      displayedEmotion: { emotion: "calm", intensityBand: 1 },
      feltEmotion: { emotion: "angry", intensityBand: 4 } // Tension gap = 3
    };

    const timing = derive_dramatic_pause_timing(current_segment, null, { enable_jitter: false });
    expect(timing.seconds_before).toBe(0.95);
  });

  test("derives extended pause after line when speaker trails off with ellipsis", () => {
    const current_segment = {
      speaker: "Josh",
      text: "I thought maybe after everything..."
    };

    const timing = derive_dramatic_pause_timing(current_segment, null, { enable_jitter: false });
    expect(timing.seconds_after).toBe(0.85);
  });

  test("applies reproducible deterministic timing jitter within bounds", () => {
    const segment = { line_id: "line_42", text: "Testing jitter" };
    const jitter_1 = compute_deterministic_timing_jitter("line_42");
    const jitter_2 = compute_deterministic_timing_jitter("line_42");
    // Must be deterministic and reproducible across calls
    expect(jitter_1).toBe(jitter_2);
    // Must remain within +/- 12% bounds (0.88 to 1.12)
    expect(jitter_1).toBeGreaterThanOrEqual(0.88);
    expect(jitter_1).toBeLessThanOrEqual(1.12);
  });
});

describe("Performance Direction 3: Audio Mastering Pause Resolution", () => {
  test("mastering pause duration cuts to 0.0s when previous speaker was interrupted", () => {
    const previous = {
      speaker: "Marcus",
      text: "Wait, we haven't checked the--",
      lineIsInterruptedByNextSpeaker: true
    };
    const current = {
      speaker: "Elena",
      text: "There is no time!"
    };

    const pause_seconds = compute_inter_segment_pause_duration(previous, current);
    expect(pause_seconds).toBe(0.0);
  });

  test("mastering pause duration respects secondsOfSilenceBeforeLine override", () => {
    const previous = { speaker: "Marcus", text: "Did you take it?" };
    const current = {
      speaker: "Josh",
      text: "No.",
      secondsOfSilenceBeforeLine: 1.4 // Long dramatic hesitation
    };

    const pause_seconds = compute_inter_segment_pause_duration(previous, current);
    expect(pause_seconds).toBe(1.4);
  });

  test("derives trailing hesitation when speaker trails off on their own dash (self-interruption)", () => {
    const preceding_segment = {
      speaker: "Josh",
      text: "I just thought that--"
    };
    const current_segment = {
      speaker: "Josh",
      text: "Never mind."
    };

    const timing = derive_dramatic_pause_timing(current_segment, preceding_segment, { enable_jitter: false });
    expect(timing.is_cross_speaker_interruption).toBe(false);
    expect(timing.seconds_before).toBe(0.75); // Self-trailing silence
  });

  test("resolves human director override by suppressing conflicting AI emotional staging", () => {
    const direction_record = {
      speakingCharacterIdentifier: "elena",
      addresseeCharacterIdentifier: "marcus",
      distanceBetweenSpeakerAndListener: ACOUSTIC_DISTANCE_LEVELS.INTIMATE,
      displayedEmotion: { emotion: "calm", intensityBand: 1 },
      feltEmotion: { emotion: "angry", intensityBand: 5 }, // AI staged extreme rage
      directorNoteFromHuman: "quieter, she is holding back tears" // Human director override
    };

    const clean_override_prompt = compile_advanced_auk_performance_instruction(
      direction_record,
      "I know what you did.",
      { resolve_human_override: true }
    );

    // Human note is present
    expect(clean_override_prompt).toContain("[Director: quieter, she is holding back tears]");
    // Conflicting AI rage subtext is suppressed
    expect(clean_override_prompt).not.toContain("underlying suppressed");
  });

  test("generates 8-stage prompt ablation ladder with risk telemetry", () => {
    const ladder = generate_prompt_ablation_ladder(
      "I told you everything I knew.",
      {
        speakingCharacterIdentifier: "josh",
        addresseeCharacterIdentifier: "maren",
        displayedEmotion: { emotion: "calm", intensityBand: 1 },
        feltEmotion: { emotion: "angry", intensityBand: 4 },
        emphasizedWordsInLine: ["you"],
        directorNoteFromHuman: "quieter, holding back tears"
      }
    );

    expect(ladder.length).toBe(8);
    expect(ladder[0].name).toBe("Bare Baseline");
    expect(ladder[7].name).toBe("Human Director Override");
    expect(ladder[0].leakage_risk).toBe("low");
    expect(ladder.every(lvl => lvl.instruction_word_count > 0)).toBe(true);
  });
});


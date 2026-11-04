// =========================================================================
// UNIT TESTS: EMOTIONAL ARC & INTENSITY MODELING
// =========================================================================
// WHAT: Tests dynamic emotional intensity progression, exponential decay,
//       expression axis (suppressed vs released), relationship baseline floors,
//       and band-calibrated speaker drift thresholds.
// WHY: Proves that vocal intensity builds, decays, and maps to speech models smoothly.

const {
  map_intensity_value_to_band_number,
  resolve_emotional_intensity_band,
  update_character_emotional_intensity,
  resolve_relationship_emotional_baseline,
  compile_auk_emotional_instruction,
  get_calibrated_drift_threshold
} = require("../services/emotional_arc_service");

const {
  evaluate_speaker_timbre_drift
} = require("../services/voice_drift_qc_service");

describe("Emotional Arc 1: Discrete Intensity Bands", () => {
  test("maps continuous 0..1 intensity values into 1..5 integer bands", () => {
    expect(map_intensity_value_to_band_number(0.05)).toBe(1);
    expect(map_intensity_value_to_band_number(0.30)).toBe(2);
    expect(map_intensity_value_to_band_number(0.55)).toBe(3);
    expect(map_intensity_value_to_band_number(0.75)).toBe(4);
    expect(map_intensity_value_to_band_number(0.95)).toBe(5);
  });

  test("resolves calibrated vocal adjectives for canonical emotions across bands", () => {
    const mild_anger = resolve_emotional_intensity_band("angry", 0.15);
    expect(mild_anger.band).toBe(1);
    expect(mild_anger.label).toBe("irritated");

    const intense_anger = resolve_emotional_intensity_band("angry", 0.80);
    expect(intense_anger.band).toBe(4);
    expect(intense_anger.label).toBe("furious");

    const high_fear = resolve_emotional_intensity_band("fearful", 0.80);
    expect(high_fear.band).toBe(4);
    expect(high_fear.label).toBe("terrified");

    const extreme_sadness = resolve_emotional_intensity_band("sad", 0.95);
    expect(extreme_sadness.band).toBe(5);
    expect(extreme_sadness.label).toBe("despairing");
  });
});

describe("Emotional Arc 2: Dynamic State Progression & Exponential Decay", () => {
  test("gradually decays elevated emotional intensity toward baseline over lines", () => {
    const elevated_anger = 0.85;
    const neutral_baseline = 0.20;

    // After 1 line without trigger
    const after_line_one = update_character_emotional_intensity({
      previous_intensity: elevated_anger,
      baseline_intensity: neutral_baseline,
      trigger_strength: 0.0,
      lines_since_last_trigger: 1,
      decay_rate_per_line: 0.15
    });
    expect(after_line_one).toBeLessThan(elevated_anger);
    expect(after_line_one).toBeGreaterThan(neutral_baseline);

    // After 5 lines without trigger
    const after_line_five = update_character_emotional_intensity({
      previous_intensity: elevated_anger,
      baseline_intensity: neutral_baseline,
      trigger_strength: 0.0,
      lines_since_last_trigger: 5,
      decay_rate_per_line: 0.15
    });
    expect(after_line_five).toBeLessThan(after_line_one);
    expect(after_line_five).toBeCloseTo(0.488, 2);
  });

  test("escalates intensity when receiving line trigger", () => {
    const previous = 0.40;
    const updated = update_character_emotional_intensity({
      previous_intensity: previous,
      baseline_intensity: 0.20,
      trigger_strength: 0.25,
      lines_since_last_trigger: 1
    });

    expect(updated).toBeGreaterThan(previous);
    expect(updated).toBeLessThanOrEqual(1.0);
  });

  test("smooths sudden jumps between adjacent lines unless trigger is explosive", () => {
    // Normal moderate trigger (+0.30): jump is smoothed
    const smoothed = update_character_emotional_intensity({
      previous_intensity: 0.20,
      baseline_intensity: 0.20,
      trigger_strength: 0.35,
      max_adjacent_jump: 0.20
    });
    expect(smoothed).toBe(0.40); // Clamped to 0.20 + 0.20 max jump

    // Explosive trigger (+0.50 e.g. violent shout or betrayal): permitted to break jump clamp
    const explosive = update_character_emotional_intensity({
      previous_intensity: 0.20,
      baseline_intensity: 0.20,
      trigger_strength: 0.50,
      max_adjacent_jump: 0.20
    });
    expect(explosive).toBe(0.70); // Explosive jump honored
  });
});

describe("Emotional Arc 3: Relationship State Baselines", () => {
  test("establishes elevated baseline tension for hostile or tense relationships", () => {
    expect(resolve_relationship_emotional_baseline("hostile", "tense")).toBe(0.55);
    expect(resolve_relationship_emotional_baseline("tense", "guarded")).toBe(0.40);
    expect(resolve_relationship_emotional_baseline("estranged", "distant")).toBe(0.35);
    expect(resolve_relationship_emotional_baseline("warm", "affectionate")).toBe(0.15);
    expect(resolve_relationship_emotional_baseline("neutral", "formal")).toBe(0.20);
  });
});

describe("Emotional Arc 4: Dual-Axis Expression (Suppressed vs Released)", () => {
  test("synthesizes distinct prompt instructions for suppressed vs released delivery", () => {
    const dialogue = "I told you never to speak of that night again.";

    // Suppressed anger
    const suppressed_prompt = compile_auk_emotional_instruction({
      emotion: "angry",
      intensity_value: 0.80,
      expression: "suppressed",
      dialogue_text: dialogue
    });
    expect(suppressed_prompt).toContain("in a tight, suppressed, quiet, and controlled manner");
    expect(suppressed_prompt).toContain("furious delivery");
    expect(suppressed_prompt).toContain("intensity 4/5");

    // Released anger
    const released_prompt = compile_auk_emotional_instruction({
      emotion: "angry",
      intensity_value: 0.80,
      expression: "released",
      dialogue_text: dialogue
    });
    expect(released_prompt).toContain("in an open, dynamic, outward, and projecting manner");
    expect(released_prompt).toContain("furious delivery");
  });
});

describe("Emotional Arc 5: Intensity-Calibrated Speaker Drift Thresholds", () => {
  test("calibrates drift threshold by intensity band", () => {
    expect(get_calibrated_drift_threshold(1)).toBe(0.75); // Neutral requires high similarity
    expect(get_calibrated_drift_threshold(3)).toBe(0.70); // Pronounced
    expect(get_calibrated_drift_threshold(5)).toBe(0.60); // Screams/crying allow lower similarity
  });

  test("accepts dramatic high-intensity takes that would be falsely flagged under flat threshold", () => {
    const neutral_anchor = [0.8, 0.6, 0.1, 0.0];
    // High-intensity screaming take (vocal deformation results in similarity ~0.68)
    const screaming_take = [0.45, 0.35, 0.6, 0.4];

    // Under flat baseline threshold (0.75), this would be wrongly flagged as drift outlier
    const flat_check = evaluate_speaker_timbre_drift(screaming_take, neutral_anchor, 0.75);
    expect(flat_check.is_drift_outlier).toBe(true);
    expect(flat_check.similarity_score).toBe(0.6819);

    // Under intensity-calibrated threshold for Band 5 (0.60), this legitimate shout PASSES
    const calibrated_check = evaluate_speaker_timbre_drift(screaming_take, neutral_anchor, 0.75, 5);
    expect(calibrated_check.is_drift_outlier).toBe(false);
    expect(calibrated_check.effective_threshold).toBe(0.60);
  });
});

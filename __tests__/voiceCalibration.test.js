// =========================================================================
// UNIT TESTS: VOICE CALIBRATION & CAPABILITY PROFILING SERVICE
// =========================================================================
// WHAT: Unit tests for empirical character voice capability profiling,
//       audition take cell evaluations, maximum intensity band capping,
//       and acoustic compensation remapping.
// WHY: Ensures that voices are measured empirically before production synthesis,
//      preventing vocal timbre distortion and robotic artifacts in extreme scenes.

const path_library = require("path");
const filesystem_library = require("fs");
const os_library = require("os");

const {
  CALIBRATION_AUDITION_SENTENCES,
  initialize_character_calibration_profile,
  evaluate_calibration_take_cell,
  derive_character_capability_caps,
  remap_staging_intensity_for_character,
  extract_calibration_candidate_lines_from_manuscript,
  resolve_character_calibration_profile_path,
  load_character_calibration_profile,
  save_character_calibration_profile
} = require("../services/voice_calibration_service");

const {
  verify_cross_character_identity_margin
} = require("../services/voice_drift_qc_service");

describe("Voice Calibration 1: Profile Initialization & Sentences", () => {
  test("provides standardized multi-length audition sentences", () => {
    expect(CALIBRATION_AUDITION_SENTENCES.short).toBeDefined();
    expect(CALIBRATION_AUDITION_SENTENCES.medium).toBeDefined();
    expect(CALIBRATION_AUDITION_SENTENCES.long).toBeDefined();
    expect(CALIBRATION_AUDITION_SENTENCES.suppressed_tension).toBeDefined();
    expect(CALIBRATION_AUDITION_SENTENCES.whisper_caution).toBeDefined();
  });

  test("initializes standardized profile schema with default band thresholds", () => {
    const profile = initialize_character_calibration_profile(
      "Josh Henderson",
      "voices/josh/neutral_reference.wav",
      "AuK-08"
    );

    expect(profile.version).toBe("1.0.0");
    expect(profile.character_identifier).toBe("josh_henderson");
    expect(profile.neutral_reference_clip_path).toBe("voices/josh/neutral_reference.wav");
    expect(profile.model_version_used_for_calibration).toBe("AuK-08");
    expect(profile.identity_similarity_threshold_by_band.band1).toBe(0.75);
    expect(profile.identity_similarity_threshold_by_band.band5).toBe(0.60);
    expect(profile.calibrated_emotion_bands).toEqual({});
  });
});

describe("Voice Calibration 2: Audition Cell Evaluation", () => {
  // WHAT: Reference anchor vector for testing similarity.
  const reference_anchor = [1.0, 0.0, 0.0, 0.0];

  test("passes take with high similarity, good STT, and normal pacing", () => {
    const take_result = evaluate_calibration_take_cell({
      emotion: "anger",
      band_number: 2,
      take_embedding_vector: [0.95, 0.05, 0.0, 0.0],
      reference_anchor_vector: reference_anchor,
      stt_accuracy_percentage: 96.0,
      chars_per_second: 15.0
    });

    expect(take_result.passed).toBe(true);
    expect(take_result.identity_similarity_score).toBeGreaterThanOrEqual(0.73);
    expect(take_result.failure_reasons.length).toBe(0);
    expect(take_result.band_label).toBe("frustrated");
  });

  test("fails take when timbre similarity falls below calibrated band threshold", () => {
    const take_result = evaluate_calibration_take_cell({
      emotion: "anger",
      band_number: 1, // Band 1 threshold is 0.75
      take_embedding_vector: [0.5, 0.5, 0.5, 0.5], // Sim = 0.5
      reference_anchor_vector: reference_anchor,
      stt_accuracy_percentage: 98.0,
      chars_per_second: 14.0
    });

    expect(take_result.passed).toBe(false);
    expect(take_result.failure_reasons.some(r => r.includes("Timbre similarity"))).toBe(true);
  });

  test("fails take when STT accuracy falls below 85% requirement", () => {
    const take_result = evaluate_calibration_take_cell({
      emotion: "fear",
      band_number: 4,
      take_embedding_vector: [0.9, 0.1, 0.0, 0.0],
      reference_anchor_vector: reference_anchor,
      stt_accuracy_percentage: 72.0, // Failed STT
      chars_per_second: 16.0
    });

    expect(take_result.passed).toBe(false);
    expect(take_result.failure_reasons.some(r => r.includes("STT accuracy"))).toBe(true);
  });

  test("fails take when speech pacing indicates severe anomaly", () => {
    const take_result = evaluate_calibration_take_cell({
      emotion: "sadness",
      band_number: 2,
      take_embedding_vector: [0.95, 0.05, 0.0, 0.0],
      reference_anchor_vector: reference_anchor,
      stt_accuracy_percentage: 95.0,
      chars_per_second: 3.5 // Way too slow (below 7.5 cps)
    });

    expect(take_result.passed).toBe(false);
    expect(take_result.failure_reasons.some(r => r.includes("Pacing anomaly"))).toBe(true);
  });
});

describe("Voice Calibration 3: Capability Caps & Learned Thresholds", () => {
  test("derives maximum passing band caps per emotion across grid", () => {
    const sample_calibration_grid = {
      anger: {
        band_1: { passed: true, identity_similarity_score: 0.88 },
        band_2: { passed: true, identity_similarity_score: 0.84 },
        band_3: { passed: true, identity_similarity_score: 0.78 },
        band_4: { passed: false, identity_similarity_score: 0.58 }, // Timbre distortion
        band_5: { passed: false, identity_similarity_score: 0.45 }
      },
      joy: {
        band_1: { passed: true, identity_similarity_score: 0.90 },
        band_2: { passed: true, identity_similarity_score: 0.86 },
        band_3: { passed: true, identity_similarity_score: 0.82 },
        band_4: { passed: true, identity_similarity_score: 0.79 },
        band_5: { passed: true, identity_similarity_score: 0.74 }
      }
    };

    const capability_analysis = derive_character_capability_caps(sample_calibration_grid);

    // Anger should be capped at Band 3 because Band 4 failed
    expect(capability_analysis.capped_maximum_band_by_emotion.anger).toBe(3);
    // Joy should reach Band 5
    expect(capability_analysis.capped_maximum_band_by_emotion.joy).toBe(5);
  });
});

describe("Voice Calibration 4: Downward Remapping & Acoustic Compensation", () => {
  const profile_with_anger_cap_3 = {
    character_identifier: "marcus",
    capped_maximum_band_by_emotion: {
      anger: 3
    }
  };

  test("allows requests within character capability unconstrained", () => {
    const staging_request = {
      emotion: "anger",
      requested_band: 2,
      calibration_profile: profile_with_anger_cap_3
    };

    const remapped = remap_staging_intensity_for_character(staging_request);
    expect(remapped.was_capped).toBe(false);
    expect(remapped.effective_band).toBe(2);
    expect(Object.keys(remapped.compensation_rules).length).toBe(0);
  });

  test("caps excessive intensity and injects acoustic compensation cues", () => {
    const staging_request = {
      emotion: "anger",
      requested_band: 5, // Demands furious screaming
      calibration_profile: profile_with_anger_cap_3
    };

    const remapped = remap_staging_intensity_for_character(staging_request);
    expect(remapped.was_capped).toBe(true);
    expect(remapped.effective_band).toBe(3);
    expect(remapped.original_requested_band).toBe(5);
    // Compensation rules: slower cold delivery, longer pauses, suppressed expression
    expect(remapped.compensation_rules.pacing_speed_ratio).toBe(0.88);
    expect(remapped.compensation_rules.inter_segment_pause_multiplier).toBe(1.35);
    expect(remapped.compensation_rules.expression_override).toBe("suppressed");
    expect(remapped.compensation_rules.delivery_compensation_note).toContain("compensating with tight");
  });
});

describe("Voice Calibration 5: Disk Persistence Round-Trip", () => {
  const temporary_workspace_directory = path_library.join(os_library.tmpdir(), "calibration_test_workspace_" + Date.now());
  const project_name = "test_audiobook_project";
  const character_name = "dr_alec_trent";

  afterAll(() => {
    if (filesystem_library.existsSync(temporary_workspace_directory)) {
      filesystem_library.rmSync(temporary_workspace_directory, { recursive: true, force: true });
    }
  });

  test("saves and loads character calibration profile accurately", () => {
    const profile_payload = initialize_character_calibration_profile(
      character_name,
      "voices/alec/neutral.wav",
      "AuK-08"
    );
    profile_payload.capped_maximum_band_by_emotion.anger = 3;
    profile_payload.capped_maximum_band_by_emotion.whisper = 4;

    const save_success = save_character_calibration_profile(
      temporary_workspace_directory,
      project_name,
      character_name,
      profile_payload
    );
    expect(save_success).toBe(true);

    const loaded_profile = load_character_calibration_profile(
      temporary_workspace_directory,
      project_name,
      character_name
    );
    expect(loaded_profile).not.toBeNull();
    expect(loaded_profile.character_identifier).toBe("dr_alec_trent");
    expect(loaded_profile.capped_maximum_band_by_emotion.anger).toBe(3);
    expect(loaded_profile.capped_maximum_band_by_emotion.whisper).toBe(4);
  });
});

describe("Voice Calibration 6: Cross-Character Identity Margin", () => {
  const intended_character_reference = [1.0, 0.0, 0.0, 0.0]; // Character A
  const competing_character_b = [0.0, 1.0, 0.0, 0.0];         // Character B
  const competing_character_c = [0.1, 0.9, 0.0, 0.0];         // Character C

  const competing_cast_map = {
    character_b: competing_character_b,
    character_c: competing_character_c
  };

  test("passes when take is significantly closer to intended character than competitors", () => {
    // Take vector close to Character A
    const take_vector_a = [0.92, 0.15, 0.0, 0.0];
    const margin_check = verify_cross_character_identity_margin(
      take_vector_a,
      intended_character_reference,
      competing_cast_map,
      0.05
    );

    expect(margin_check.passed).toBe(true);
    expect(margin_check.margin_delta).toBeGreaterThanOrEqual(0.05);
    expect(margin_check.warning_message).toBeNull();
  });

  test("fails when take is closer to another cast member (impostor detection)", () => {
    // Take vector rendered with Character B's voice by mistake
    const impostor_take_vector = [0.20, 0.95, 0.0, 0.0];
    const margin_check = verify_cross_character_identity_margin(
      impostor_take_vector,
      intended_character_reference,
      competing_cast_map,
      0.05
    );

    expect(margin_check.passed).toBe(false);
    expect(["character_b", "character_c"]).toContain(margin_check.closest_competitor_id);
    expect(margin_check.margin_delta).toBeLessThan(0);
    expect(margin_check.warning_message).toContain("Cross-character identity conflict");
  });

  test("evaluate_calibration_take_cell fails take when cross-character margin breached", () => {
    // Take has 0.62 similarity to A (which passes absolute Band 5 threshold 0.60),
    // but 0.88 similarity to B!
    const take_result = evaluate_calibration_take_cell({
      emotion: "angry",
      band_number: 5,
      take_embedding_vector: [0.35, 0.90, 0.0, 0.0],
      reference_anchor_vector: intended_character_reference,
      competing_cast_reference_vectors: competing_cast_map,
      stt_accuracy_percentage: 95.0,
      chars_per_second: 15.0
    });

    expect(take_result.passed).toBe(false);
    expect(take_result.failure_reasons.some(r => r.includes("Cross-character identity conflict"))).toBe(true);
  });
});

describe("Voice Calibration 7: Extracting Test Lines from Book Manuscript", () => {
  const sample_screenplay_segments = [
    {
      id: "line_1",
      speaker: "Narrator",
      text: "The night air hung thick and cold over the command deck.",
      type: "action",
      emotion: "neutral",
      intensity: 0.1
    },
    {
      id: "line_2",
      speaker: "Marcus",
      text: "We need to verify the hull seal before we initiate atmospheric decompression.",
      type: "dialogue",
      emotion: "calm",
      intensity: 0.2,
      intensity_band: 1,
      direction: "(measured, routine)"
    },
    {
      id: "line_3",
      speaker: "Marcus",
      text: "Get back inside that bulkhead right now or you will vent this entire compartment!",
      type: "dialogue",
      emotion: "angry",
      intensity: 0.78,
      intensity_band: 4,
      direction: "(shouting, terrified urgency)"
    },
    {
      id: "line_4",
      speaker: "Elena",
      text: "The override latch is jammed from the outside!",
      type: "dialogue",
      emotion: "fearful",
      intensity: 0.82,
      intensity_band: 4,
      direction: "(strained, panicking)"
    },
    {
      id: "line_5",
      speaker: "Marcus",
      text: "Stand clear of the seal; I will blow the hydraulic release manually.",
      type: "dialogue",
      emotion: "angry",
      intensity: 0.72,
      intensity_band: 4,
      direction: "(teeth gritted, grim focus)"
    }
  ];

  test("extracts character dialogue lines matching specific emotion and intensity band from book", () => {
    const candidate_lines = extract_calibration_candidate_lines_from_manuscript(
      sample_screenplay_segments,
      "Marcus",
      "angry",
      4
    );

    expect(candidate_lines.length).toBe(2);
    expect(candidate_lines[0].line_id).toBe("line_3");
    expect(candidate_lines[0].text).toContain("Get back inside that bulkhead");
    expect(candidate_lines[0].band).toBe(4);
    expect(candidate_lines[0].emotion).toBe("angry");
    expect(candidate_lines[1].line_id).toBe("line_5");
  });

  test("returns empty array when no book lines match character or criteria", () => {
    const candidate_lines = extract_calibration_candidate_lines_from_manuscript(
      sample_screenplay_segments,
      "Marcus",
      "joy", // Marcus has no happy lines in this scene
      5
    );

    expect(candidate_lines.length).toBe(0);
  });
});


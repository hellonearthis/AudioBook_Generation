// =========================================================================
// UNIT TESTS: QUALITY UPGRADES & EASE-OF-USE SERVICES
// =========================================================================
// WHAT: Tests voice embedding drift, acoustic pacing checks, risk-sorted review queue,
//       character alias/coreference resolution, and rare token discovery.
// WHY: Ensures all new domain modules adhere to pure functional architecture and pass strict contracts.

const {
  evaluate_speech_pacing_and_duration,
  compute_cosine_similarity,
  evaluate_speaker_timbre_drift,
  compute_composite_acoustic_health_score
} = require("../services/voice_drift_qc_service");

const {
  compute_segment_risk_score,
  build_risk_prioritized_review_queue
} = require("../services/triage_risk_service");

const {
  build_character_alias_index,
  resolve_speaker_alias,
  discover_potential_character_aliases
} = require("../services/character_alias_service");

const {
  scan_manuscript_for_rare_tokens
} = require("../services/pronunciation_lexicon_service");

describe("Quality Upgrade 1: Voice Drift & Acoustic Signal QC", () => {
  test("evaluates speech rate and detects pacing anomalies", () => {
    // Normal: 60 chars in 4 seconds = 15 chars/sec
    const normal_pacing = evaluate_speech_pacing_and_duration(
      "The morning sun broke through the heavy grey clouds above.",
      4.0
    );
    expect(normal_pacing.chars_per_second).toBe(14.5);
    expect(normal_pacing.pacing_status).toBe("optimal");
    expect(normal_pacing.anomaly_score).toBe(0.0);

    // Sluggish: 30 chars in 6 seconds = 5 chars/sec
    const sluggish_pacing = evaluate_speech_pacing_and_duration(
      "Wait for me here.",
      6.0
    );
    expect(sluggish_pacing.chars_per_second).toBe(2.83);
    expect(sluggish_pacing.pacing_status).toBe("severe_sluggish");
    expect(sluggish_pacing.anomaly_score).toBeGreaterThan(0.7);

    // Rushed: 100 chars in 3 seconds = 33.3 chars/sec
    const rushed_pacing = evaluate_speech_pacing_and_duration(
      "We cannot afford to linger in this place any longer because the enemy is closing in rapidly on us.",
      3.0
    );
    expect(rushed_pacing.chars_per_second).toBe(32.67);
    expect(rushed_pacing.pacing_status).toBe("severe_rushed");
    expect(rushed_pacing.anomaly_score).toBeGreaterThan(0.7);
  });

  test("computes cosine similarity accurately", () => {
    const vector_alpha = [1.0, 0.5, 0.2];
    const vector_beta = [1.0, 0.5, 0.2];
    const vector_orthogonal = [-0.5, 1.0, 0.0];

    // Identical vectors = 1.0
    expect(compute_cosine_similarity(vector_alpha, vector_beta)).toBe(1.0);

    // Orthogonal vectors = 0.0
    expect(compute_cosine_similarity(vector_alpha, vector_orthogonal)).toBe(0.0);
  });

  test("flags speaker timbre drift when cosine similarity falls below threshold", () => {
    const reference_anchor = [0.8, 0.6, 0.1, 0.0];
    const consistent_take = [0.78, 0.62, 0.11, 0.02];
    const drifted_take = [0.1, 0.2, 0.9, 0.8];

    const consistent_check = evaluate_speaker_timbre_drift(consistent_take, reference_anchor, 0.75);
    expect(consistent_check.is_drift_outlier).toBe(false);
    expect(consistent_check.similarity_score).toBeGreaterThan(0.95);

    const drifted_check = evaluate_speaker_timbre_drift(drifted_take, reference_anchor, 0.75);
    expect(drifted_check.is_drift_outlier).toBe(true);
    expect(drifted_check.warning_message).toContain("Speaker timbre drift detected");
  });

  test("calculates composite multi-signal acoustic health score", () => {
    // Clean take: 98% STT, 0 pacing anomaly, 0 drift
    const clean_score = compute_composite_acoustic_health_score({
      stt_match_pct: 98,
      pacing_anomaly_score: 0.0,
      drift_distance: 0.02
    });
    expect(clean_score.combined_acoustic_score).toBeGreaterThan(0.90);
    expect(clean_score.risk_level).toBe("low");

    // Defective take: 70% STT, 0.85 sluggish pacing, 0.40 timbre drift
    const flawed_score = compute_composite_acoustic_health_score({
      stt_match_pct: 70,
      pacing_anomaly_score: 0.85,
      drift_distance: 0.40
    });
    expect(flawed_score.combined_acoustic_score).toBeLessThan(0.60);
    expect(flawed_score.risk_level).toBe("critical");
  });
});

describe("Ease of Use 1: Risk-Sorted Review Queue ('Listen by Exception')", () => {
  const sample_segments = [
    {
      index_position: 1,
      speaker: "Narrator",
      confidence: 0.98,
      qc: { match_percentage: 97.0 },
      acoustic: { anomaly_score: 0.0 },
      timbre: { drift_distance: 0.02 }
    },
    {
      index_position: 2,
      speaker: "Maren",
      confidence: 0.35, // Low attribution!
      qc: { match_percentage: 95.0 },
      acoustic: { anomaly_score: 0.0 },
      timbre: { drift_distance: 0.05 }
    },
    {
      index_position: 3,
      speaker: "Josh",
      confidence: 0.95,
      qc: { match_percentage: 65.0 }, // STT mismatch!
      acoustic: { anomaly_score: 0.85 }, // Sluggish!
      timbre: { drift_distance: 0.35 }  // Drift outlier!
    },
    {
      index_position: 4,
      speaker: "unknown", // Unresolved!
      confidence: 0.20,
      qc: { match_percentage: 88.0 },
      acoustic: { anomaly_score: 0.10 },
      timbre: { drift_distance: 0.10 }
    }
  ];

  test("computes individual segment risk scores with actionable diagnostic reasons", () => {
    const risk_assessment_two = compute_segment_risk_score(sample_segments[2]);
    expect(risk_assessment_two.risk_tier).toBe("high");
    expect(risk_assessment_two.triage_reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("STT mismatch"),
        expect.stringContaining("Pacing anomaly"),
        expect.stringContaining("Voice timbre drift")
      ])
    );

    const risk_assessment_three = compute_segment_risk_score(sample_segments[3]);
    expect(risk_assessment_three.risk_tier).toBe("critical");
    expect(risk_assessment_three.triage_reasons).toContain("Unresolved speaker identity (marked unknown)");
  });

  test("sorts review queue descending by risk score and slices top exceptions", () => {
    const sorted_queue = build_risk_prioritized_review_queue(sample_segments);

    // Highest risk should be at index 0
    expect(sorted_queue[0].risk_score).toBeGreaterThanOrEqual(sorted_queue[1].risk_score);
    expect(sorted_queue[0].risk_score).toBeGreaterThanOrEqual(sorted_queue[sorted_queue.length - 1].risk_score);

    // Top 50% slice should only return the 2 highest risk items
    const top_half = build_risk_prioritized_review_queue(sample_segments, { top_percentile: 50 });
    expect(top_half).toHaveLength(2);
  });
});

describe("Quality Upgrade 2: Character Alias & Coreference Mapping", () => {
  const cast_profiles = [
    {
      name: "Maren Hale",
      aliases: ["Mare", "Ms. Hale", "the captain"]
    },
    {
      name: "Robert Smith",
      aliases: ["Dr. Smith", "Bob", "Bobby"]
    }
  ];

  test("resolves nicknames and conversational titles to canonical character names", () => {
    const index = build_character_alias_index(cast_profiles);

    expect(resolve_speaker_alias("Mare", index)).toBe("Maren Hale");
    expect(resolve_speaker_alias("Ms. Hale", index)).toBe("Maren Hale");
    expect(resolve_speaker_alias("the captain", index)).toBe("Maren Hale");
    expect(resolve_speaker_alias("Dr. Smith", index)).toBe("Robert Smith");
    expect(resolve_speaker_alias("Bob", index)).toBe("Robert Smith");
    expect(resolve_speaker_alias("Doctor Smith", index)).toBe("Robert Smith");
    expect(resolve_speaker_alias("Unknown Stranger", index)).toBe("Unknown Stranger");
  });

  test("auto-discovers potential honorifics and surnames from manuscript text", () => {
    const manuscript = "Ms. Hale walked across the deck. 'Steady,' Captain Hale called out. Doctor Smith took notes.";
    const discovered = discover_potential_character_aliases(manuscript, ["Maren Hale", "Robert Smith"]);

    expect(discovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonical_name: "Maren Hale", suggested_alias: "Ms. Hale" }),
        expect.objectContaining({ canonical_name: "Maren Hale", suggested_alias: "Captain Hale" }),
        expect.objectContaining({ canonical_name: "Robert Smith", suggested_alias: "Doctor Smith" })
      ])
    );
  });
});

describe("Quality Upgrade 3: Pronunciation Lexicon Auto-Discovery", () => {
  test("scans manuscript for rare capitalized proper nouns and acronyms", () => {
    const sample_text = `
      The CMBR detector flared red. Maren turned to Kaelen and asked,
      'Have you ever seen the Quasar-9 anomaly before?'
      Kaelen shook his head. 'Never, Maren.'
    `;

    const discovered = scan_manuscript_for_rare_tokens(sample_text);

    const token_names = discovered.map(t => t.token);
    expect(token_names).toContain("CMBR");
    expect(token_names).toContain("Maren");
    expect(token_names).toContain("Kaelen");

    const cmbr_entry = discovered.find(t => t.token === "CMBR");
    expect(cmbr_entry.is_acronym).toBe(true);

    const maren_entry = discovered.find(t => t.token === "Maren");
    expect(maren_entry.frequency).toBe(2);
    expect(maren_entry.sample_context).toContain("Maren");
  });
});

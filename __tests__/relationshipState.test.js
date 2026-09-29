/** @jest-environment node */

// =========================================================================
// UNIT TESTS - RELATIONSHIP TIMELINE STATE ENGINE & AuK-08 EMOTION MAPPER
// =========================================================================
// WHAT: Verifies the chronological relationship timeline lookups, delta merging,
//       and AuK-08 emotion normalizations with explicit whisper routing.
// WHY: Ensures Pass 3 directorial staging receives accurate cross-chapter relationship
//      context and routes voice synthesis into the correct post-production pipelines.

const {
  resolve_active_relationship_state_at_segment,
  merge_relationship_state_deltas,
  map_emotion_to_auk08_palette,
  format_active_relationships_summary_for_prompt,
  generate_canonical_relationship_pair_identifier
} = require("../services/relationship_state_service");

describe("Relationship Timeline State Engine (Pass 2.5)", () => {
  const sample_project_relationships_database = [
    {
      id: "josh_maren",
      a: "Maren",
      b: "Josh",
      states: [
        {
          from_segment: 0,
          relation_type: "family",
          relation_tone: "warm",
          status: "current",
          power_dynamic: "a_over_b",
          trigger: null
        },
        {
          from_segment: 214,
          relation_type: "family",
          relation_tone: "tense",
          status: "current",
          power_dynamic: "equal",
          trigger: "Josh finds the forged will",
          evidence: [209, 213]
        }
      ]
    }
  ];

  describe("Chronological State Timeline Lookup", () => {
    test("returns initial 'warm' state prior to the transition segment", () => {
      // WHAT: Testing state lookup before milestone transition.
      // WHY: At segment 50 (before line 214), their relationship must still be warm.
      const resolved_state = resolve_active_relationship_state_at_segment({
        relationships_list: sample_project_relationships_database,
        first_character_name: "Maren",
        second_character_name: "Josh",
        current_segment_index_number: 50
      });

      expect(resolved_state.relation_tone).toBe("warm");
      expect(resolved_state.relation_type).toBe("family");
      expect(resolved_state.trigger).toBeNull();
    });

    test("returns updated 'tense' state after the transition segment with evidence", () => {
      // WHAT: Testing state lookup after milestone transition.
      // WHY: At segment 216 (after line 214), the relationship must be tense due to the forged will.
      const resolved_state = resolve_active_relationship_state_at_segment({
        relationships_list: sample_project_relationships_database,
        first_character_name: "Josh",
        second_character_name: "Maren",
        current_segment_index_number: 216
      });

      expect(resolved_state.relation_tone).toBe("tense");
      expect(resolved_state.trigger).toBe("Josh finds the forged will");
      expect(resolved_state.evidence).toEqual([209, 213]);
    });

    test("resolves bidirectionally regardless of character name ordering", () => {
      // WHAT: Testing name order invariance.
      // WHY: Querying (Josh, Maren) or (Maren, Josh) must yield identical state records.
      const query_a = resolve_active_relationship_state_at_segment({
        relationships_list: sample_project_relationships_database,
        first_character_name: "Josh",
        second_character_name: "Maren",
        current_segment_index_number: 100
      });
      const query_b = resolve_active_relationship_state_at_segment({
        relationships_list: sample_project_relationships_database,
        first_character_name: "Maren",
        second_character_name: "Josh",
        current_segment_index_number: 100
      });

      expect(query_a.relation_tone).toBe(query_b.relation_tone);
      expect(query_a.pair_id).toBe(query_b.pair_id);
    });

    test("defaults to 'stranger' with neutral tone for unacquainted characters", () => {
      // WHAT: Testing stranger fallback.
      // WHY: Characters without recorded interactions default to strangers without crashing.
      const resolved_state = resolve_active_relationship_state_at_segment({
        relationships_list: sample_project_relationships_database,
        first_character_name: "Josh",
        second_character_name: "Unknown Stranger",
        current_segment_index_number: 10
      });

      expect(resolved_state.relation_type).toBe("stranger");
      expect(resolved_state.relation_tone).toBe("neutral");
    });
  });

  describe("Delta Merging from Pass 2.5", () => {
    test("appends newly discovered state transition chronologically", () => {
      // WHAT: Testing state delta appending.
      // WHY: Appending an estrangement at chapter 12 (segment 450) must not overwrite earlier states.
      const updated_database = merge_relationship_state_deltas({
        existing_relationships_list: sample_project_relationships_database,
        incoming_relationship_changes_list: [
          {
            id: "josh_maren",
            a: "Maren",
            b: "Josh",
            from_segment: 450,
            relation_type: "family",
            relation_tone: "hostile",
            status: "estranged",
            power_dynamic: "equal",
            trigger: "Maren testifies against him",
            evidence: [448, 449]
          }
        ]
      });

      const pair_record = updated_database.find((item) => item.id === "josh_maren");
      expect(pair_record.states.length).toBe(3);

      const state_at_line_300 = resolve_active_relationship_state_at_segment({
        relationships_list: updated_database,
        first_character_name: "Josh",
        second_character_name: "Maren",
        current_segment_index_number: 300
      });
      expect(state_at_line_300.relation_tone).toBe("tense");

      const state_at_line_500 = resolve_active_relationship_state_at_segment({
        relationships_list: updated_database,
        first_character_name: "Josh",
        second_character_name: "Maren",
        current_segment_index_number: 500
      });
      expect(state_at_line_500.relation_tone).toBe("hostile");
      expect(state_at_line_500.status).toBe("estranged");
    });
  });

  describe("AuK-08 Emotion Mapping & Whisper Routing", () => {
    test("maps natural language anger descriptors onto AuK-08 'angry' enum", () => {
      // WHAT: Testing emotion mapping to AuK-08 palette.
      // WHY: Free-text descriptions like 'furious snarl' map directly to 'angry'.
      const mapping_result = map_emotion_to_auk08_palette("furious rage", "loud, harsh voice");
      expect(mapping_result.auk08_emotion).toBe("angry");
      expect(mapping_result.workflow_route).toBe("auk_emotion");
      expect(mapping_result.is_whisper).toBe(false);
    });

    test("explicitly routes whispers to AuK-12 whisper conversion workflow", () => {
      // WHAT: Testing explicit whisper routing.
      // WHY: Ensures whisper lines trigger specialized whisper synthesis instead of generic emotion shifts.
      const mapping_result = map_emotion_to_auk08_palette("fearful", "intimate whisper, quiet breathy tone");
      expect(mapping_result.is_whisper).toBe(true);
      expect(mapping_result.workflow_route).toBe("auk_whisper");
    });
  });

  describe("Pass 3 Prompt Formatting", () => {
    test("formats compact relationship context summary for active scene cast", () => {
      // WHAT: Testing prompt summary assembly.
      // WHY: Provides the LLM with active standing relationships without extra noise.
      const active_scene_cast = [
        { id: "josh", name: "Josh" },
        { id: "maren", name: "Maren" }
      ];

      const prompt_summary = format_active_relationships_summary_for_prompt(
        active_scene_cast,
        sample_project_relationships_database,
        220
      );

      expect(prompt_summary).toContain("Josh & Maren: family (tense, current)");
      expect(prompt_summary).toContain("Josh finds the forged will");
    });
  });

  describe("Single Source of Truth Taxonomy & Prompt Interpolation", () => {
    const fs = require("fs");
    const path = require("path");
    const {
      RELATION_TYPES,
      RELATION_TONES,
      STATUSES,
      POWER_DYNAMICS,
      TRANSITIONS,
      format_enum_as_pipe_list,
      format_enum_as_bracket_list
    } = require("../constants/relationship_taxonomy");
    const { apply_relationship_taxonomy_placeholders } = require("../services/ai_pipeline_service");

    test("taxonomy constants contain the exact canonical sets", () => {
      expect(RELATION_TYPES).toEqual([
        "family",
        "romantic",
        "friendship",
        "professional",
        "acquaintance",
        "mentor_student",
        "service",
        "allied",
        "stranger",
        "unknown"
      ]);
      expect(RELATION_TYPES).not.toContain("adversarial"); // Verified dropped as structural type

      expect(RELATION_TONES).toEqual([
        "warm",
        "neutral",
        "tense",
        "competitive",
        "hostile",
        "unknown"
      ]);

      expect(STATUSES).toEqual(["current", "former", "estranged", "developing"]);
      expect(POWER_DYNAMICS).toEqual(["equal", "a_over_b", "b_over_a", "unknown"]);
      expect(TRANSITIONS).toEqual(["instant", "gradual"]);
    });

    test("formats pipe and bracket lists correctly", () => {
      const pipe_result = format_enum_as_pipe_list(["a", "b", "c"]);
      expect(pipe_result).toBe("a | b | c");

      const bracket_result = format_enum_as_bracket_list(["a", "b"]);
      expect(bracket_result).toBe('["a", "b"]');
    });

    test("interpolates cast_discovery.txt with zero unresolved taxonomy placeholders", () => {
      const prompt_raw = fs.readFileSync(path.join(__dirname, "..", "prompts", "cast_discovery.txt"), "utf8");
      const interpolated = apply_relationship_taxonomy_placeholders(prompt_raw);

      expect(interpolated).not.toContain("{{RELATION_TYPE_ENUM_LIST}}");
      expect(interpolated).not.toContain("{{RELATION_TYPE_ENUM_PIPE}}");
      expect(interpolated).toContain("mentor_student");
      expect(interpolated).toContain("allied");
      expect(interpolated).toContain("stranger");
    });

    test("interpolates directorial_orchestration.txt with full 10 relation types and power_dynamic", () => {
      const prompt_raw = fs.readFileSync(path.join(__dirname, "..", "prompts", "directorial_orchestration.txt"), "utf8");
      const interpolated = apply_relationship_taxonomy_placeholders(prompt_raw);

      expect(interpolated).not.toContain("{{RELATION_TYPE_ENUM_PIPE}}");
      expect(interpolated).not.toContain("{{POWER_DYNAMIC_ENUM_PIPE}}");

      // Verifies all 4 previously missing values exist in directorial prompt
      expect(interpolated).toContain("mentor_student");
      expect(interpolated).toContain("acquaintance");
      expect(interpolated).toContain("service");
      expect(interpolated).toContain("allied");

      // Verifies power_dynamic is preserved in output schema
      expect(interpolated).toContain('"power_dynamic": "equal | a_over_b | b_over_a | unknown"');
    });

    test("interpolates relationship_delta.txt with zero unresolved placeholders", () => {
      const prompt_raw = fs.readFileSync(path.join(__dirname, "..", "prompts", "relationship_delta.txt"), "utf8");
      const interpolated = apply_relationship_taxonomy_placeholders(prompt_raw);

      expect(interpolated).not.toContain("{{RELATION_TYPE_ENUM_LIST}}");
      expect(interpolated).not.toContain("{{RELATION_TONE_ENUM_LIST}}");
      expect(interpolated).toContain('"mentor_student"');
    });
  });
});

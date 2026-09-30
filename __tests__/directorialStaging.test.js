const {
  extract_acoustic_cues_from_narrative_context,
  build_directorial_style_for_dialogue,
  enrich_script_segments_with_directorial_staging
} = require("../services/directorial_staging_service");

describe("Directorial Staging & Speech Tag Harvester", () => {
  const mockVoiceMapping = {
    "Inspector Mara": {
      voice: "Eric",
      age: "Adult",
      gender: "Female",
      voiceProfile: "Low, clipped, and controlled; smooth but compressed timbre with minimal inflection, precise diction, and a slow, administrative pace.",
      identityBackground: "Directorate inspector tasked with decommissioning a weaponized structure.",
      traits: "Formal, precise, and duty-bound; outwardly restrained and procedural.",
      currentEmotion: "neutral and observant"
    },
    "Archivist Kaelen": {
      voice: "Eric",
      age: "Adult",
      gender: "Male",
      voiceProfile: "Resonant, reverent, and measured; smooth timbre with ceremonial pacing.",
      identityBackground: "Custodian or designer of the cloister-silo-pavilion complex.",
      traits: "Reverent, poetic, and custodial.",
      currentEmotion: "neutral and observant"
    }
  };

  test("accurately extracts explicit vocal clause from succeeding context", () => {
    const text = "she said. Her voice was flat, clipped by the environmental seal of her collar.";
    const cues = extract_acoustic_cues_from_narrative_context(text);

    expect(cues).toBeDefined();
    expect(cues.vocal_clause).toMatch(/flat, clipped by the environmental seal of her collar/i);
    expect(cues.is_flat).toBe(true);
    expect(cues.speech_verb).toBe("said");
  });

  test("accurately extracts participle voice clause like 'her voice softening slightly against the warm cedar'", () => {
    const text = "she said, her voice softening slightly against the warm cedar.";
    const cues = extract_acoustic_cues_from_narrative_context(text);

    expect(cues).toBeDefined();
    expect(cues.vocal_clause).toMatch(/voice softening slightly against the warm cedar/i);
    expect(cues.is_soft).toBe(true);
  });

  test("accurately extracts whisper and soft modifiers", () => {
    const text = "Kaelen answered softly.";
    const cues = extract_acoustic_cues_from_narrative_context(text);

    expect(cues).toBeDefined();
    expect(cues.speech_verb).toBe("answered");
    expect(cues.speech_adverb).toBe("softly");
    expect(cues.is_soft).toBe(true);
  });

  test("enriches Line 3 dialogue with Mara's flat, clipped collar-seal direction from Line 4", () => {
    const scriptSegments = [
      {
        index_position: 0,
        type: "narrator",
        speaker: "Narrator",
        text: "Inspector Mara did not touch it."
      },
      {
        index_position: 1,
        type: "dialogue",
        speaker: "Inspector Mara",
        text: "Explain the cupola, Brother,",
        direction: "expressive delivery"
      },
      {
        index_position: 2,
        type: "narrator",
        speaker: "Narrator",
        text: "she said. Her voice was flat, clipped by the environmental seal of her collar."
      }
    ];

    const enriched = enrich_script_segments_with_directorial_staging(
      scriptSegments,
      mockVoiceMapping,
      []
    );

    const maraLine = enriched[1];
    expect(maraLine.direction).toMatch(/flat, clipped by the environmental seal of her collar/i);
    expect(maraLine.qwen_style).toBeDefined();
    expect(maraLine.qwen_style.vocal_texture).toMatch(/flat, clipped by the environmental seal of her collar/i);
    expect(maraLine.qwen_style.cadence).toMatch(/clipped/i);
    expect(maraLine.qwen_style.acting_persona).toMatch(/directorate inspector/i);
    expect(maraLine.qwen_style.gender).toBe("Female");
    expect(maraLine.qwen_style.rich_emotion).toMatch(/flat/i);

    // Narrator line 2 remains completely intact!
    expect(enriched[2].text).toBe("she said. Her voice was flat, clipped by the environmental seal of her collar.");
  });
});

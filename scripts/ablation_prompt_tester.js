// =========================================================================
// PROMPT ABLATION TESTING & PROMPT BLOAT HARNESS
// =========================================================================
// WHAT: Generates an ablation ladder of instructions across performance clauses
//       (bare line, band only, subtext, proximity, emphasis, physical state, full stack,
//       and human director overrides) and evaluates prompt compactness & leakage risk.
// WHY: Instruction-following TTS models follow the first 2-3 clauses strongly and
//      blur or drop trailing clauses when over-stacked, or worse, speak prompt clauses aloud.
//      This harness isolates each clause to evaluate audible impact and prevent bloat.

const {
  ACOUSTIC_DISTANCE_LEVELS,
  compile_advanced_auk_performance_instruction
} = require("../services/performance_direction_service");

/**
 * WHAT: Generates an 8-level prompt ablation ladder for a given dialogue line.
 * 
 * @param {string} dialogue_text 
 * @param {Readonly<Object>} full_performance_direction 
 * @returns {ReadonlyArray<Object>} Array of ablation stages with prompt text, clause count, and leakage risk.
 */
function generate_prompt_ablation_ladder(dialogue_text, full_performance_direction) {
  const base_direction = full_performance_direction || {};
  const spoken_word_count = (dialogue_text || "").trim().split(/\s+/).filter(Boolean).length;

  const ablation_stages = [
    {
      level: 1,
      name: "Bare Baseline",
      description: "Neutral dialogue reading without performance staging",
      direction: {
        displayedEmotion: { emotion: "neutral", intensityBand: 1 },
        feltEmotion: { emotion: "neutral", intensityBand: 1 }
      }
    },
    {
      level: 2,
      name: "Intensity Band Only",
      description: "Emotion and discrete 1-5 intensity band descriptor",
      direction: {
        displayedEmotion: base_direction.displayedEmotion || { emotion: "angry", intensityBand: 4 },
        feltEmotion: base_direction.displayedEmotion || { emotion: "angry", intensityBand: 4 }
      }
    },
    {
      level: 3,
      name: "Subtext Layered",
      description: "Surface displayed emotion shaded by underlying felt emotion",
      direction: {
        displayedEmotion: base_direction.displayedEmotion || { emotion: "calm", intensityBand: 1 },
        feltEmotion: base_direction.feltEmotion || { emotion: "angry", intensityBand: 4 }
      }
    },
    {
      level: 4,
      name: "Acoustic Proximity & Addressee",
      description: "Subtext plus speaker addressee and acoustic distance",
      direction: {
        addresseeCharacterIdentifier: base_direction.addresseeCharacterIdentifier || "Maren",
        distanceBetweenSpeakerAndListener: base_direction.distanceBetweenSpeakerAndListener || ACOUSTIC_DISTANCE_LEVELS.INTIMATE,
        displayedEmotion: base_direction.displayedEmotion || { emotion: "calm", intensityBand: 1 },
        feltEmotion: base_direction.feltEmotion || { emotion: "angry", intensityBand: 4 }
      }
    },
    {
      level: 5,
      name: "Targeted Word Emphasis",
      description: "Adds 1-2 stressed word markers to proximity and subtext",
      direction: {
        addresseeCharacterIdentifier: base_direction.addresseeCharacterIdentifier || "Maren",
        distanceBetweenSpeakerAndListener: base_direction.distanceBetweenSpeakerAndListener || ACOUSTIC_DISTANCE_LEVELS.CONVERSATIONAL,
        displayedEmotion: base_direction.displayedEmotion || { emotion: "calm", intensityBand: 1 },
        feltEmotion: base_direction.feltEmotion || { emotion: "angry", intensityBand: 4 },
        emphasizedWordsInLine: base_direction.emphasizedWordsInLine || ["you"]
      }
    },
    {
      level: 6,
      name: "Physical State Modifier",
      description: "Adds bodily condition tags (e.g. breathless, tired)",
      direction: {
        displayedEmotion: base_direction.displayedEmotion || { emotion: "calm", intensityBand: 1 },
        feltEmotion: base_direction.feltEmotion || { emotion: "angry", intensityBand: 4 },
        physicalStateTags: base_direction.physicalStateTags || ["tired"]
      }
    },
    {
      level: 7,
      name: "Full Performance Stack",
      description: "All directorial fields compiled together",
      direction: { ...base_direction, directorNoteFromHuman: null }
    },
    {
      level: 8,
      name: "Human Director Override",
      description: "Directorial override note resolving and replacing conflicting staging",
      direction: {
        ...base_direction,
        directorNoteFromHuman: base_direction.directorNoteFromHuman || "quieter, she is holding back tears"
      }
    }
  ];

  return ablation_stages.map(stage => {
    const compiled_prompt = compile_advanced_auk_performance_instruction(stage.direction, dialogue_text);
    const instruction_char_length = compiled_prompt.length;
    const instruction_word_count = compiled_prompt.split(/\s+/).filter(Boolean).length;
    const clause_matches = compiled_prompt.match(/,/g);
    const clause_count = clause_matches ? clause_matches.length : 1;

    // WHAT: Leakage Risk Evaluation.
    // WHY: If instruction text is 5x longer than spoken dialogue, small TTS models
    //      have high probability of hallucinating instruction words into the audio.
    const prompt_to_dialogue_ratio = spoken_word_count > 0 ? (instruction_word_count / spoken_word_count) : 1.0;
    let leakage_risk = "low";
    if (prompt_to_dialogue_ratio > 6.0 && instruction_word_count > 35) {
      leakage_risk = "high";
    } else if (prompt_to_dialogue_ratio > 3.5 || clause_count > 5) {
      leakage_risk = "medium";
    }

    return {
      level: stage.level,
      name: stage.name,
      description: stage.description,
      compiled_prompt,
      instruction_char_length,
      instruction_word_count,
      clause_count,
      leakage_risk
    };
  });
}

// WHAT: Standalone CLI entry point
if (require.main === module) {
  const sample_text = "I told you everything I knew.";
  const sample_direction = {
    speakingCharacterIdentifier: "josh",
    addresseeCharacterIdentifier: "maren",
    distanceBetweenSpeakerAndListener: ACOUSTIC_DISTANCE_LEVELS.INTIMATE,
    displayedEmotion: { emotion: "calm", intensityBand: 1 },
    feltEmotion: { emotion: "angry", intensityBand: 4 },
    expressionMode: "suppressed",
    physicalStateTags: ["tired"],
    emphasizedWordsInLine: ["you"],
    directorNoteFromHuman: "quieter, holding back tears"
  };

  console.log("=========================================================================");
  console.log("PROMPT ABLATION LADDER & INSTRUCTION LEAKAGE ANALYSIS");
  console.log(`Spoken Line: "${sample_text}"`);
  console.log("=========================================================================\n");

  const results = generate_prompt_ablation_ladder(sample_text, sample_direction);
  for (const item of results) {
    console.log(`[Level ${item.level}: ${item.name}] (Clauses: ${item.clause_count}, Words: ${item.instruction_word_count}, Risk: ${item.leakage_risk.toUpperCase()})`);
    console.log(`  Prompt: ${item.compiled_prompt}\n`);
  }
}

module.exports = {
  generate_prompt_ablation_ladder
};


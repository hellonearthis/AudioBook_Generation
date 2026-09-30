// WHAT: Directorial Staging and Speech Tag Harvester Service.
// WHY: In audiobook production, AI models need micro-level acoustic and directorial context to sound natural.
//      This service harvests speech tags (e.g. "her voice was flat, clipped by the environmental seal of her collar")
//      and synthesizes them with character profiles to enrich dialogue cards with [Voice Quality], [Prosody],
//      [Style], and [Emotion] without destroying or truncating narrative prose.

/**
 * Extracts acoustic, prosody, and emotional cues from narrative context surrounding dialogue.
 *
 * @param {string} text Narrative text snippet (e.g. succeeding context)
 * @returns {object} Extracted acoustic features
 */
function extract_acoustic_cues_from_narrative_context(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const clean_text = text.trim();
  const cues = {
    vocal_clause: null,
    speech_verb: null,
    speech_adverb: null,
    in_tone_phrase: null,
    is_whisper: false,
    is_shout: false,
    is_flat: false,
    is_soft: false,
    is_harsh: false,
    is_hesitant: false,
    is_urgent: false,
    is_weary: false,
    is_amused: false,
    raw_acoustic_phrase: null
  };

  // 1. Explicit voice/delivery clauses:
  // e.g. "Her voice was flat, clipped by the environmental seal of her collar."
  // e.g. "His voice sounded dry and cracked."
  // e.g. "Their voices grew tight with panic."
  const explicit_voice_match = /(?:her|his|their|[a-zA-Z]+'s)\s+voice\s+(?:was|sounded|became|grew)\s+([^.]+)/i.exec(clean_text);
  if (explicit_voice_match && explicit_voice_match[1]) {
    cues.vocal_clause = explicit_voice_match[1].trim();
    cues.raw_acoustic_phrase = cues.vocal_clause;
  }

  // 2. Dynamic voice participle clauses:
  // e.g. "her voice softening slightly against the warm cedar"
  // e.g. "his voice cracking with emotion"
  // e.g. "voice dropping to an urgent whisper"
  const participle_voice_match = /(?:her|his|their|[a-zA-Z]+'s)?\s*voice\s+(softening|cracking|breaking|dropping|rising|tightening|wavering|trembling|quivering|faltering|thickening)(?:[^,.]+)/i.exec(clean_text);
  if (participle_voice_match && participle_voice_match[0]) {
    cues.vocal_clause = participle_voice_match[0].trim();
    if (!cues.raw_acoustic_phrase) cues.raw_acoustic_phrase = cues.vocal_clause;
  }

  // 3. Prepositional tone phrases:
  // e.g. "in a low, gravelly rasp", "with a quiet resolve", "in a clipped administrative tone"
  const prep_tone_match = /(?:in|with)\s+an?\s+([^.]+?)\s+(?:voice|tone|cadence|rasp|murmur|whisper|growl|inflection|diction)/i.exec(clean_text);
  if (prep_tone_match && prep_tone_match[1]) {
    cues.in_tone_phrase = `${prep_tone_match[1].trim()} tone`;
    if (!cues.raw_acoustic_phrase) cues.raw_acoustic_phrase = cues.in_tone_phrase;
  }

  // 4. Speech tag verbs & adverbs:
  // e.g. "she said", "he whispered softly", "Mara answered softly", "she snapped bitterly"
  const speech_verb_regex = /(?:,\s*)?(?:(?:she|he|they|[A-Z][a-zA-Z]+)\s+)?(whispered|murmured|muttered|breathed|hissed|shouted|yelled|bellowed|screamed|gasped|choked|sobbed|snapped|barked|growled|spat|stammered|faltered|sighed|laughed|chuckled|replied|answered|said|asked|called|warned|commanded)(?:\s+(softly|quietly|gently|faintly|flatly|coldly|monotonously|harshly|bitterly|sharply|wearily|tiredly|heavily|urgently|desperately|breathlessly|huskily|dryly|slowly|firmly|smoothly))?/i;
  const verb_match = speech_verb_regex.exec(clean_text);
  if (verb_match) {
    cues.speech_verb = verb_match[1] ? verb_match[1].toLowerCase() : null;
    cues.speech_adverb = verb_match[2] ? verb_match[2].toLowerCase() : null;
  }

  // Evaluate descriptive acoustic flags
  const combined_search = `${clean_text} ${cues.raw_acoustic_phrase || ""}`.toLowerCase();
  
  if (cues.speech_verb === "whispered" || cues.speech_verb === "murmured" || cues.speech_verb === "breathed" || combined_search.includes("whisper") || combined_search.includes("murmur")) {
    cues.is_whisper = true;
  }
  if (cues.speech_verb === "shouted" || cues.speech_verb === "yelled" || cues.speech_verb === "bellowed" || cues.speech_verb === "screamed" || cues.speech_verb === "roared") {
    cues.is_shout = true;
  }
  if (combined_search.includes("flat") || combined_search.includes("clipped") || cues.speech_adverb === "flatly" || cues.speech_adverb === "coldly") {
    cues.is_flat = true;
  }
  if (cues.speech_adverb === "softly" || cues.speech_adverb === "quietly" || cues.speech_adverb === "gently" || combined_search.includes("softening") || combined_search.includes("quiet")) {
    cues.is_soft = true;
  }
  if (cues.speech_verb === "snapped" || cues.speech_verb === "barked" || cues.speech_verb === "growled" || cues.speech_adverb === "harshly" || cues.speech_adverb === "bitterly") {
    cues.is_harsh = true;
  }
  if (cues.speech_verb === "stammered" || cues.speech_verb === "faltered" || cues.speech_verb === "choked" || combined_search.includes("cracking") || combined_search.includes("trembling")) {
    cues.is_hesitant = true;
  }
  if (cues.speech_adverb === "urgently" || cues.speech_adverb === "desperately" || cues.speech_adverb === "breathlessly" || combined_search.includes("urgent")) {
    cues.is_urgent = true;
  }
  if (cues.speech_adverb === "wearily" || cues.speech_adverb === "tiredly" || combined_search.includes("weary") || combined_search.includes("exhaustion")) {
    cues.is_weary = true;
  }
  if (cues.speech_verb === "laughed" || cues.speech_verb === "chuckled" || combined_search.includes("amused")) {
    cues.is_amused = true;
  }

  return cues;
}

/**
 * Synthesizes character profile defaults with context-extracted acoustic cues
 * to construct a complete Qwen style object and a rich direction string.
 */
function build_directorial_style_for_dialogue(dialogue_text, speaker_name, speaker_profile, acoustic_cues, active_relationship) {
  const profile = speaker_profile || {};
  const cues = acoustic_cues || {};

  // Age & Gender
  const age_range = profile.age || "Adult";
  const gender = profile.gender || "Unknown";

  // Pitch
  let pitch = "medium";
  if (cues.is_whisper || cues.is_flat) {
    pitch = "low";
  } else if (cues.is_shout) {
    pitch = "high";
  } else if (profile.voiceProfile && /low/i.test(profile.voiceProfile)) {
    pitch = "low";
  } else if (profile.voiceProfile && /high/i.test(profile.voiceProfile)) {
    pitch = "high";
  }

  // Vocal Texture
  let vocal_texture = "smooth and controlled";
  if (cues.raw_acoustic_phrase) {
    vocal_texture = cues.raw_acoustic_phrase.trim();
  } else if (cues.is_whisper) {
    vocal_texture = "soft, breathy whisper";
  } else if (cues.is_flat) {
    vocal_texture = "flat, clipped timbre with minimal inflection";
  } else if (cues.is_harsh) {
    vocal_texture = "sharp, hard-edged timbre";
  } else if (cues.is_hesitant) {
    vocal_texture = "breathless, cracked vocal texture";
  } else if (cues.is_soft) {
    vocal_texture = "gentle, subdued projection";
  } else if (profile.traits) {
    // Extract first trait clause
    const trait_snippet = profile.traits.split(/[;,.]/)[0].trim().toLowerCase();
    vocal_texture = `${trait_snippet} delivery`;
  }

  // Pacing
  let pacing = "normal";
  if (cues.is_flat || cues.is_weary) {
    pacing = "measured";
  } else if (cues.is_urgent || cues.is_shout) {
    pacing = "fast";
  } else if (cues.is_hesitant || cues.is_soft || cues.is_whisper) {
    pacing = "slow";
  } else if (profile.voiceProfile && /slow/i.test(profile.voiceProfile)) {
    pacing = "slow";
  }

  // Cadence
  let cadence = "steady cadence";
  if (cues.is_flat || (profile.voiceProfile && /clipped/i.test(profile.voiceProfile))) {
    cadence = "clipped, precise speech";
  } else if (cues.is_whisper) {
    cadence = "hushed, intimate cadence";
  } else if (cues.is_hesitant) {
    cadence = "hesitant, unsteady rhythm";
  } else if (cues.is_urgent) {
    cadence = "rapid, breathless cadence";
  } else if (profile.voiceProfile && /ceremonial/i.test(profile.voiceProfile)) {
    cadence = "ceremonial, rhythmic cadence";
  }

  // Acting Persona
  let acting_persona = "natural speaker";
  if (profile.identityBackground) {
    // Extract key role noun phrase (e.g. "Directorate inspector", "Custodian of the cloister", etc.)
    let role_match = profile.identityBackground.split(/(?:tasked with|responsible for|who is|an adult|serving as|[;.,])/i)[0].trim();
    if (role_match && role_match.length < 80) {
      acting_persona = role_match.toLowerCase();
    } else {
      acting_persona = (profile.personalityTraits || profile.traits || "focused character").split(/[;.,]/)[0].trim().toLowerCase();
    }
  } else if (profile.personalityTraits || profile.traits) {
    acting_persona = (profile.personalityTraits || profile.traits).split(/[;.,]/)[0].trim().toLowerCase();
  } else if (speaker_name && speaker_name !== "Character" && speaker_name !== "Unknown") {
    acting_persona = `${speaker_name.toLowerCase()} persona`;
  }

  // Vocal Technique
  let vocal_technique = "steady rhythm and clear articulation";
  if (cues.is_flat) {
    vocal_technique = "compressed timbre, minimal pitch inflection";
  } else if (cues.is_whisper) {
    vocal_technique = "soft intimate attack, close mic proximity";
  } else if (cues.is_harsh) {
    vocal_technique = "sharp staccato emphasis and projected volume";
  } else if (cues.is_soft) {
    vocal_technique = "soft attack, resonant and subdued projection";
  } else if (profile.voiceProfile && /compressed/i.test(profile.voiceProfile)) {
    vocal_technique = "compressed timbre with procedural diction";
  }

  // Rich Emotion
  let rich_emotion = "calm delivery";
  if (cues.is_flat) {
    rich_emotion = "flat composure, procedural detachment";
  } else if (cues.is_whisper) {
    rich_emotion = "hushed secrecy, suppressed tension";
  } else if (cues.is_harsh) {
    rich_emotion = "contained irritation or sharp demand";
  } else if (cues.is_hesitant) {
    rich_emotion = "vulnerable hesitation or disbelief";
  } else if (cues.is_soft) {
    rich_emotion = "gentle reverent calm";
  } else if (cues.is_urgent) {
    rich_emotion = "pressing urgency";
  } else if (profile.currentEmotion) {
    rich_emotion = profile.currentEmotion;
  }

  // Synthesize Concise Direction
  let direction = "";
  if (cues.raw_acoustic_phrase) {
    // Clean up phrase for direct parenthetical direction
    let clean_phrase = cues.raw_acoustic_phrase.replace(/^(her|his|their)\s+voice\s+(was|sounded|became|grew)\s+/i, '');
    clean_phrase = clean_phrase.charAt(0).toUpperCase() + clean_phrase.slice(1);
    direction = clean_phrase.endsWith('.') ? clean_phrase : `${clean_phrase}.`;
  } else if (cues.is_whisper) {
    direction = "Soft, intimate whisper with hushed breathy delivery.";
  } else if (cues.is_flat) {
    direction = "Flat, clipped delivery with procedural composure.";
  } else if (cues.is_soft) {
    direction = "Soft, gentle delivery with quiet reverence.";
  } else if (cues.is_harsh) {
    direction = "Sharp, commanding delivery with hardened edge.";
  } else {
    direction = `${rich_emotion.charAt(0).toUpperCase() + rich_emotion.slice(1)}, ${pacing} conversational delivery.`;
  }

  // Subtext / Relationship dynamic
  let intent = "Direct dialogue delivery.";
  if (active_relationship && active_relationship.relation_tone) {
    intent = `Interpersonal tone: ${active_relationship.relation_tone} (${active_relationship.relation_type || "interpersonal"}). ${direction}`;
  }

  return {
    direction,
    emotion: cues.is_whisper ? "whisper" : (cues.is_flat ? "calm" : (cues.is_harsh ? "angry" : "calm")),
    qwen_style: {
      age_range,
      gender,
      pitch,
      vocal_texture,
      pacing,
      cadence,
      acting_persona,
      vocal_technique,
      rich_emotion
    },
    intent
  };
}

// WHAT: Iterates through each script segment to harvest surrounding narrative speech tags and enrich dialogue cues.
// WHY: We examine adjacent narrator text (succeeding and preceding) to extract delivery details (whispers, flat delivery, etc.)
//      while leaving the original narrator prose completely intact.
function enrich_script_segments_with_directorial_staging(script_segments, voice_mapping, relationships) {
  if (!Array.isArray(script_segments) || script_segments.length === 0) {
    return script_segments || [];
  }

  const voice_map = voice_mapping || {};
  const active_relationships = Array.isArray(relationships) ? relationships : [];

  for (let segment_index_counter = 0; segment_index_counter < script_segments.length; segment_index_counter++) {
    const segment = script_segments[segment_index_counter];

    if (segment.type !== "dialogue") {
      // WHAT: Supplying narrator segments with default storytelling style parameters.
      // WHY: Guarantees every segment has predictable qwen_style parameters for downstream synthesis.
      if (!segment.qwen_style) {
        segment.qwen_style = {
          age_range: "Adult",
          gender: "Unknown",
          pitch: "medium",
          vocal_texture: "clear, neutral studio presence",
          pacing: "normal",
          cadence: "steady cadence",
          acting_persona: "omniscient storyteller",
          vocal_technique: "steady rhythmic delivery",
          rich_emotion: "neutral and observant"
        };
      }
      continue;
    }

    // WHAT: Checking user lock status on dialogue cards.
    // WHY: Preserves human directorial interventions as ground truth so automated passes do not overwrite them.
    if (segment.is_user_locked && segment.direction && segment.direction !== "expressive delivery" && segment.qwen_style) {
      continue;
    }

    // WHAT: Inspecting following narrator segment for succeeding speech tags (e.g., "her voice was flat...").
    // WHY: In literary prose, authors often place the acoustic/prosodic tag immediately after dialogue.
    let succeeding_context = "";
    if (segment_index_counter + 1 < script_segments.length && script_segments[segment_index_counter + 1].type === "narrator") {
      succeeding_context = script_segments[segment_index_counter + 1].text || "";
    }

    // WHAT: Inspecting preceding narrator segment for preceding speech tags (e.g., "In a low whisper, Mara answered:").
    // WHY: Provides fallback context when the speech tag precedes the dialogue instead of following it.
    let preceding_context = "";
    if (segment_index_counter - 1 >= 0 && script_segments[segment_index_counter - 1].type === "narrator") {
      preceding_context = script_segments[segment_index_counter - 1].text || "";
    }

    const speaker_name = segment.speaker || "Character";
    const speaker_profile = voice_map[speaker_name] || {};

    // Find active relationship between this speaker and any other character mentioned
    const relevant_rel = active_relationships.find(rel => 
      (rel.source_character === speaker_name || rel.target_character === speaker_name)
    ) || null;

    // Harvest acoustic cues from succeeding context (or preceding context if succeeding has none)
    let acoustic_cues = extract_acoustic_cues_from_narrative_context(succeeding_context);
    if (!acoustic_cues || (!acoustic_cues.raw_acoustic_phrase && !acoustic_cues.speech_verb)) {
      const alt_cues = extract_acoustic_cues_from_narrative_context(preceding_context);
      if (alt_cues && (alt_cues.raw_acoustic_phrase || alt_cues.speech_verb)) {
        acoustic_cues = alt_cues;
      }
    }

    const staged_style = build_directorial_style_for_dialogue(
      segment.text,
      speaker_name,
      speaker_profile,
      acoustic_cues,
      relevant_rel
    );

    // Update segment direction and qwen_style
    segment.direction = staged_style.direction;
    if (!segment.emotion || segment.emotion === "calm") {
      segment.emotion = staged_style.emotion;
    }
    segment.qwen_style = staged_style.qwen_style;
    if (!segment.intent) {
      segment.intent = staged_style.intent;
    }
  }

  return script_segments;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    extract_acoustic_cues_from_narrative_context,
    build_directorial_style_for_dialogue,
    enrich_script_segments_with_directorial_staging
  };
}

if (typeof window !== "undefined") {
  window.extract_acoustic_cues_from_narrative_context = extract_acoustic_cues_from_narrative_context;
  window.build_directorial_style_for_dialogue = build_directorial_style_for_dialogue;
  window.enrich_script_segments_with_directorial_staging = enrich_script_segments_with_directorial_staging;
}

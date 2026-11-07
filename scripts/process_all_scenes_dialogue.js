// =========================================================================
// THE PLAYER OF GAMES: FULL-BOOK DIALOGUE ATTRIBUTION PIPELINE
// =========================================================================
// WHAT: Processes all 115 scenes across the entire novel "The Player of Games"
//       to determine WHO says WHAT for every line of dialogue.
//       1. Normalizes British single-quoted dialogue ('...') to standard quotes.
//       2. Shatters paragraphs into clean narrator and spoken dialogue segments.
//       3. Resolves speakers using multi-rule matching: speech verb tags,
//          vocative penalties, scene cast awareness, and Laya ModernBERT NPU queries.
//       4. Enriches dialogue with directorial performance cues and emotional staging.
//       5. Persists populated scriptSegments and directorialSegments to project_state.json.
// WHY: Fully automates the book conversion pipeline so the director can immediately
//       audition and review screenplay scripts for every scene in the novel.

const fs = require("fs");
const path = require("path");
const http = require("http");

// British dialogue quote normalization preserving contractions and possessives
function convert_british_dialogue_quotes(text_content) {
  if (!text_content || typeof text_content !== "string") return "";
  const APOSTROPHE_PLACEHOLDER = "___APOSTROPHE___";
  // Protect intra-word apostrophes (e.g. don't, it's, Yay's)
  let protected_text = text_content.replace(/([a-zA-Z])'([a-zA-Z])/g, `$1${APOSTROPHE_PLACEHOLDER}$2`);
  // Protect leading colloquial contractions ('em, 'cause, 'til)
  protected_text = protected_text.replace(/'(em|cause|til|round|bout)\b/gi, `${APOSTROPHE_PLACEHOLDER}$1`);
  // Convert dialogue quotes: preceded by line start, whitespace, em-dash, bracket/paren
  // and ending with line end, whitespace, em-dash, bracket/paren or punctuation
  protected_text = protected_text.replace(/(^|[\s—(\[{])'([^'\n]+)'(?=[\s—)\]}.,;:!?]|$)/g, '$1"$2"');
  return protected_text.replace(new RegExp(APOSTROPHE_PLACEHOLDER, "g"), "'");
}

// Canonical speech attribution verbs
const SPEECH_VERBS = [
  "said", "says", "asked", "asks", "replied", "replies", "whispered", "shouted",
  "muttered", "snapped", "answered", "called", "cried", "murmured", "growled",
  "sighed", "laughed", "added", "demanded", "yelled", "told", "continued",
  "insisted", "stammered", "hissed", "breathed", "snarled", "exclaimed", "commented",
  "gasped", "wheezed", "commanded", "ordered", "intoned", "declared", "retorted"
];
const SPEECH_VERBS_REGEX = new RegExp(`\\b(?:${SPEECH_VERBS.join("|")})\\b`, "i");

// Character name patterns and aliases
const CHARACTER_PATTERNS = [
  { name: "Gurgeh", patterns: [/\bGurgeh\b/i, /\bJernau\b/i, /\bMorat Gurgeh\b/i] },
  { name: "Yay", patterns: [/\bYay\b/i, /\bMeristinoux\b/i] },
  { name: "Flere-Imsaho", patterns: [/\bFlere[-–—]Imsaho\b/i, /\bFlere\b/i, /\bthe drone\b/i, /\blibrary drone\b/i, /\bchaperone\b/i] },
  { name: "Mawhrin-Skel", patterns: [/\bMawhrin[-–—]Skel\b/i, /\bSkel\b/i, /\brogue drone\b/i] },
  { name: "Chamlis", patterns: [/\bChamlis\b/i, /\bAmalk[-–—]an\b/i, /\bancient drone\b/i] },
  { name: "Za", patterns: [/\bShohobohaum\b/i, /\bZa\b/i] },
  { name: "Nicosar", patterns: [/\bNicosar\b/i, /\bthe Emperor\b/i, /\bEmperor\b/i] },
  { name: "Hamin", patterns: [/\bHamin\b/i, /\bTutor Hamin\b/i, /\bthe Tutor\b/i, /\bthe Judge\b/i] },
  { name: "Pequil", patterns: [/\bPequil\b/i, /\bthe arbiter\b/i] },
  { name: "Worthil", patterns: [/\bWorthil\b/i] },
  { name: "Yomonul", patterns: [/\bYomonul\b/i, /\bthe Marshal\b/i] },
  { name: "Boruelal", patterns: [/\bBoruelal\b/i, /\bthe Magistrate\b/i] },
  { name: "Inclate", patterns: [/\bInclate\b/i] },
  { name: "Olos", patterns: [/\bOlos\b/i] },
  { name: "Limiting Factor", patterns: [/\bLimiting Factor\b/i, /\bSuperlifter\b/i] },
  { name: "Little Rascal", patterns: [/\bLittle Rascal\b/i, /\bthe GSV\b/i] }
];

// Query Laya ModernBERT on port 8765
function query_laya_for_speaker(context_state, candidate_names) {
  return new Promise((resolve) => {
    const candidate_criteria = {};
    for (const name of candidate_names) {
      candidate_criteria[name] = `dialogue spoken by ${name}`;
    }

    const payload = JSON.stringify({
      state: context_state,
      questions: {
        speaker: {
          type: "choice",
          instructions: "Which character speaks this dialogue based on surrounding context?",
          criteria: candidate_criteria
        },
        emotion: {
          type: "choice",
          instructions: "What is the emotional tone or delivery style for this spoken dialogue?",
          criteria: {
            "calm": "neutral, steady, composed, matter-of-fact",
            "whisper": "soft whisper, secretive, intimate, hushed",
            "angry": "shouting, aggressive, furious, irritated",
            "happy": "cheerful, delighted, upbeat, laughing",
            "excited": "energetic, eager, enthusiastic, overjoyed",
            "taunting": "mocking, sneering, sarcastic, hostile"
          }
        }
      }
    });

    const req = http.request("http://127.0.0.1:8765/decide", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      },
      timeout: 3000
    }, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.write(payload);
    req.end();
  });
}

// Extract speech direction cues from narrative context
function extract_direction_cue(context_text, speaker) {
  if (!context_text) return "calm delivery";
  const lower = context_text.toLowerCase();

  if (lower.includes("whisper") || lower.includes("breathed") || lower.includes("murmur")) {
    return "soft intimate whisper, quiet hushed delivery";
  }
  if (lower.includes("shout") || lower.includes("yell") || lower.includes("bellowed")) {
    return "forceful intense delivery, raised volume";
  }
  if (lower.includes("laugh") || lower.includes("chuckle") || lower.includes("grinning") || lower.includes("smiled")) {
    return "warm amused delivery, cheerful lightness";
  }
  if (lower.includes("snap") || lower.includes("harsh") || lower.includes("glare") || lower.includes("snarl")) {
    return "sharp clipped delivery, irritated edge";
  }
  if (lower.includes("mock") || lower.includes("sneer") || lower.includes("taunt") || lower.includes("sardonic")) {
    return "mocking sarcastic delivery, biting irony";
  }
  if (lower.includes("stammer") || lower.includes("hesitat") || lower.includes("nervous")) {
    return "hesitant nervous delivery, tentative pacing";
  }
  if (lower.includes("sigh") || lower.includes("weary") || lower.includes("tired")) {
    return "weary exhaled delivery, subdued resignation";
  }
  if (speaker === "Flere-Imsaho") {
    return "crisp officious delivery, fussy precision";
  }
  if (speaker === "Mawhrin-Skel") {
    return "grating mercurial delivery, sneering edge";
  }
  if (speaker === "Chamlis") {
    return "gentle venerable delivery, warm measured cadence";
  }
  if (speaker === "Nicosar") {
    return "imperious commanding delivery, aristocratic precision";
  }
  if (speaker === "Hamin") {
    return "wheezy dry delivery, calculating soft authority";
  }
  if (speaker === "Za") {
    return "gravelly boisterous delivery, world-weary warmth";
  }
  if (speaker === "Yay") {
    return "knowing roguish delivery, low warm cadence";
  }
  if (speaker === "Gurgeh") {
    return "measured intellectual delivery, contemplative calm";
  }

  return "calm conversational delivery";
}

// Process a single chapter scene into attributed script segments
async function attribute_single_chapter(chapter, global_voice_mapping, use_laya = true) {
  const raw_text = chapter.raw_text || "";
  const normalized_text = convert_british_dialogue_quotes(raw_text);
  const paragraphs = normalized_text.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const quotation_regex = /"([^"]+)"/g;

  const script_segments = [];
  const scene_cast = (chapter.scene_cast && chapter.scene_cast.length > 0)
    ? chapter.scene_cast.filter(c => c !== "Narrator")
    : ["Gurgeh"];

  let last_dialogue_speaker = null;

  for (let para_idx = 0; para_idx < paragraphs.length; para_idx++) {
    const para = paragraphs[para_idx];
    let match;
    let last_index = 0;

    while ((match = quotation_regex.exec(para)) !== null) {
      // Pre-quote narrator prose
      if (match.index > last_index) {
        const pre_prose = para.substring(last_index, match.index).trim();
        if (pre_prose) {
          script_segments.push({
            type: "narrator",
            speaker: "Narrator",
            text: pre_prose,
            direction: "steady clear narration",
            confidence: 1.0,
            engine: "narrator"
          });
        }
      }

      const quote_text = match[1].trim();
      const quote_start = match.index;
      const quote_end = quotation_regex.lastIndex;
      const context_before = para.substring(Math.max(0, quote_start - 120), quote_start).trim();
      const context_after = para.substring(quote_end, Math.min(para.length, quote_end + 120)).trim();
      const combined_surrounding_context = `${context_before} ${context_after}`.trim();

      let resolved_speaker = null;
      let attribution_confidence = 0.5;
      let matched_engine = "rules";

      // RULE 1: Vocative check in quote: if quote addresses character e.g. "Wake up, Gurgeh!"
      // then that character is definitely the listener!
      let vocative_listener = null;
      for (const char_def of CHARACTER_PATTERNS) {
        for (const pat of char_def.patterns) {
          if (pat.test(quote_text)) {
            vocative_listener = char_def.name;
            break;
          }
        }
        if (vocative_listener) break;
      }

      // RULE 2: Explicit speech verb tag in immediately surrounding context
      for (const char_def of CHARACTER_PATTERNS) {
        for (const pat of char_def.patterns) {
          if (pat.test(context_after) && SPEECH_VERBS_REGEX.test(context_after)) {
            // Check if this name in after-context was actually the subject of the speech verb
            if (char_def.name !== vocative_listener) {
              resolved_speaker = char_def.name;
              attribution_confidence = 0.95;
              break;
            }
          }
          if (pat.test(context_before) && SPEECH_VERBS_REGEX.test(context_before)) {
            if (char_def.name !== vocative_listener) {
              resolved_speaker = char_def.name;
              attribution_confidence = 0.90;
              break;
            }
          }
        }
        if (resolved_speaker) break;
      }

      // RULE 3: Pronoun speech tags (he said, she said, it said)
      if (!resolved_speaker) {
        if (/\b(?:she|her)\s+(?:said|asked|laughed|replied|whispered|murmured|muttered|cried)\b/i.test(context_after) ||
            /\b(?:said|asked|laughed|replied|whispered)\s+she\b/i.test(context_after)) {
          // Resolve female in scene cast
          const female_candidate = scene_cast.find(c => global_voice_mapping[c] && global_voice_mapping[c].gender === "Female") || "Yay";
          resolved_speaker = female_candidate;
          attribution_confidence = 0.85;
        } else if (/\b(?:he|him)\s+(?:said|asked|replied|whispered|murmured|muttered|told)\b/i.test(context_after) ||
                   /\b(?:said|asked|replied|whispered)\s+he\b/i.test(context_after)) {
          // Resolve male in scene cast
          if (vocative_listener === "Gurgeh") {
            resolved_speaker = scene_cast.find(c => c !== "Gurgeh" && global_voice_mapping[c] && global_voice_mapping[c].gender === "Male") || "Gurgeh";
          } else {
            resolved_speaker = "Gurgeh";
          }
          attribution_confidence = 0.80;
        } else if (/\b(?:it|the machine|the drone)\s+(?:said|asked|replied|whispered|hissed|hummed)\b/i.test(context_after) ||
                   /\b(?:said|asked|replied|hissed)\s+the (?:machine|drone)\b/i.test(context_after)) {
          const drone_candidate = scene_cast.find(c => global_voice_mapping[c] && global_voice_mapping[c].gender === "Machine") || "Flere-Imsaho";
          resolved_speaker = drone_candidate;
          attribution_confidence = 0.85;
        }
      }

      // RULE 4: Laya ModernBERT NPU Disambiguation for ambiguous lines
      if (!resolved_speaker && use_laya && scene_cast.length > 1) {
        const candidate_options = scene_cast.slice(0, 4);
        const laya_result = await query_laya_for_speaker({
          quote: quote_text,
          preceding_context: context_before,
          following_context: context_after,
          full_paragraph: para
        }, candidate_options);

        if (laya_result && laya_result.answers && laya_result.answers.speaker && laya_result.answers.speaker.choice) {
          const laya_choice = laya_result.answers.speaker.choice;
          if (laya_choice !== vocative_listener && global_voice_mapping[laya_choice]) {
            resolved_speaker = laya_choice;
            attribution_confidence = laya_result.answers.speaker.confidence || 0.75;
            matched_engine = "laya";
          }
        }
      }

      // RULE 5: Two-person conversational alternation
      if (!resolved_speaker) {
        if (vocative_listener && scene_cast.length >= 2) {
          resolved_speaker = scene_cast.find(c => c !== vocative_listener) || "Gurgeh";
          attribution_confidence = 0.70;
        } else if (last_dialogue_speaker && scene_cast.length === 2) {
          // Strict alternation in two-person scene
          resolved_speaker = (last_dialogue_speaker === scene_cast[0]) ? scene_cast[1] : scene_cast[0];
          attribution_confidence = 0.65;
        } else if (last_dialogue_speaker && last_dialogue_speaker !== "Gurgeh") {
          resolved_speaker = "Gurgeh";
          attribution_confidence = 0.60;
        } else {
          resolved_speaker = scene_cast[0] || "Gurgeh";
          attribution_confidence = 0.50;
        }
      }

      last_dialogue_speaker = resolved_speaker;

      const direction_cue = extract_direction_cue(combined_surrounding_context, resolved_speaker);

      script_segments.push({
        type: "dialogue",
        speaker: resolved_speaker,
        text: quote_text,
        direction: direction_cue,
        confidence: Number(attribution_confidence.toFixed(2)),
        engine: matched_engine
      });

      last_index = quotation_regex.lastIndex;
    }

    // Post-quote narrator prose
    if (last_index < para.length) {
      const post_prose = para.substring(last_index).trim();
      if (post_prose) {
        script_segments.push({
          type: "narrator",
          speaker: "Narrator",
          text: post_prose,
          direction: "steady clear narration",
          confidence: 1.0,
          engine: "narrator"
        });
      }
    }
  }

  // If no dialogue quotes found in entire scene, wrap entire scene as continuous narration
  if (script_segments.length === 0 && raw_text.trim().length > 0) {
    const paragraphs_list = raw_text.split(/\n+/).map(p => p.trim()).filter(Boolean);
    for (const p of paragraphs_list) {
      script_segments.push({
        type: "narrator",
        speaker: "Narrator",
        text: p,
        direction: "steady clear narration",
        confidence: 1.0,
        engine: "narrator"
      });
    }
  }

  return script_segments;
}

// Main execution function
async function process_all_scenes() {
  console.log("=========================================================================");
  console.log("BOOK-WIDE DIALOGUE ATTRIBUTION: THE PLAYER OF GAMES (115 SCENES)");
  console.log("=========================================================================\n");

  const project_state_path = path.resolve(__dirname, "../workspace/the_player_of_games/project_state.json");
  if (!fs.existsSync(project_state_path)) {
    throw new Error(`Project state not found at: ${project_state_path}`);
  }

  const project_state = JSON.parse(fs.readFileSync(project_state_path, "utf-8"));
  const chapters = project_state.chapters || [];
  const voice_mapping = project_state.voiceMapping || {};

  console.log(`Loaded project: "${project_state.projectName}"`);
  console.log(`Total scenes to process: ${chapters.length}`);
  console.log(`Global cast members: ${Object.keys(voice_mapping).join(", ")}\n`);

  let total_dialogue_lines = 0;
  let total_narrator_lines = 0;
  const start_time = Date.now();

  const updated_chapters = [];

  for (let idx = 0; idx < chapters.length; idx++) {
    const chapter = chapters[idx];
    const script_segments = await attribute_single_chapter(chapter, voice_mapping, true);

    const dialogue_count = script_segments.filter(s => s.type === "dialogue").length;
    const narrator_count = script_segments.filter(s => s.type === "narrator").length;
    total_dialogue_lines += dialogue_count;
    total_narrator_lines += narrator_count;

    const updated_chapter = {
      ...chapter,
      scriptSegments: script_segments,
      directorialSegments: []
    };
    updated_chapters.push(updated_chapter);

    const progress_pct = Math.round(((idx + 1) / chapters.length) * 100);
    const pad_idx = String(idx + 1).padStart(3, " ");
    console.log(`[${pad_idx}/${chapters.length}] (${progress_pct}%) ${chapter.chapter_title}: ${script_segments.length} segments (${dialogue_count} dialogue, ${narrator_count} narration)`);
  }

  const duration_sec = ((Date.now() - start_time) / 1000).toFixed(1);
  console.log("\n=========================================================================");
  console.log(`ATTRIBUTION COMPLETE IN ${duration_sec}s!`);
  console.log(`Total Spoken Dialogue Lines: ${total_dialogue_lines}`);
  console.log(`Total Narrator Segments: ${total_narrator_lines}`);
  console.log(`Total Script Cards Across All Scenes: ${total_dialogue_lines + total_narrator_lines}`);
  console.log("=========================================================================\n");

  // Update active chapter script segments
  const active_chapter_id = project_state.active_chapter_id || updated_chapters[0].chapter_id;
  const active_chapter = updated_chapters.find(c => c.chapter_id === active_chapter_id) || updated_chapters[0];

  const updated_project_state = {
    ...project_state,
    chapters: updated_chapters,
    rawBookText: active_chapter.raw_text,
    scriptSegments: active_chapter.scriptSegments,
    directorialSegments: active_chapter.directorialSegments || []
  };

  fs.writeFileSync(project_state_path, JSON.stringify(updated_project_state, null, 2), "utf-8");
  console.log(`Successfully saved all 115 scene scripts to: ${project_state_path}`);
}

process_all_scenes().catch((err) => {
  console.error("Fatal attribution pipeline error:", err);
  process.exit(1);
});


const fs = require('fs');
const path = require('path');

const GROUND_TRUTH_PATH = path.join(__dirname, '..', 'benchmarks', 'unmarked_ground_truth.json');
const SPAN_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'unmarked_span_detection.txt');
const JOINT_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'unmarked_joint_attribution.txt');

const LLAMA_ENDPOINT = 'http://127.0.0.1:8080/v1/chat/completions';
const LAYA_ENDPOINT = 'http://127.0.0.1:8765/decide';

// Helper: JSON parser with markdown block stripping
function cleanAndParseJson(raw) {
  if (!raw) return [];
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Attempt greedy bracket matching
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (inner) {}
    }
    return [];
  }
}

// -------------------------------------------------------------
// Arm 1: Rule-based Syntactic Register & Speech-tag parser
// -------------------------------------------------------------
function parse_by_syntactic_rules(paragraph_string, characters) {
  if (!paragraph_string || !paragraph_string.trim()) return [];

  const sentences = paragraph_string.split(/(?<=[.?!])\s+/);
  const speech_verb_pattern = "(?:said|asked|replied|whispered|muttered|cried|shouted|yelled|breathed|growled|murmured|gasped|snapped|called|demanded|told|answered)";
  const speech_pronoun_pattern = "(?:he|she|they|the boy|the man|the girl|the woman|the doctor|the soldier|the kid|one of them|someone)";

  const suffix_tag_regex = new RegExp(`^(.+?)(?:,|\\s+)?\\s+(${speech_pronoun_pattern}\\s+${speech_verb_pattern}|${speech_verb_pattern}\\s+${speech_pronoun_pattern})([.?!]?.*)$`, "i");
  const prefix_tag_regex = new RegExp(`^(${speech_pronoun_pattern}\\s+${speech_verb_pattern}|${speech_verb_pattern}\\s+${speech_pronoun_pattern})(?:,|:)?\\s+(.+)$`, "i");
  const conversational_prefix_regex = /^(?:where|what|why|who|how|when|are you|is it|can we|will we|do you|don't|did you|look|listen|come on|hurry|wait|yes|no|yeah|nah|hell|god|oh|please|anything|sometime)\b/i;

  const spans = [];
  let pending_narrator = "";

  for (const sentence of sentences) {
    const raw = sentence.trim();
    if (!raw) continue;

    let match = null;
    if ((match = suffix_tag_regex.exec(raw)) !== null) {
      const dialogue_part = match[1].trim().replace(/,\s*$/, "");
      const tag_part = (match[2] + (match[3] || "")).trim();

      if (pending_narrator) {
        spans.push({ type: "narrator", text: pending_narrator, speaker: "Narrator" });
        pending_narrator = "";
      }
      if (dialogue_part) {
        spans.push({ type: "dialogue", text: dialogue_part, tag: tag_part });
      }
      if (tag_part) {
        pending_narrator = tag_part;
      }
      continue;
    }

    if ((match = prefix_tag_regex.exec(raw)) !== null) {
      const tag_part = match[1].trim();
      const dialogue_part = match[2].trim();

      if (pending_narrator) {
        pending_narrator += " " + tag_part;
      } else {
        pending_narrator = tag_part;
      }
      spans.push({ type: "narrator", text: pending_narrator, speaker: "Narrator" });
      pending_narrator = "";

      if (dialogue_part) {
        spans.push({ type: "dialogue", text: dialogue_part, tag: tag_part });
      }
      continue;
    }

    if (raw.endsWith("?") || conversational_prefix_regex.test(raw)) {
      if (pending_narrator) {
        spans.push({ type: "narrator", text: pending_narrator, speaker: "Narrator" });
        pending_narrator = "";
      }
      spans.push({ type: "dialogue", text: raw, tag: "" });
      continue;
    }

    if (pending_narrator) {
      pending_narrator += " " + raw;
    } else {
      pending_narrator = raw;
    }
  }

  if (pending_narrator) {
    spans.push({ type: "narrator", text: pending_narrator, speaker: "Narrator" });
  }

  return spans;
}

// Arm 1A: Syntactic rules + alternating heuristic speaker attribution
function run_arm_1a_pure_heuristic(text, characters) {
  const t0 = performance.now();
  const spans = parse_by_syntactic_rules(text, characters);

  // Simple alternation between non-narrator characters
  const non_narrators = characters.filter(c => c !== "Narrator");
  let current_char_idx = 0;

  for (const span of spans) {
    if (span.type === "narrator") {
      span.speaker = "Narrator";
    } else {
      // Check if tag gives a clue
      const tag = span.tag || "";
      let found = null;
      for (const char of non_narrators) {
        if (tag.toLowerCase().includes(char.toLowerCase())) {
          found = char;
          break;
        }
      }
      if (found) {
        span.speaker = found;
        current_char_idx = (non_narrators.indexOf(found) + 1) % (non_narrators.length || 1);
      } else {
        span.speaker = non_narrators[current_char_idx] || "Narrator";
        current_char_idx = (current_char_idx + 1) % (non_narrators.length || 1);
      }
    }
  }

  const elapsed = performance.now() - t0;
  return {
    arm: "Arm 1A: Pure Heuristic Rules",
    spans,
    total_time_ms: elapsed,
    llm_time_ms: 0,
    laya_time_ms: 0,
    http_calls: 0
  };
}

// -------------------------------------------------------------
// Laya Query Helper
// -------------------------------------------------------------
async function query_laya_speaker(span_text, context_text, characters) {
  const criteria = {};
  for (const char of characters) {
    if (char === "Narrator") {
      criteria[char] = "narrator exposition, scene description, setting, third-person commentary";
    } else {
      criteria[char] = `Spoken dialogue by ${char}`;
    }
  }

  const t0 = performance.now();
  try {
    const res = await fetch(LAYA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "classification",
        text: span_text,
        context: context_text,
        criteria
      })
    });
    const data = await res.json();
    const elapsed = performance.now() - t0;
    return {
      speaker: data.best_match || data.decision || characters[0],
      confidence: data.confidence || 0.5,
      elapsed_ms: elapsed
    };
  } catch (err) {
    const elapsed = performance.now() - t0;
    return {
      speaker: characters[0],
      confidence: 0,
      elapsed_ms: elapsed,
      error: err.message
    };
  }
}

// -------------------------------------------------------------
// Arm 1B: Syntactic Rules for Boundary + Laya for Attribution
// -------------------------------------------------------------
async function run_arm_1b_rules_plus_laya(text, characters) {
  const t0 = performance.now();
  const spans = parse_by_syntactic_rules(text, characters);

  let laya_total_time = 0;
  let http_calls = 0;

  for (const span of spans) {
    if (span.type === "narrator") {
      span.speaker = "Narrator";
    } else {
      http_calls++;
      const laya_res = await query_laya_speaker(span.text, text, characters);
      laya_total_time += laya_res.elapsed_ms;
      span.speaker = laya_res.speaker;
      span.confidence = laya_res.confidence;
    }
  }

  const total_elapsed = performance.now() - t0;
  return {
    arm: "Arm 1B: Rule Boundary + Laya",
    spans,
    total_time_ms: total_elapsed,
    llm_time_ms: 0,
    laya_time_ms: laya_total_time,
    http_calls
  };
}

// -------------------------------------------------------------
// Arm 2: LLM Boundary Detection + Laya Attribution (Two-Hop)
// -------------------------------------------------------------
async function run_arm_2_llm_boundary_laya(text, characters) {
  const t0 = performance.now();
  const system_prompt = fs.readFileSync(SPAN_PROMPT_PATH, "utf8");

  // Step 2A: Query LLM for boundaries
  const llm_t0 = performance.now();
  let spans = [];
  try {
    const llm_res = await fetch(LLAMA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system_prompt },
          { role: "user", content: text }
        ],
        temperature: 0.1,
        max_tokens: 2048
      })
    });
    const llm_data = await llm_res.json();
    const content = llm_data.choices?.[0]?.message?.content || "";
    spans = cleanAndParseJson(content);
  } catch (e) {
    console.error("Arm 2 LLM boundary error:", e.message);
    spans = parse_by_syntactic_rules(text, characters);
  }
  const llm_time = performance.now() - llm_t0;

  // Step 2B: Query Laya for attribution
  let laya_total_time = 0;
  let http_calls = 1; // 1 for LLM

  for (const span of spans) {
    if (span.type === "narrator") {
      span.speaker = "Narrator";
    } else {
      http_calls++;
      const laya_res = await query_laya_speaker(span.text, text, characters);
      laya_total_time += laya_res.elapsed_ms;
      span.speaker = laya_res.speaker;
      span.confidence = laya_res.confidence;
    }
  }

  const total_elapsed = performance.now() - t0;
  return {
    arm: "Arm 2: Decoupled (LLM Boundary + Laya)",
    spans,
    total_time_ms: total_elapsed,
    llm_time_ms: llm_time,
    laya_time_ms: laya_total_time,
    http_calls
  };
}

// -------------------------------------------------------------
// Arm 3: Joint LLM (Joint Span Boundary & Speaker Attribution)
// -------------------------------------------------------------
async function run_arm_3_llm_joint(text, characters) {
  const t0 = performance.now();
  const base_system_prompt = fs.readFileSync(JOINT_PROMPT_PATH, "utf8");
  const system_prompt = `${base_system_prompt}\n\nAvailable Characters for this scene: ${JSON.stringify(characters)}`;

  let spans = [];
  try {
    const res = await fetch(LLAMA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system_prompt },
          { role: "user", content: text }
        ],
        temperature: 0.1,
        max_tokens: 2048
      })
    });
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    spans = cleanAndParseJson(content);
  } catch (e) {
    console.error("Arm 3 Joint LLM error:", e.message);
  }

  const total_elapsed = performance.now() - t0;
  return {
    arm: "Arm 3: Joint LLM (1-Pass Span + Speaker)",
    spans,
    total_time_ms: total_elapsed,
    llm_time_ms: total_elapsed,
    laya_time_ms: 0,
    http_calls: 1
  };
}

// -------------------------------------------------------------
// Evaluation & Scoring Engine
// -------------------------------------------------------------
function evaluate_predictions(raw_text, ground_truth_spans, predicted_spans) {
  const text_len = raw_text.length;

  // Build character-level boolean mask for dialogue (1) vs narration (0)
  const gt_mask = new Uint8Array(text_len);
  const gt_speaker_map = new Array(text_len).fill(null);

  let search_offset = 0;
  for (const span of ground_truth_spans) {
    const clean_text = span.text.trim();
    if (!clean_text) continue;
    const idx = raw_text.indexOf(clean_text, search_offset);
    if (idx !== -1) {
      search_offset = idx + clean_text.length;
      if (span.type === "dialogue") {
        for (let i = idx; i < idx + clean_text.length; i++) {
          gt_mask[i] = 1;
          gt_speaker_map[i] = span.speaker;
        }
      } else {
        for (let i = idx; i < idx + clean_text.length; i++) {
          gt_speaker_map[i] = "Narrator";
        }
      }
    }
  }

  const pred_mask = new Uint8Array(text_len);
  const pred_speaker_map = new Array(text_len).fill(null);

  search_offset = 0;
  for (const span of predicted_spans) {
    const clean_text = (span.text || "").trim();
    if (!clean_text) continue;
    const idx = raw_text.indexOf(clean_text, search_offset);
    if (idx !== -1) {
      search_offset = idx + clean_text.length;
      if (span.type === "dialogue") {
        for (let i = idx; i < idx + clean_text.length; i++) {
          pred_mask[i] = 1;
          pred_speaker_map[i] = span.speaker;
        }
      } else {
        for (let i = idx; i < idx + clean_text.length; i++) {
          pred_speaker_map[i] = span.speaker || "Narrator";
        }
      }
    }
  }

  // Calculate Character-Level Boundary Precision, Recall, F1, IoU
  let tp = 0, fp = 0, fn = 0, tn = 0;
  let correct_speaker_chars = 0;
  let dialogue_chars_evaluated = 0;

  for (let i = 0; i < text_len; i++) {
    const gt_is_dia = gt_mask[i] === 1;
    const pred_is_dia = pred_mask[i] === 1;

    if (gt_is_dia && pred_is_dia) {
      tp++;
      dialogue_chars_evaluated++;
      if (pred_speaker_map[i] && gt_speaker_map[i] && 
          pred_speaker_map[i].toLowerCase() === gt_speaker_map[i].toLowerCase()) {
        correct_speaker_chars++;
      }
    } else if (!gt_is_dia && pred_is_dia) {
      fp++;
    } else if (gt_is_dia && !pred_is_dia) {
      fn++;
    } else {
      tn++;
    }
  }

  const precision = (tp + fp) > 0 ? (tp / (tp + fp)) : 0;
  const recall = (tp + fn) > 0 ? (tp / (tp + fn)) : 0;
  const f1 = (precision + recall) > 0 ? (2 * precision * recall / (precision + recall)) : 0;
  const iou = (tp + fp + fn) > 0 ? (tp / (tp + fp + fn)) : 0;
  const speaker_accuracy = dialogue_chars_evaluated > 0 ? (correct_speaker_chars / dialogue_chars_evaluated) : 0;

  // Check speech-tag bleeding (does any dialogue span contain "he said", "she asked", etc.?)
  const speech_tag_regex = /\b(?:he|she|they|the boy|the man)\s+(?:said|asked|replied|whispered|muttered)\b/i;
  let speech_tag_bleeds = 0;
  for (const span of predicted_spans) {
    if (span.type === "dialogue" && speech_tag_regex.test(span.text)) {
      speech_tag_bleeds++;
    }
  }

  return {
    precision: Number((precision * 100).toFixed(1)),
    recall: Number((recall * 100).toFixed(1)),
    f1: Number((f1 * 100).toFixed(1)),
    iou: Number((iou * 100).toFixed(1)),
    speaker_accuracy: Number((speaker_accuracy * 100).toFixed(1)),
    speech_tag_bleeds,
    predicted_spans_count: predicted_spans.length,
    dialogue_spans_count: predicted_spans.filter(s => s.type === "dialogue").length
  };
}

// -------------------------------------------------------------
// Main Runner
// -------------------------------------------------------------
async function run_all_benchmarks() {
  console.log("==========================================================================");
  console.log("   LITERARY UNMARKED DIALOGUE BENCHMARK: 3-ARM ARCHITECTURAL COMPARISON   ");
  console.log("==========================================================================\n");

  const benchmarks_data = JSON.parse(fs.readFileSync(GROUND_TRUTH_PATH, "utf8"));
  const all_results = [];

  for (const bench of benchmarks_data) {
    console.log(`\n>>> Benchmarking Passage: "${bench.title}"`);
    console.log(`    Characters: ${bench.characters.join(", ")}`);
    console.log(`    Excerpt Length: ${bench.text.length} chars | Ground Truth Spans: ${bench.ground_truth_spans.length}`);

    // Arm 1A: Pure Heuristic Rules
    const res_1a = run_arm_1a_pure_heuristic(bench.text, bench.characters);
    const eval_1a = evaluate_predictions(bench.text, bench.ground_truth_spans, res_1a.spans);

    // Arm 1B: Rules + Laya
    const res_1b = await run_arm_1b_rules_plus_laya(bench.text, bench.characters);
    const eval_1b = evaluate_predictions(bench.text, bench.ground_truth_spans, res_1b.spans);

    // Arm 2: LLM Boundary + Laya Attribution
    const res_2 = await run_arm_2_llm_boundary_laya(bench.text, bench.characters);
    const eval_2 = evaluate_predictions(bench.text, bench.ground_truth_spans, res_2.spans);

    // Arm 3: Joint LLM (Single Pass)
    const res_3 = await run_arm_3_llm_joint(bench.text, bench.characters);
    const eval_3 = evaluate_predictions(bench.text, bench.ground_truth_spans, res_3.spans);

    all_results.push({
      passage_id: bench.id,
      title: bench.title,
      arms: [
        { ...res_1a, ...eval_1a },
        { ...res_1b, ...eval_1b },
        { ...res_2, ...eval_2 },
        { ...res_3, ...eval_3 }
      ]
    });
  }

  // Print results table
  console.log("\n==========================================================================");
  console.log("                             DETAILED RESULTS                             ");
  console.log("==========================================================================");

  for (const passage of all_results) {
    console.log(`\n### ${passage.title}`);
    console.log("| Strategy | Boundary F1 | Boundary IoU | Speaker Acc | Tag Bleeds | Total Latency | LLM Time | Laya Time | Hops |");
    console.log("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");
    for (const arm of passage.arms) {
      console.log(`| ${arm.arm} | ${arm.f1}% | ${arm.iou}% | ${arm.speaker_accuracy}% | ${arm.speech_tag_bleeds} | ${arm.total_time_ms.toFixed(0)}ms | ${arm.llm_time_ms.toFixed(0)}ms | ${arm.laya_time_ms.toFixed(0)}ms | ${arm.http_calls} |`);
    }
  }

  // Calculate Averages Across All Passages
  console.log("\n==========================================================================");
  console.log("                   OVERALL ARCHITECTURAL BENCHMARK SUMMARY                ");
  console.log("==========================================================================");

  const arm_names = [
    "Arm 1A: Pure Heuristic Rules",
    "Arm 1B: Rule Boundary + Laya",
    "Arm 2: Decoupled (LLM Boundary + Laya)",
    "Arm 3: Joint LLM (1-Pass Span + Speaker)"
  ];

  console.log("| Architecture Strategy | Avg Boundary F1 | Avg Boundary IoU | Avg Speaker Acc | Tag Bleeds | Avg Latency | Avg Roundtrips |");
  console.log("| :--- | :---: | :---: | :---: | :---: | :---: | :---: |");

  for (let a = 0; a < arm_names.length; a++) {
    const name = arm_names[a];
    let sum_f1 = 0, sum_iou = 0, sum_acc = 0, sum_bleeds = 0, sum_latency = 0, sum_hops = 0;
    const n = all_results.length;

    for (const p of all_results) {
      const arm = p.arms[a];
      sum_f1 += arm.f1;
      sum_iou += arm.iou;
      sum_acc += arm.speaker_accuracy;
      sum_bleeds += arm.speech_tag_bleeds;
      sum_latency += arm.total_time_ms;
      sum_hops += arm.http_calls;
    }

    console.log(`| **${name}** | **${(sum_f1/n).toFixed(1)}%** | ${(sum_iou/n).toFixed(1)}% | **${(sum_acc/n).toFixed(1)}%** | ${sum_bleeds} | **${(sum_latency/n).toFixed(0)}ms** | ${(sum_hops/n).toFixed(1)} |`);
  }

  // Write full JSON results to disk for inspection
  const out_path = path.join(__dirname, '..', 'benchmarks', 'benchmark_results.json');
  fs.writeFileSync(out_path, JSON.stringify(all_results, null, 2));
  console.log(`\nFull benchmark data saved to: ${out_path}\n`);
}

run_all_benchmarks().catch(err => {
  console.error("Benchmark execution failed:", err);
  process.exit(1);
});

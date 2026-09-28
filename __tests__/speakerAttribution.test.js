/** @jest-environment node */

// =========================================================================
// UNIT TESTS - TWO-STAGE MULTI-MODEL SPEAKER ATTRIBUTION ENGINE
// =========================================================================
// WHAT: Verifies the speaker attribution pipeline rules, classifiers, and review queues.
// WHY: Ensures high accuracy, deterministic rule execution, position-bias cancellation,
//      and guarantees dialogue spans never default silently to "Narrator".

const {
  attributeSpeakersAcrossParagraphs,
  extract_sorted_review_queue_from_results,
  split_paragraphs_into_scene_boundaries,
  detect_active_scene_cast_members,
  evaluate_adjacent_dialogue_tag_rule,
  evaluate_multi_paragraph_monologue_continuation,
  identify_vocative_listener_character_ids,
  calculate_conversational_alternation_hint,
  UNKNOWN_SPEAKER_IDENTIFIER
} = require("../services/speaker_attribution");

describe("Speaker Attribution Engine", () => {
  const mock_cast_profiles_list = [
    { id: "josh", name: "Josh", aliases: ["Joshua"] },
    { id: "maren", name: "Maren" },
    { id: "clerk", name: "Court Clerk" }
  ];

  describe("Deterministic Rules Engine", () => {
    test("detects dialogue tag immediately following the quote ('said Maren')", () => {
      // WHAT: Testing dialogue tag extraction after quote.
      // WHY: Verifies speech verbs and proper character names resolve authoritatively.
      const paragraph_sample = '"You knew," said Maren quietly.';
      const dialogue_span = { id: 1, text: "You knew,", start: 1 };
      const tagged_speaker = evaluate_adjacent_dialogue_tag_rule(
        paragraph_sample,
        dialogue_span,
        mock_cast_profiles_list,
        { character_speech_tag_window_character_count: 80 }
      );
      expect(tagged_speaker).toBe("maren");
    });

    test("detects dialogue tag immediately preceding the quote ('Josh muttered,')", () => {
      // WHAT: Testing dialogue tag extraction before quote.
      // WHY: Verifies inverted tags resolve accurately to the character.
      const paragraph_sample = 'Josh muttered, "Don\'t do that."';
      const dialogue_span = { id: 2, text: "Don't do that." };
      const tagged_speaker = evaluate_adjacent_dialogue_tag_rule(
        paragraph_sample,
        dialogue_span,
        mock_cast_profiles_list,
        { character_speech_tag_window_character_count: 80 }
      );
      expect(tagged_speaker).toBe("josh");
    });

    test("identifies vocative address inside line as listener rather than speaker", () => {
      // WHAT: Testing vocative exclusion.
      // WHY: Characters addressed directly (e.g. 'Josh, sit down') are listeners.
      const vocative_hits_start = identify_vocative_listener_character_ids("Josh, sit down right now.", mock_cast_profiles_list);
      expect(vocative_hits_start.has("josh")).toBe(true);

      const vocative_hits_end = identify_vocative_listener_character_ids("Don't do that, Maren!", mock_cast_profiles_list);
      expect(vocative_hits_end.has("maren")).toBe(true);
    });

    test("detects multi-paragraph monologue continuation with unclosed previous quote", () => {
      // WHAT: Testing monologue continuation logic.
      // WHY: Unclosed quotes carrying over to a new quoted paragraph remain with the same speaker.
      const paragraphs = [
        '"I arrived in the city three days ago, expecting to find the documents intact and preserved.',
        '"Instead, all I found were ashes and burned records."'
      ];
      const is_continuation = evaluate_multi_paragraph_monologue_continuation(paragraphs, 1);
      expect(is_continuation).toBe(true);
    });

    test("calculates conversational alternation turn-taking in A/B exchange", () => {
      // WHAT: Testing A/B alternation hint.
      // WHY: Predicts next speaker in rapid back-and-forth dialogue exchanges.
      const mock_state = {
        recent_speaker_history_list: ["josh", "maren"]
      };
      const alternation_hint = calculate_conversational_alternation_hint(mock_state, mock_cast_profiles_list, true);
      expect(alternation_hint).toBe("josh");
    });
  });

  describe("Scene Boundary & Scene Cast Detection", () => {
    test("splits paragraphs at scene break dividers and chapter headers", () => {
      // WHAT: Testing scene break splitting.
      // WHY: Localizes conversational state resets across scene transitions.
      const paragraphs = [
        "Paragraph 1 in Scene 1.",
        "Paragraph 2 in Scene 1.",
        "* * *",
        "Paragraph 1 in Scene 2.",
        "Chapter 2: The Return",
        "Paragraph 1 in Scene 3."
      ];
      const scenes = split_paragraphs_into_scene_boundaries(paragraphs);
      expect(scenes.length).toBe(3);
      expect(scenes[0]).toEqual({ start: 0, end: 2 });
      expect(scenes[1]).toEqual({ start: 3, end: 4 });
      expect(scenes[2]).toEqual({ start: 5, end: 6 });
    });

    test("detects characters physically present in the scene text", () => {
      // WHAT: Testing active scene cast detection.
      // WHY: Filters candidate choices to only characters mentioned in that scene.
      const paragraphs = [
        "Josh looked at Maren across the desk.",
        '"You knew."'
      ];
      const present_cast = detect_active_scene_cast_members(paragraphs, { start: 0, end: 2 }, mock_cast_profiles_list);
      expect(present_cast.map((character) => character.id).sort()).toEqual(["josh", "maren"]);
    });
  });

  describe("Multi-Model Pipeline Execution", () => {
    test("runs end-to-end attribution combining tag rules, classifier agreement, and alternation", async () => {
      // WHAT: Testing complete attribution across sample conversation.
      // WHY: Verifies rules fire first, classifiers handle unmarked lines, and review queue is populated.
      const paragraphs = [
        "Josh slammed the folder on the desk. Maren didn't look up.",
        '"You knew."',
        '"Knew what?"',
        '"Don\'t do that."',
        '"Do what?" said Maren.',
        '"Maren, please."'
      ];

      const spans = [
        { id: 1, paraIndex: 1, text: "You knew." },
        { id: 2, paraIndex: 2, text: "Knew what?" },
        { id: 3, paraIndex: 3, text: "Don't do that." },
        { id: 4, paraIndex: 4, text: "Do what?" },
        { id: 5, paraIndex: 5, text: "Maren, please." }
      ];

      const mock_laya_adapter = {
        name: "laya",
        async choose({ context, options }) {
          const match = context.match(/\[\[LINE (\d+)\]\]/);
          const line_id = match ? Number(match[1]) : 0;
          const predictions = { 1: "josh", 2: "maren", 3: "josh", 5: "josh" };
          const target_pick = predictions[line_id] || "unknown";

          const scores = {};
          options.forEach((opt) => {
            scores[opt.id] = opt.id === target_pick ? 0.85 : 0.15 / Math.max(1, options.length - 1);
          });
          return { scores };
        }
      };

      const mock_clm_adapter = {
        name: "clm",
        async choose({ context, options }) {
          const match = context.match(/\[\[LINE (\d+)\]\]/);
          const line_id = match ? Number(match[1]) : 0;
          const predictions = { 1: "josh", 2: "maren", 3: "josh", 5: "josh" };
          const target_pick = predictions[line_id] || "unknown";

          const scores = {};
          options.forEach((opt) => {
            scores[opt.id] = opt.id === target_pick ? 0.80 : 0.20 / Math.max(1, options.length - 1);
          });
          return { scores };
        }
      };

      const attribution_results = await attributeSpeakersAcrossParagraphs({
        paragraphs_list: paragraphs,
        dialogue_spans_list: spans,
        global_characters_list: mock_cast_profiles_list,
        classification_adapters_list: [mock_laya_adapter, mock_clm_adapter]
      });

      expect(attribution_results.length).toBe(5);

      // Line 1: Classifiers agree on Josh
      expect(attribution_results[0].speaker).toBe("josh");
      expect(attribution_results[0].evidence).toBe("classifier_agree");
      expect(attribution_results[0].confidence).toBeGreaterThan(0.7);

      // Line 2: Classifiers agree on Maren, listener is Josh
      expect(attribution_results[1].speaker).toBe("maren");
      expect(attribution_results[1].listener).toEqual(["josh"]);

      // Line 4: Tag rule catches 'said Maren' directly
      expect(attribution_results[3].speaker).toBe("maren");
      expect(attribution_results[3].evidence).toBe("tag");

      // Line 5: Vocative penalty suppresses Maren -> resolves to Josh
      expect(attribution_results[4].speaker).toBe("josh");
    });

    test("flags uncertain or tie lines for the review queue sorted by lowest confidence", async () => {
      // WHAT: Testing review queue sorting.
      // WHY: Lowest confidence lines must surface first for manual inspection.
      const paragraphs = [
        "Two shadows stood in the fog.",
        '"Who goes there?"',
        '"A friend."'
      ];
      const spans = [
        { id: 10, paraIndex: 1, text: "Who goes there?" },
        { id: 11, paraIndex: 2, text: "A friend." }
      ];

      // Disagreeing adapters
      const adapter_a = {
        name: "laya",
        async choose({ options }) {
          return { scores: { josh: 0.50, maren: 0.50 } };
        }
      };
      const adapter_b = {
        name: "clm",
        async choose({ options }) {
          return { scores: { josh: 0.40, maren: 0.60 } };
        }
      };

      const results = await attributeSpeakersAcrossParagraphs({
        paragraphs_list: paragraphs,
        dialogue_spans_list: spans,
        global_characters_list: mock_cast_profiles_list,
        classification_adapters_list: [adapter_a, adapter_b]
      });

      const review_queue = extract_sorted_review_queue_from_results(results);
      expect(review_queue.length).toBeGreaterThan(0);
      expect(review_queue[0].needs_review).toBe(true);
      // Spans never default to Narrator
      expect(review_queue[0].speaker).not.toBe("Narrator");
    });

    test("protects user-locked segments from overwrite and records them as ground truth", async () => {
      // WHAT: Testing user lock protection during attribution passes.
      // WHY: Lines marked is_user_locked: true must remain unchanged and count as authoritative turns.
      const paragraphs = [
        "Maren and Josh argued in the study.",
        '"I am leaving," Maren said.',
        '"You cannot."'
      ];
      const spans = [
        { id: "span_1", paraIndex: 1, text: "I am leaving," },
        { id: "span_2", paraIndex: 2, text: "You cannot." }
      ];

      const reference_segments = [
        { id: "span_1", text: "I am leaving,", speaker: "maren", is_user_locked: false },
        { id: "span_2", text: "You cannot.", speaker: "clerk", is_user_locked: true } // User manually assigned clerk
      ];

      const adapter = {
        name: "laya",
        async choose() {
          return { scores: { josh: 0.85, maren: 0.15 } };
        }
      };

      const results = await attributeSpeakersAcrossParagraphs({
        paragraphs_list: paragraphs,
        dialogue_spans_list: spans,
        global_characters_list: mock_cast_profiles_list,
        classification_adapters_list: [adapter],
        existing_reference_segments: reference_segments
      });

      // Line 2 was user-locked to clerk, so it must stay clerk with 1.0 confidence
      expect(results[1].speaker).toBe("clerk");
      expect(results[1].is_user_locked).toBe(true);
      expect(results[1].evidence).toBe("user_locked");
      expect(results[1].confidence).toBe(1.0);
    });

    test("attaches proposed_diff when predicted speaker diverges from non-locked reference", async () => {
      // WHAT: Testing proposed diff generation.
      // WHY: Divergent predictions become reviewable diffs rather than silent overwrites.
      const paragraphs = [
        "Maren and Josh argued.",
        '"I know what you did."'
      ];
      const spans = [
        { id: "span_101", paraIndex: 1, text: "I know what you did." }
      ];

      const reference_segments = [
        { id: "span_101", text: "I know what you did.", speaker: "josh", is_user_locked: false }
      ];

      // Adapter predicts Maren
      const adapter = {
        name: "laya",
        async choose() {
          return { scores: { maren: 0.90, josh: 0.10 } };
        }
      };

      const results = await attributeSpeakersAcrossParagraphs({
        paragraphs_list: paragraphs,
        dialogue_spans_list: spans,
        global_characters_list: mock_cast_profiles_list,
        classification_adapters_list: [adapter],
        existing_reference_segments: reference_segments
      });

      expect(results[0].speaker).toBe("maren");
      expect(results[0].proposed_diff).toBeDefined();
      expect(results[0].proposed_diff.previous_speaker).toBe("josh");
      expect(results[0].proposed_diff.proposed_speaker).toBe("maren");
      expect(results[0].needs_review).toBe(true);
    });
  });
});

/** @jest-environment node */

// =========================================================================
// UNIT TESTS - FOUNTAIN SERVICE & BEAT-STYLE ANALYTICS ENGINE
// =========================================================================
// WHAT: Validates bi-directional Fountain format serialization/parsing,
//       Beat-inspired script analytics, scene outline cards, and revision diff caching.
// WHY: Ensures audiobooks can round-trip through Fountain plain text (editable in Beat/VS Code)
//       without losing directorial cues, relationship snapshots, or line metadata.

const {
  serialize_segments_to_fountain,
  parse_fountain_to_segments,
  compute_script_analytics,
  generate_scene_outline_cards,
  compute_revision_diff_and_cache_plan,
  compute_deterministic_segment_hash
} = require("../services/fountain_service");

describe("Fountain Intermediate Specification Engine", () => {
  const mock_sample_script_segments = [
    {
      id: "seg_1",
      type: "narrator",
      speaker: "Narrator",
      text: "The snow hammered against the weathered timber of the cabin.",
      direction: "calm, steady narration",
      scene_heading: "INT. CABIN - NIGHT",
      scene_synopsis: "Kvothe and Chronicler settle by the fire.",
      relationship_snapshot: {
        "kvothe_chronicler": { relation_tone: "tense", power_dynamic: "equal" }
      }
    },
    {
      id: "seg_2",
      type: "dialogue",
      speaker: "Chronicler",
      text: "You cannot simply bury the truth under silence.",
      direction: "urgent, leaning forward",
      scene_heading: "INT. CABIN - NIGHT",
      confidence: 0.94
    },
    {
      id: "seg_3",
      type: "dialogue",
      speaker: "Kvothe",
      text: "Silence is often the kindest thing we can offer.",
      direction: "quiet, gravelly rasp",
      scene_heading: "INT. CABIN - NIGHT",
      confidence: 0.98
    },
    {
      id: "seg_4",
      type: "narrator",
      speaker: "Narrator",
      text: "Morning broke cold and sharp over the mountain ridge.",
      scene_heading: "EXT. MOUNTAIN PASS - DAWN",
      scene_synopsis: "The travelers depart into the bitter frost.",
      chapter_title: "Chapter 2: The Ascent",
      is_chapter_start: true
    },
    {
      id: "seg_5",
      type: "dialogue",
      speaker: "Bast",
      text: "Reshi, the path is frozen solid.",
      direction: "hesitant, shivering",
      scene_heading: "EXT. MOUNTAIN PASS - DAWN",
      confidence: 0.92
    }
  ];

  describe("Serialization (Segments to Fountain)", () => {
    test("serializes segments into valid Fountain text with character cues and parentheticals", () => {
      const fountain_output_text = serialize_segments_to_fountain(mock_sample_script_segments, {
        title: "The Name of the Wind",
        author: "Patrick Rothfuss"
      });

      expect(fountain_output_text).toContain("Title: The Name of the Wind");
      expect(fountain_output_text).toContain("Author: Patrick Rothfuss");
      expect(fountain_output_text).toContain("INT. CABIN - NIGHT");
      expect(fountain_output_text).toContain("= Kvothe and Chronicler settle by the fire.");
      expect(fountain_output_text).toContain("@Chronicler");
      expect(fountain_output_text).toContain("(urgent, leaning forward)");
      expect(fountain_output_text).toContain("You cannot simply bury the truth under silence.");
      expect(fountain_output_text).toContain("@Kvothe");
      expect(fountain_output_text).toContain("(quiet, gravelly rasp)");
      expect(fountain_output_text).toContain("# Chapter 2: The Ascent");
      expect(fountain_output_text).toContain("EXT. MOUNTAIN PASS - DAWN");
      expect(fountain_output_text).toContain("/* [[meta:");
      expect(fountain_output_text).toContain("/* [[relationship_snapshot:");
    });
  });

  describe("Parsing (Fountain to Segments)", () => {
    test("parses Fountain text back into structured script segments preserving cues", () => {
      const fountain_plain_text = `Title: Test Script
Author: Jane Doe
===

.INT. COUNCIL CHAMBER - DAY
= Marcus confronts the council.

The councilors sat in rigid rows under the high vaulted stone.

@MARCUS
(angry, clipped)
We have waited three weeks for your answer.

@ELENA
(measured, cold)
And you will wait three more if necessary.
`;

      const parsed_result = parse_fountain_to_segments(fountain_plain_text);

      expect(parsed_result.title_metadata.title).toBe("Test Script");
      expect(parsed_result.title_metadata.author).toBe("Jane Doe");
      expect(parsed_result.script_segments.length).toBe(3);

      const [narrator_seg, marcus_seg, elena_seg] = parsed_result.script_segments;

      expect(narrator_seg.type).toBe("narrator");
      expect(narrator_seg.text).toContain("rigid rows under the high vaulted stone");
      expect(narrator_seg.scene_heading).toBe("INT. COUNCIL CHAMBER - DAY");
      expect(narrator_seg.scene_synopsis).toBe("Marcus confronts the council.");

      expect(marcus_seg.type).toBe("dialogue");
      expect(marcus_seg.speaker).toBe("MARCUS");
      expect(marcus_seg.direction).toBe("angry, clipped");
      expect(marcus_seg.text).toBe("We have waited three weeks for your answer.");

      expect(elena_seg.type).toBe("dialogue");
      expect(elena_seg.speaker).toBe("ELENA");
      expect(elena_seg.direction).toBe("measured, cold");
      expect(elena_seg.text).toBe("And you will wait three more if necessary.");
    });

    test("preserves embedded metadata and IDs through a full round-trip serialization", () => {
      const fountain_text = serialize_segments_to_fountain(mock_sample_script_segments, {
        title: "Round Trip Test"
      });

      const parsed_round_trip = parse_fountain_to_segments(fountain_text);

      expect(parsed_round_trip.script_segments.length).toBe(mock_sample_script_segments.length);

      const segment_2 = parsed_round_trip.script_segments[1];
      expect(segment_2.id).toBe("seg_2");
      expect(segment_2.speaker).toBe("Chronicler");
      expect(segment_2.direction).toBe("urgent, leaning forward");
      expect(segment_2.text).toBe("You cannot simply bury the truth under silence.");
      expect(segment_2.confidence).toBe(0.94);
    });
  });

  describe("Beat-Style Script Analytics", () => {
    test("calculates dialogue distribution, casting tiers, and runtime estimation", () => {
      const voice_mapping = {
        "Kvothe": "voice_kvothe_v1",
        "Chronicler": "voice_chronicler_v1"
      };

      const analytics = compute_script_analytics(mock_sample_script_segments, voice_mapping);

      expect(analytics.summary.total_segments_count).toBe(5);
      expect(analytics.summary.total_dialogue_lines_count).toBe(3);
      expect(analytics.summary.total_narrator_lines_count).toBe(2);
      expect(analytics.summary.total_unique_characters_count).toBe(3); // Chronicler, Kvothe, Bast
      expect(analytics.summary.total_scenes_count).toBe(2);
      expect(analytics.summary.interior_scenes_count).toBe(1);
      expect(analytics.summary.exterior_scenes_count).toBe(1);
      expect(analytics.summary.estimated_runtime_seconds).toBeGreaterThan(0);

      // Verify character stats
      const character_stats = analytics.character_dialogue_distribution;
      expect(character_stats.length).toBe(3);

      const bast_stat = character_stats.find((c) => c.speaker === "Bast");
      expect(bast_stat).toBeDefined();
      expect(bast_stat.has_assigned_voice).toBe(false);

      // Verify sanity checks flag low line count characters
      const low_count_flag = analytics.sanity_flags.find((f) => f.type === "SUSPICIOUS_LOW_LINE_COUNT" && f.speaker === "Bast");
      expect(low_count_flag).toBeDefined();
    });
  });

  describe("Index Card / Outline View Generator", () => {
    test("groups segments into scene cards with characters present and relationship state", () => {
      const outline_cards = generate_scene_outline_cards(mock_sample_script_segments);

      expect(outline_cards.length).toBe(2);

      const [scene_1_card, scene_2_card] = outline_cards;

      expect(scene_1_card.scene_number).toBe(1);
      expect(scene_1_card.scene_heading).toBe("INT. CABIN - NIGHT");
      expect(scene_1_card.synopsis).toBe("Kvothe and Chronicler settle by the fire.");
      expect(scene_1_card.characters_present).toEqual(expect.arrayContaining(["Chronicler", "Kvothe"]));
      expect(scene_1_card.relationship_snapshot.kvothe_chronicler.relation_tone).toBe("tense");
      expect(scene_1_card.dialogue_lines_count).toBe(2);
      expect(scene_1_card.narrator_lines_count).toBe(1);

      expect(scene_2_card.scene_number).toBe(2);
      expect(scene_2_card.scene_heading).toBe("EXT. MOUNTAIN PASS - DAWN");
      expect(scene_2_card.chapter_title).toBe("Chapter 2: The Ascent");
      expect(scene_2_card.characters_present).toEqual(["Bast"]);
    });
  });

  describe("Revision Tracking & Audio Diff Caching", () => {
    test("identifies unchanged lines vs dirty lines needing TTS synthesis", () => {
      // 1. Initial run creates cached audio
      const initial_segments = JSON.parse(JSON.stringify(mock_sample_script_segments));
      const audio_cache_map = {};

      for (const seg of initial_segments) {
        const hash = compute_deterministic_segment_hash({
          speaker_name: seg.speaker,
          delivery_direction: seg.direction,
          spoken_text: seg.text,
          assigned_voice_id: "default"
        });
        seg.hash = hash;
        audio_cache_map[hash] = `/audio/cache/${hash}.wav`;
      }

      // 2. Draft edit: modify seg_2 text and add a new seg_6
      const edited_segments = JSON.parse(JSON.stringify(initial_segments));
      edited_segments[1].text = "You cannot simply bury the truth beneath cold stone."; // Edited line!
      delete edited_segments[1].hash; // Hash will change

      edited_segments.push({
        id: "seg_6",
        type: "dialogue",
        speaker: "Kvothe",
        text: "Then bring the fire.",
        direction: "firmly"
      });

      const diff_plan = compute_revision_diff_and_cache_plan(initial_segments, edited_segments, audio_cache_map);

      // Total current: 6 segments
      // seg_1, seg_3, seg_4, seg_5 should be reusable from cache (4 lines = 66.7%)
      // seg_2 (modified) + seg_6 (new) should be dirty (2 lines to render)
      expect(diff_plan.summary.total_segments_count).toBe(6);
      expect(diff_plan.summary.reusable_cached_count).toBe(4);
      expect(diff_plan.summary.dirty_rerender_count).toBe(2);
      expect(diff_plan.summary.new_added_count).toBe(1);
      expect(diff_plan.summary.compute_savings_percentage).toBeCloseTo(66.7, 1);

      const dirty_ids = diff_plan.dirty_segments_to_render.map((s) => s.id);
      expect(dirty_ids).toContain("seg_2");
      expect(dirty_ids).toContain("seg_6");
    });
  });
});

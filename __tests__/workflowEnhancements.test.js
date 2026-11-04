/** @jest-environment jsdom */

// =========================================================================
// UNIT TESTS - WORKFLOW ENHANCEMENTS SUITE
// =========================================================================
// WHAT: Tests the Smart Sanitizer, Chapter Detection, Triage Navigator,
//       Confidence Minimap, Batch Speaker Reassignment, and Undo/Redo Engine.
// WHY: Ensures all director workflow conveniences execute flawlessly.

const fs = require("fs");
const { sanitize_book_manuscript_text, detect_manuscript_chapters } = require("../services/text_sanitizer_service");
const {
  is_segment_doubtful,
  update_triage_doubt_counter,
  jump_to_next_uncertain_line,
  toggle_segment_flag,
  render_screenplay_confidence_minimap,
  open_batch_speaker_reassign_modal,
  execute_batch_speaker_reassignment,
  apply_quick_direction_chip,
  push_undo_history_snapshot,
  undo_last_script_change,
  redo_last_script_change,
  select_and_inspect_segment,
  get_active_inspected_segment_index,
  set_active_inspected_segment_index
} = require("../renderer/js/editor");

describe("Workflow Enhancements & Usability Suite", () => {
  describe("Text Sanitizer & Chapter Detection Service", () => {
    test("normalizes curly quotes, em-dashes, and strips footnotes", () => {
      const raw_prose = `\u201CHello,\u201D she murmured\u2014\u201Cyou didn\u2019t see the guard[1]?\u201D\n\n\u2018No,\u2019 he replied---\u2018not a soul.\u2019`;
      const cleaned = sanitize_book_manuscript_text(raw_prose);

      expect(cleaned).toContain('"Hello," she murmured—"you didn\'t see the guard?"');
      expect(cleaned).toContain("'No,' he replied—'not a soul.'");
      expect(cleaned).not.toContain("[1]");
    });

    test("merges soft line wraps breaking mid-sentence", () => {
      const raw_wrapped_prose = "The old iron door swung open with a hollow groan as\nshe stepped cautiously across the threshold.";
      const cleaned = sanitize_book_manuscript_text(raw_wrapped_prose);

      expect(cleaned).toBe("The old iron door swung open with a hollow groan as she stepped cautiously across the threshold.");
    });

    test("detects chapter headings and splits manuscript into discrete chapters", () => {
      const manuscript = `
# Chapter 1: The Gathering
Kvothe sat by the hearth.

Chapter 2: The Waystone
The wind howled outside.

ACT III — The Reckoning
The door opened suddenly.
      `.trim();

      const chapters = detect_manuscript_chapters(manuscript);
      expect(chapters.length).toBe(3);
      expect(chapters[0].title).toContain("Chapter 1");
      expect(chapters[1].title).toContain("Chapter 2");
      expect(chapters[2].title).toContain("Act III");
    });
  });

  describe("Triage Navigator, Minimap & Undo/Redo Engine in Editor DOM", () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="screenplay_segment_cards_wrapper"></div>
        <div id="screenplay_confidence_minimap" class="screenplay_minimap_container"></div>
        <span id="label_triage_doubt_counter"></span>
        <button id="btn_continuous_playback_toggle">Play Continuous</button>
        <div id="line_inspector_content_container"></div>
        <span id="inspector_active_line_badge"></span>
        <audio id="individual_clip_audio_player"></audio>
        
        <div id="batch_reassign_modal" class="d-none">
          <select id="select_batch_source_speaker"></select>
          <select id="select_batch_target_speaker"></select>
          <span id="batch_reassign_affected_count_label"></span>
        </div>
      `;

      window.active_loaded_project_state_object = {
        projectName: "TestBook",
        voiceMapping: {
          "Narrator": { model: "default" },
          "Kvothe": { model: "kvothe_voice" }
        },
        scriptSegments: [
          {
            index_position: 0,
            type: "narrator",
            speaker: "Narrator",
            text: "High confidence narration line.",
            confidence: 0.98,
            direction: "calm"
          },
          {
            index_position: 1,
            type: "dialogue",
            speaker: "Character", // Unknown placeholder -> Doubt!
            text: "Who goes there?",
            confidence: 0.62, // Low confidence -> Doubt!
            direction: "tense"
          },
          {
            index_position: 2,
            type: "dialogue",
            speaker: "Kvothe",
            text: "Just an old traveler.",
            confidence: 0.95,
            direction: "steady"
          }
        ]
      };

      window.alert = jest.fn();
    });

    test("is_segment_doubtful correctly flags low confidence and placeholder speakers", () => {
      const seg0 = window.active_loaded_project_state_object.scriptSegments[0];
      const seg1 = window.active_loaded_project_state_object.scriptSegments[1];
      const seg2 = window.active_loaded_project_state_object.scriptSegments[2];

      expect(is_segment_doubtful(seg0)).toBe(false);
      expect(is_segment_doubtful(seg1)).toBe(true); // Confidence 0.62 + speaker 'Character'
      expect(is_segment_doubtful(seg2)).toBe(false);

      seg2.is_flagged = true;
      expect(is_segment_doubtful(seg2)).toBe(true); // Flagged for review
    });

    test("update_triage_doubt_counter updates header label accurately", () => {
      update_triage_doubt_counter();
      const label = document.getElementById("label_triage_doubt_counter");
      expect(label.textContent).toBe("1 Doubt");

      window.active_loaded_project_state_object.scriptSegments[2].is_flagged = true;
      update_triage_doubt_counter();
      expect(label.textContent).toBe("2 Doubts");
    });

    test("jump_to_next_uncertain_line navigates to line 1", () => {
      set_active_inspected_segment_index(0);
      jump_to_next_uncertain_line(1);
      expect(get_active_inspected_segment_index()).toBe(1);
    });

    test("render_screenplay_confidence_minimap builds green and red pips", () => {
      render_screenplay_confidence_minimap();
      const minimap = document.getElementById("screenplay_confidence_minimap");
      const pips = minimap.querySelectorAll(".minimap_pip");

      expect(pips.length).toBe(3);
      expect(pips[0].classList.contains("minimap_pip_green")).toBe(true);
      expect(pips[1].classList.contains("minimap_pip_red")).toBe(true); // Low conf
      expect(pips[2].classList.contains("minimap_pip_green")).toBe(true);
    });

    test("undo and redo history snapshots restore previous script state", () => {
      push_undo_history_snapshot("Initial State");

      // Mutate
      window.active_loaded_project_state_object.scriptSegments[1].speaker = "Bast";
      expect(window.active_loaded_project_state_object.scriptSegments[1].speaker).toBe("Bast");

      // Undo
      undo_last_script_change();
      expect(window.active_loaded_project_state_object.scriptSegments[1].speaker).toBe("Character");

      // Redo
      redo_last_script_change();
      expect(window.active_loaded_project_state_object.scriptSegments[1].speaker).toBe("Bast");
    });

    test("batch speaker reassignment reassigns all matching occurrences", async () => {
      // Add another Character segment
      window.active_loaded_project_state_object.scriptSegments.push({
        index_position: 3,
        type: "dialogue",
        speaker: "Character",
        text: "Are you certain?",
        confidence: 0.65
      });

      open_batch_speaker_reassign_modal("Character");
      const target_select = document.getElementById("select_batch_target_speaker");
      target_select.value = "Kvothe";

      await execute_batch_speaker_reassignment();

      const segs = window.active_loaded_project_state_object.scriptSegments;
      expect(segs[1].speaker).toBe("Kvothe");
      expect(segs[3].speaker).toBe("Kvothe");
    });

    test("apply_quick_direction_chip updates segment direction and qwen_style", () => {
      apply_quick_direction_chip(1, "whispering, breathless");
      const seg1 = window.active_loaded_project_state_object.scriptSegments[1];

      expect(seg1.direction).toBe("whispering, breathless");
      expect(seg1.qwen_style.rich_emotion).toBe("whispering, breathless");
    });
  });
});

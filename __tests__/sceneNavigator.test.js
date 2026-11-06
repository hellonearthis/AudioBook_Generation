/** @jest-environment jsdom */

// =========================================================================
// UNIT TESTS - SCENE NAVIGATOR & BRITISH DIALOGUE CONVERSION
// =========================================================================
// WHAT: Tests the multi-scene navigator bar, chapter switching, and British
//       single-quote dialogue normalization.
// WHY: Ensures directors can seamlessly view and switch scripts across all 115
//       scenes and that single-quoted literary dialogue parses with 100% fidelity.

const { normalize_british_dialogue_quotes } = require("../services/text_sanitizer_service");
const {
  initialize_scene_navigator_ui,
  handle_editor_scene_selection_change,
  jump_to_relative_scene,
  update_scene_navigator_buttons_and_badge
} = require("../renderer/js/editor");

describe("Scene Navigator & British Dialogue Suite", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="editor_scene_navigator_bar" class="d-none">
        <button id="btn_prev_scene">Prev</button>
        <select id="editor_scene_selector"></select>
        <button id="btn_next_scene">Next</button>
        <span id="scene_nav_stats"></span>
        <span id="scene_attribution_status_badge"></span>
      </div>
      <textarea id="raw_source_book_textarea_editor"></textarea>
      <div id="screenplay_segment_cards_wrapper"></div>
      <div id="directorial_cards_wrapper"></div>
      <div id="screenplay_confidence_minimap"></div>
    `;

    window.active_loaded_project_state_object = {
      projectName: "the_player_of_games",
      is_multi_chapter: true,
      active_chapter_id: "p1_s01",
      rawBookText: "Scene 1 text",
      scriptSegments: [
        { type: "narrator", speaker: "Narrator", text: "Introduction." },
        { type: "dialogue", speaker: "Gurgeh", text: "I'll play." }
      ],
      chapters: [
        {
          chapter_id: "p1_s01",
          chapter_title: "Part 1 - Scene 01",
          part_title: "Part 1: Culture Plate",
          raw_text: "Scene 1 text",
          word_count: 50,
          scriptSegments: [
            { type: "narrator", speaker: "Narrator", text: "Introduction." },
            { type: "dialogue", speaker: "Gurgeh", text: "I'll play." }
          ]
        },
        {
          chapter_id: "p1_s02",
          chapter_title: "Part 1 - Scene 02",
          part_title: "Part 1: Culture Plate",
          raw_text: "Scene 2 text with dialogue.",
          word_count: 120,
          scriptSegments: [
            { type: "dialogue", speaker: "Yay", text: "Wake up, Gurgeh!" }
          ]
        },
        {
          chapter_id: "p2_s01",
          chapter_title: "Part 2 - Scene 01",
          part_title: "Part 2: Imperium",
          raw_text: "Scene 3 raw text.",
          word_count: 200,
          scriptSegments: []
        }
      ],
      voiceMapping: {
        "Narrator": { voice: "Narrator" },
        "Gurgeh": { voice: "Gurgeh" },
        "Yay": { voice: "Yay" }
      }
    };
  });

  describe("British Dialogue Quote Normalization", () => {
    test("converts single-quoted dialogue to double quotes while preserving internal contractions", () => {
      const input = `'Don't be so pompous,' she told him. 'I don't think it's Yay's fault.'`;
      const output = normalize_british_dialogue_quotes(input);

      expect(output).toBe(`"Don't be so pompous," she told him. "I don't think it's Yay's fault."`);
    });

    test("accurately captures dialogue with exclamations, question marks, and commas", () => {
      const input = `'Wake up, Gurgeh!' Yay laughed. 'You were terrible,' she said. 'So?'`;
      const output = normalize_british_dialogue_quotes(input);

      expect(output).toContain('"Wake up, Gurgeh!"');
      expect(output).toContain('"You were terrible,"');
      expect(output).toContain('"So?"');
    });

    test("leaves standard double quotes untouched", () => {
      const input = `"Hello there," he said.`;
      const output = normalize_british_dialogue_quotes(input);

      expect(output).toBe(`"Hello there," he said.`);
    });
  });

  describe("Scene Navigator UI & Switching", () => {
    test("populates scene selector grouped by Part", () => {
      initialize_scene_navigator_ui();

      const selector = document.getElementById("editor_scene_selector");
      const optgroups = selector.querySelectorAll("optgroup");
      expect(optgroups.length).toBe(2);
      expect(optgroups[0].label).toContain("Part 1: Culture Plate");
      expect(optgroups[1].label).toContain("Part 2: Imperium");

      const options = selector.querySelectorAll("option");
      expect(options.length).toBe(3);
      expect(selector.value).toBe("p1_s01");
    });

    test("switches scenes and loads corresponding script segments", async () => {
      initialize_scene_navigator_ui();
      await handle_editor_scene_selection_change("p1_s02");

      expect(window.active_loaded_project_state_object.active_chapter_id).toBe("p1_s02");
      expect(window.active_loaded_project_state_object.rawBookText).toBe("Scene 2 text with dialogue.");
      expect(window.active_loaded_project_state_object.scriptSegments.length).toBe(1);
      expect(window.active_loaded_project_state_object.scriptSegments[0].speaker).toBe("Yay");
    });

    test("jump_to_relative_scene advances to next scene correctly", async () => {
      initialize_scene_navigator_ui();
      expect(window.active_loaded_project_state_object.active_chapter_id).toBe("p1_s01");

      await jump_to_relative_scene(1);
      expect(window.active_loaded_project_state_object.active_chapter_id).toBe("p1_s02");
    });
  });
});

/** @jest-environment jsdom */
const filesystem_library = require("fs");
const path_library = require("path");

const editor_script_content = filesystem_library.readFileSync(
  path_library.resolve(__dirname, "../renderer/js/editor.js"),
  "utf8"
);
const app_script_content = filesystem_library.readFileSync(
  path_library.resolve(__dirname, "../renderer/js/app.js"),
  "utf8"
);

describe("Unmarked Dialogue / Literary Mode (Decoupled Stage 2A & 2B)", () => {
  beforeEach(() => {
    // Setup test DOM
    document.body.innerHTML = `
      <textarea id="raw_source_book_textarea_editor">He stood looking down at the river. We have to keep moving he said. The boy looked up. Are we going south?</textarea>
      <select id="attribution_engine_selector">
        <option value="laya" selected>⚡ Laya Fast (~20ms)</option>
        <option value="hybrid">⚡🧠 Hybrid (Laya + llama)</option>
        <option value="llm">🧠 llama.cpp (Deep LLM)</option>
      </select>
      <input type="checkbox" id="unmarked_dialogue_toggle" checked />
      <input id="settings_lm_studio_endpoint_input" value="http://127.0.0.1:8080/v1" />
      <input id="settings_comfyui_endpoint_input" value="http://127.0.0.1:8188" />
      <input id="settings_laya_endpoint_input" value="http://127.0.0.1:8765" />
      <div id="screenplay_segment_cards_wrapper"></div>
      <div id="project_selection_cards_grid"></div>
      <span id="active_workspace_directory_display_label"></span>
      <span id="sidebar_active_workspace_name"></span>
    `;

    localStorage.clear();

    window.audiobook_api = {
      trigger_laya_attribution: jest.fn(),
      trigger_dialogue_attribution: jest.fn(),
      check_laya_status: jest.fn(),
      save_audiobook_project_state: jest.fn().mockResolvedValue(true),
      subscribe_to_generation_status_updates: jest.fn(),
      subscribe_to_lm_studio_warnings: jest.fn()
    };

    window.active_loaded_project_state_object = {
      projectName: "TheRoadMock",
      voiceMapping: {
        "Narrator": {},
        "The Man": { gender: "Male", age: "Middle-aged", traits: "weary, determined" },
        "The Boy": { gender: "Male", age: "Child", traits: "scared, innocent" }
      },
      scriptSegments: []
    };

    window.active_selected_workspace_directory_path = "/mock/workspace";
    window.trigger_project_state_disk_flush = jest.fn().mockResolvedValue(true);
    window.populate_voice_matrix_configuration_cards = jest.fn();
    window.refresh_synthesis_progress_tracking_meters = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);

    window.configuration_lm_studio_api_url_address = "http://127.0.0.1:8080/v1/chat/completions";
    window.configuration_laya_api_url_address = "http://127.0.0.1:8765";
    window.configuration_comfyui_api_url_address = "http://127.0.0.1:8188";
    window.configuration_attribution_engine = "laya";
    window.configuration_unmarked_dialogue = true;

    window.eval(app_script_content + "\n" + editor_script_content);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("UI Toggle & Configuration Persistence", () => {
    it("persists unmarked dialogue setting to localStorage", () => {
      const toggle = document.getElementById("unmarked_dialogue_toggle");
      toggle.checked = true;
      save_global_configurations();

      expect(localStorage.getItem("setting_unmarked_dialogue")).toBe("true");
      expect(window.configuration_unmarked_dialogue).toBe(true);

      toggle.checked = false;
      save_global_configurations();

      expect(localStorage.getItem("setting_unmarked_dialogue")).toBe("false");
      expect(window.configuration_unmarked_dialogue).toBe(false);
    });
  });

  describe("2-Stage Unmarked Attribution Orchestration", () => {
    it("passes unmarked_dialogue_mode: true to trigger_laya_attribution when toggle is active", async () => {
      document.getElementById("unmarked_dialogue_toggle").checked = true;
      document.getElementById("attribution_engine_selector").value = "laya";

      window.audiobook_api.trigger_laya_attribution.mockResolvedValueOnce({
        script_segments: [
          { type: "narrator", speaker: "Narrator", text: "He stood looking down at the river.", direction: "calm, steady narration", confidence: 1.0, engine: "narrator" },
          { type: "dialogue", speaker: "The Man", text: "We have to keep moving", direction: "calm delivery, moderate conversational energy", confidence: 0.91, emotion: "calm", energy: 1.0, is_ambiguous: false, unmarked: true, engine: "laya" },
          { type: "narrator", speaker: "Narrator", text: "he said. The boy looked up.", direction: "calm, steady narration", confidence: 1.0, engine: "narrator" },
          { type: "dialogue", speaker: "The Boy", text: "Are we going south?", direction: "fearful delivery, soft subdued tone", confidence: 0.85, emotion: "fearful", energy: 0.7, is_ambiguous: false, unmarked: true, engine: "laya" }
        ],
        unmarked_mode: true,
        performance: { elapsed_ms: 45, laya_queries: 2 }
      });

      await run_main_pipeline_pass_one_and_two();

      expect(window.audiobook_api.trigger_laya_attribution).toHaveBeenCalledTimes(1);
      const passed_options = window.audiobook_api.trigger_laya_attribution.mock.calls[0][0];
      expect(passed_options.unmarked_dialogue_mode).toBe(true);
      expect(passed_options.voice_mapping_context).toHaveProperty("The Man");
      expect(passed_options.voice_mapping_context).toHaveProperty("The Boy");

      // Verify segments in active state
      const segments = window.active_loaded_project_state_object.scriptSegments;
      expect(segments.length).toBe(4);
      expect(segments[1].speaker).toBe("The Man");
      expect(segments[1].unmarked).toBe(true);
      expect(segments[3].speaker).toBe("The Boy");
      expect(segments[3].unmarked).toBe(true);
    });
  });

  describe("Screenplay Card Rendering with Unmarked Badge", () => {
    it("renders .unmarked_span_badge on unmarked dialogue cards", () => {
      window.active_loaded_project_state_object.scriptSegments = [
        {
          index_position: 0,
          type: "narrator",
          speaker: "Narrator",
          text: "The sun was gray and dead.",
          direction: "calm, steady narration"
        },
        {
          index_position: 1,
          type: "dialogue",
          speaker: "The Man",
          text: "We have to keep moving",
          direction: "calm delivery",
          confidence: 0.91,
          unmarked: true,
          engine: "laya"
        }
      ];

      populate_screenplay_cards_in_editor_view();

      const cards_container = document.getElementById("screenplay_segment_cards_wrapper");
      const unmarked_badges = cards_container.querySelectorAll(".unmarked_span_badge");

      expect(unmarked_badges.length).toBe(1);
      expect(unmarked_badges[0].textContent).toContain("📖 Unmarked");
    });
  });
});

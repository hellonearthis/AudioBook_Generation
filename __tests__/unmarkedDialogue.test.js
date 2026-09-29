/** @jest-environment jsdom */
const filesystem_library = require("fs");
const path_library = require("path");

jest.mock("../services/service_health_service", () => {
  const actual = jest.requireActual("../services/service_health_service");
  return {
    ...actual,
    ensure_laya_ready: jest.fn().mockResolvedValue(true),
    ensure_clm_ready: jest.fn().mockResolvedValue(true),
    probe_service_health: jest.fn().mockResolvedValue(false)
  };
});

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
      <input id="settings_lm_studio_endpoint_input" value="http://127.0.0.1:8081/v1" />
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

    window.configuration_lm_studio_api_url_address = "http://127.0.0.1:8081/v1/chat/completions";
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

  describe("Backend Arm 3 Joint Routing & Resilient Fallback (laya_clm_service)", () => {
    const { register_laya_clm_handlers } = require("../services/laya_clm_service");
    const service_health_service = require("../services/service_health_service");

    let mockIpcMain;
    let handlersMap;

    beforeEach(() => {
      service_health_service.ensure_laya_ready.mockClear();
      service_health_service.probe_service_health.mockClear();
      service_health_service.probe_service_health.mockResolvedValue(false);
      handlersMap = {};
      mockIpcMain = {
        handle: jest.fn((channel, handler) => {
          handlersMap[channel] = handler;
        })
      };
    });

    test("routes unmarked dialogue to Arm 3 joint LLM and triggers non-blocking shadow probe", async () => {
      service_health_service.probe_service_health.mockResolvedValueOnce(true); // Laya probe returns online for shadow QC
      const mockDetectJoint = jest.fn().mockResolvedValue([
        { type: "narrator", text: "He walked slowly." },
        { type: "dialogue", speaker: "The Man", text: "We need water.", emotion: "weary", energy: 0.8 }
      ]);
      const mockDetectSpans = jest.fn();

      register_laya_clm_handlers(mockIpcMain, () => mockDetectSpans, () => mockDetectJoint);
      const layaHandler = handlersMap["ai:laya-attribute"];
      expect(layaHandler).toBeDefined();

      const result = await layaHandler({}, {
        book_text_segment: "He walked slowly. We need water.",
        unmarked_dialogue_mode: true,
        voice_mapping_context: {
          "The Man": { gender: "Male", age: "Adult" }
        },
        laya_endpoint_url: "http://127.0.0.1:8765"
      });

      expect(mockDetectJoint).toHaveBeenCalledTimes(1);
      expect(mockDetectSpans).not.toHaveBeenCalled();
      expect(result.script_segments).toHaveLength(2);
      expect(result.script_segments[0].engine).toBe("joint_llm");
      expect(result.script_segments[1].engine).toBe("joint_llm");
      expect(result.script_segments[1].confidence).toBe(0.95);
      expect(result.script_segments[1].speaker).toBe("The Man");
      expect(result.script_segments[1].unmarked).toBe(true);

      // Verify non-blocking shadow probe checked health
      expect(service_health_service.probe_service_health).toHaveBeenCalled();
    });

    test("falls back to Stage 2A decoupled detect_spans when Arm 3 joint function throws an error", async () => {
      const mockDetectJoint = jest.fn().mockRejectedValue(new Error("LLM connection timeout"));
      const mockDetectSpans = jest.fn().mockResolvedValue([
        { type: "narrator", text: "He walked slowly." },
        { type: "dialogue", text: "We need water." }
      ]);

      register_laya_clm_handlers(mockIpcMain, () => mockDetectSpans, () => mockDetectJoint);
      const layaHandler = handlersMap["ai:laya-attribute"];

      const result = await layaHandler({}, {
        book_text_segment: "He walked slowly. We need water.",
        unmarked_dialogue_mode: true,
        voice_mapping_context: {
          "The Man": { gender: "Male", age: "Adult" }
        },
        laya_endpoint_url: "http://127.0.0.1:8765"
      });

      expect(mockDetectJoint).toHaveBeenCalledTimes(1);
      expect(mockDetectSpans).toHaveBeenCalledTimes(1);
      expect(result.script_segments.length).toBeGreaterThan(0);
    });

    test("falls back to Stage 2A decoupled detect_spans when Arm 3 returns empty array", async () => {
      const mockDetectJoint = jest.fn().mockResolvedValue([]);
      const mockDetectSpans = jest.fn().mockResolvedValue([
        { type: "narrator", text: "He walked slowly." }
      ]);

      register_laya_clm_handlers(mockIpcMain, () => mockDetectSpans, () => mockDetectJoint);
      const layaHandler = handlersMap["ai:laya-attribute"];

      const result = await layaHandler({}, {
        book_text_segment: "He walked slowly.",
        unmarked_dialogue_mode: true,
        voice_mapping_context: {
          "The Man": { gender: "Male", age: "Adult" }
        },
        laya_endpoint_url: "http://127.0.0.1:8765"
      });

      expect(mockDetectJoint).toHaveBeenCalledTimes(1);
      expect(mockDetectSpans).toHaveBeenCalledTimes(1);
      expect(result.script_segments).toHaveLength(1);
      expect(result.script_segments[0].engine).toBe("narrator");
    });
  });
});


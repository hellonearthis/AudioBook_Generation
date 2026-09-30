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

describe("Laya Fast Decision Engine Integration", () => {
  beforeEach(() => {
    // Set up minimal required DOM for editor and settings
    document.body.innerHTML = `
      <textarea id="raw_source_book_textarea_editor">"Hello there," said John. "We must hurry!" Jane whispered in terror.</textarea>
      <select id="attribution_engine_selector">
        <option value="laya" selected>⚡ Laya Fast (~20ms)</option>
        <option value="clm">🎯 CLM-8B System One (~100ms)</option>
        <option value="cascade">⚡🎯 Cascade (Laya → CLM)</option>
        <option value="hybrid">⚡🧠 Hybrid (Laya + llama)</option>
        <option value="llm">🧠 llama.cpp (Deep LLM)</option>
      </select>
      <input id="settings_lm_studio_endpoint_input" value="http://127.0.0.1:8081/v1" />
      <input id="settings_comfyui_endpoint_input" value="http://127.0.0.1:8188" />
      <input id="settings_laya_endpoint_input" value="http://127.0.0.1:8765" />
      <input id="settings_clm_endpoint_input" value="http://127.0.0.1:8700" />
      <button id="btn_automate_attribution">Automate Attribution</button>
      <div id="screenplay_segment_cards_wrapper"></div>
      <div id="project_selection_cards_grid"></div>
      <span id="active_workspace_directory_display_label"></span>
      <span id="sidebar_active_workspace_name"></span>
    `;

    // Clear and mock localStorage
    localStorage.clear();

    // Mock electron API
    window.audiobook_api = {
      trigger_laya_attribution: jest.fn(),
      trigger_dialogue_attribution: jest.fn(),
      check_laya_status: jest.fn(),
      save_audiobook_project_state: jest.fn().mockResolvedValue(true),
      subscribe_to_generation_status_updates: jest.fn(),
      subscribe_to_attribution_progress: jest.fn(),
      subscribe_to_lm_studio_warnings: jest.fn()
    };

    // Mock project state
    window.active_loaded_project_state_object = {
      projectName: "TestBook",
      voiceMapping: {
        "Narrator": {},
        "John": { gender: "Male", age: "Adult", traits: "bold and direct" },
        "Jane": { gender: "Female", age: "Young Adult", traits: "cautious" }
      },
      scriptSegments: []
    };

    window.trigger_project_state_disk_flush = jest.fn().mockResolvedValue(true);
    window.populate_voice_matrix_configuration_cards = jest.fn();
    window.refresh_synthesis_progress_tracking_meters = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);

    // Global variables from app.js / editor.js
    window.active_selected_workspace_directory_path = "/mock/workspace";
    window.configuration_lm_studio_api_url_address = "http://127.0.0.1:8081/v1/chat/completions";
    window.configuration_laya_api_url_address = "http://127.0.0.1:8765";
    window.configuration_comfyui_api_url_address = "http://127.0.0.1:8188";
    window.configuration_attribution_engine = "laya";

    // Load scripts into jsdom window context together so top-level script variables are shared
    window.eval(app_script_content + "\n" + editor_script_content);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Engine Configuration & LocalStorage Persistence", () => {
    it("saves Laya endpoint and engine selection to localStorage", () => {
      document.getElementById("settings_laya_endpoint_input").value = "http://localhost:8765";
      document.getElementById("attribution_engine_selector").value = "hybrid";

      save_global_configurations();

      expect(localStorage.getItem("setting_laya_url")).toBe("http://127.0.0.1:8765");
      expect(localStorage.getItem("setting_clm_url")).toBe("http://127.0.0.1:8700");
      expect(localStorage.getItem("setting_attribution_engine")).toBe("hybrid");
      expect(window.configuration_laya_api_url_address).toBe("http://127.0.0.1:8765");
      expect(window.configuration_clm_api_url_address).toBe("http://127.0.0.1:8700");
      expect(window.configuration_attribution_engine).toBe("hybrid");
    });

    it("saves and persists CLM engine configuration", () => {
      document.getElementById("settings_clm_endpoint_input").value = "http://localhost:8700";
      document.getElementById("attribution_engine_selector").value = "clm";

      save_global_configurations();

      expect(localStorage.getItem("setting_clm_url")).toBe("http://127.0.0.1:8700");
      expect(localStorage.getItem("setting_attribution_engine")).toBe("clm");
      expect(window.configuration_clm_api_url_address).toBe("http://127.0.0.1:8700");
      expect(window.configuration_attribution_engine).toBe("clm");
    });
  });

  describe("Dialogue Attribution Routing", () => {
    it("routes to Laya when engine is set to 'laya'", async () => {
      document.getElementById("attribution_engine_selector").value = "laya";

      window.audiobook_api.trigger_laya_attribution.mockResolvedValueOnce({
        script_segments: [
          { type: "dialogue", speaker: "John", text: "Hello there,", direction: "calm delivery, moderate conversational energy", confidence: 0.92, emotion: "calm", energy: 1.0, is_ambiguous: false, engine: "laya" },
          { type: "narrator", speaker: "Narrator", text: "said John.", direction: "calm, steady narration", confidence: 1.0, engine: "narrator" },
          { type: "dialogue", speaker: "Jane", text: "We must hurry!", direction: "fearful delivery, high intensity", confidence: 0.88, emotion: "fearful", energy: 1.5, is_ambiguous: false, engine: "laya" },
          { type: "narrator", speaker: "Narrator", text: "Jane whispered in terror.", direction: "calm, steady narration", confidence: 1.0, engine: "narrator" }
        ],
        performance: { elapsed_ms: 38, laya_queries: 2 }
      });

      await run_main_pipeline_pass_one_and_two();

      expect(window.audiobook_api.trigger_laya_attribution).toHaveBeenCalledTimes(1);
      expect(window.audiobook_api.trigger_dialogue_attribution).not.toHaveBeenCalled();

      const options_passed = window.audiobook_api.trigger_laya_attribution.mock.calls[0][0];
      expect(options_passed.voice_mapping_context).toHaveProperty("John");
      expect(options_passed.voice_mapping_context).toHaveProperty("Jane");
      expect(options_passed.confidence_threshold).toBe(0.55);

      // Verify segments populated in active state
      expect(window.active_loaded_project_state_object.scriptSegments.length).toBe(4);
      expect(window.active_loaded_project_state_object.scriptSegments[0].speaker).toBe("John");
      expect(window.active_loaded_project_state_object.scriptSegments[0].engine).toBe("laya");
      expect(window.active_loaded_project_state_object.scriptSegments[0].confidence).toBe(0.92);
      expect(window.active_loaded_project_state_object.scriptSegments[2].speaker).toBe("Jane");
      expect(window.active_loaded_project_state_object.scriptSegments[2].emotion).toBe("fearful");
    });

    it("routes to llama.cpp LLM when engine is set to 'llm'", async () => {
      document.getElementById("attribution_engine_selector").value = "llm";

      window.audiobook_api.trigger_dialogue_attribution.mockResolvedValueOnce({
        script_segments: [
          { type: "dialogue", speaker: "John", text: "Hello there,", direction: "calm" },
          { type: "narrator", speaker: "Narrator", text: "said John.", direction: "neutral" }
        ]
      });

      await run_main_pipeline_pass_one_and_two();

      expect(window.audiobook_api.trigger_dialogue_attribution).toHaveBeenCalledTimes(1);
      expect(window.audiobook_api.trigger_laya_attribution).not.toHaveBeenCalled();
      expect(window.active_loaded_project_state_object.scriptSegments[0].engine).toBe("llm");
    });

    it("falls back to llama.cpp in 'hybrid' mode if Laya is offline", async () => {
      document.getElementById("attribution_engine_selector").value = "hybrid";

      // Laya reports fallback_reason (e.g. connection refused)
      window.audiobook_api.trigger_laya_attribution.mockResolvedValueOnce({
        script_segments: [],
        fallback_reason: "Connection refused to Laya server on 8765"
      });

      window.audiobook_api.trigger_dialogue_attribution.mockResolvedValueOnce({
        script_segments: [
          { type: "dialogue", speaker: "John", text: "Hello there,", direction: "calm" },
          { type: "narrator", speaker: "Narrator", text: "said John.", direction: "neutral" }
        ]
      });

      await run_main_pipeline_pass_one_and_two();

      expect(window.audiobook_api.trigger_laya_attribution).toHaveBeenCalledTimes(1);
      expect(window.audiobook_api.trigger_dialogue_attribution).toHaveBeenCalledTimes(1);
      expect(window.active_loaded_project_state_object.scriptSegments.length).toBe(2);
    });

    it("routes to CLM when engine is set to 'clm'", async () => {
      document.getElementById("attribution_engine_selector").value = "clm";

      window.audiobook_api.trigger_laya_attribution.mockResolvedValueOnce({
        script_segments: [
          { type: "dialogue", speaker: "John", text: "Hello there,", direction: "calm delivery", confidence: 0.94, emotion: "calm", energy: 1.0, is_ambiguous: false, engine: "clm" },
          { type: "narrator", speaker: "Narrator", text: "said John.", direction: "calm, steady narration", confidence: 1.0, engine: "narrator" }
        ],
        performance: { elapsed_ms: 110, decision_queries: 1 }
      });

      await run_main_pipeline_pass_one_and_two();

      expect(window.audiobook_api.trigger_laya_attribution).toHaveBeenCalledTimes(1);
      const options_passed = window.audiobook_api.trigger_laya_attribution.mock.calls[0][0];
      expect(options_passed.attribution_engine).toBe("clm");
      expect(options_passed.clm_endpoint_url).toBe("http://127.0.0.1:8700");
      expect(window.active_loaded_project_state_object.scriptSegments[0].engine).toBe("clm");
      expect(window.active_loaded_project_state_object.scriptSegments[0].confidence).toBe(0.94);
    });

    it("routes to Cascade when engine is set to 'cascade'", async () => {
      document.getElementById("attribution_engine_selector").value = "cascade";

      window.audiobook_api.trigger_laya_attribution.mockResolvedValueOnce({
        script_segments: [
          { type: "dialogue", speaker: "Jane", text: "We must hurry!", direction: "fearful delivery", confidence: 0.89, emotion: "fearful", energy: 1.4, is_ambiguous: false, engine: "clm_cascade" }
        ],
        performance: { elapsed_ms: 65, decision_queries: 1 }
      });

      await run_main_pipeline_pass_one_and_two();

      expect(window.audiobook_api.trigger_laya_attribution).toHaveBeenCalledTimes(1);
      const options_passed = window.audiobook_api.trigger_laya_attribution.mock.calls[0][0];
      expect(options_passed.attribution_engine).toBe("cascade");
      expect(window.active_loaded_project_state_object.scriptSegments[0].engine).toBe("clm_cascade");
    });
  });

  describe("Screenplay Card UI Rendering with Laya Metadata", () => {
    it("renders laya_confidence_badge with percentage and style class", () => {
      window.active_loaded_project_state_object.scriptSegments = [
        {
          index_position: 0,
          type: "dialogue",
          speaker: "John",
          text: "Confident line",
          direction: "calm delivery",
          confidence: 0.95,
          is_ambiguous: false,
          engine: "laya"
        },
        {
          index_position: 1,
          type: "dialogue",
          speaker: "Jane",
          text: "Ambiguous line",
          direction: "hesitant delivery",
          confidence: 0.45,
          is_ambiguous: true,
          engine: "laya"
        }
      ];

      populate_screenplay_cards_in_editor_view();

      const cards_container = document.getElementById("screenplay_segment_cards_wrapper");
      const badges = cards_container.querySelectorAll(".laya_confidence_badge");

      expect(badges.length).toBe(2);
      expect(badges[0].textContent).toContain("⚡ 95%");
      expect(badges[0].classList.contains("low_confidence")).toBe(false);

      expect(badges[1].textContent).toContain("⚡ 45%");
      expect(badges[1].classList.contains("low_confidence")).toBe(true);
    });

    it("renders badges for CLM (🎯) and Cascade (⚡🎯)", () => {
      window.active_loaded_project_state_object.scriptSegments = [
        {
          index_position: 0,
          type: "dialogue",
          speaker: "John",
          text: "CLM line",
          direction: "calm delivery",
          confidence: 0.88,
          is_ambiguous: false,
          engine: "clm"
        },
        {
          index_position: 1,
          type: "dialogue",
          speaker: "Jane",
          text: "Cascade line",
          direction: "intense delivery",
          confidence: 0.91,
          is_ambiguous: false,
          engine: "clm_cascade"
        }
      ];

      populate_screenplay_cards_in_editor_view();

      const cards_container = document.getElementById("screenplay_segment_cards_wrapper");
      const badges = cards_container.querySelectorAll(".laya_confidence_badge");

      expect(badges.length).toBe(2);
      expect(badges[0].textContent).toContain("🎯 88%");
      expect(badges[1].textContent).toContain("⚡🎯 91%");
    });
  });

  describe("Non-Destructive Attribution, Diff Review & User Locking", () => {
    it("preserves audio takes and locked speaker assignments across re-attribution", async () => {
      // WHAT: Verifying non-destructive re-attribution.
      // WHY: Existing audio takes and user locks must not be wiped out when Automate Attribution is rerun.
      window.active_loaded_project_state_object.scriptSegments = [
        {
          index_position: 0,
          type: "dialogue",
          speaker: "John",
          text: "I am definitely John.",
          audioPath: "/audio/take1.wav",
          audioVersions: [{ take: 1, filePath: "/audio/take1.wav", isActive: true }],
          is_user_locked: true
        }
      ];

      document.getElementById("raw_source_book_textarea_editor").value = '"I am definitely John."';
      document.getElementById("attribution_engine_selector").value = "laya";

      // Laya tries to attribute to Jane
      window.audiobook_api.trigger_laya_attribution.mockResolvedValueOnce({
        script_segments: [
          { type: "dialogue", speaker: "Jane", text: "I am definitely John.", confidence: 0.90 }
        ]
      });

      await run_main_pipeline_pass_one_and_two();

      const updated_segments = window.active_loaded_project_state_object.scriptSegments;
      expect(updated_segments.length).toBe(1);
      // Because it was user-locked to John, it remains John
      expect(updated_segments[0].speaker).toBe("John");
      expect(updated_segments[0].is_user_locked).toBe(true);
      // Audio versions are preserved
      expect(updated_segments[0].audioVersions.length).toBe(1);
      expect(updated_segments[0].audioPath).toBe("/audio/take1.wav");
    });

    it("renders bulk diff banner and inline diff pill for divergent AI attributions", () => {
      window.active_loaded_project_state_object.scriptSegments = [
        {
          index_position: 0,
          type: "dialogue",
          speaker: "John",
          text: "I might be Jane.",
          confidence: 0.88,
          proposed_diff: {
            previous_speaker: "John",
            proposed_speaker: "Jane",
            confidence: 0.88
          }
        }
      ];

      populate_screenplay_cards_in_editor_view();

      const container = document.getElementById("screenplay_segment_cards_wrapper");
      const bulk_banner = container.querySelector(".bulk_attribution_diff_banner");
      expect(bulk_banner).not.toBeNull();
      expect(bulk_banner.textContent).toContain("1 Diffs Found");

      const diff_pill = container.querySelector(".attribution_diff_pill");
      expect(diff_pill).not.toBeNull();
      expect(diff_pill.textContent).toContain("John");
      expect(diff_pill.textContent).toContain("Jane");
    });

    it("accepts diff, de-activates previous audio takes, and flags Column 3 directorial sync", () => {
      window.active_loaded_project_state_object.scriptSegments = [
        {
          index_position: 0,
          type: "dialogue",
          speaker: "John",
          text: "I might be Jane.",
          audioPath: "/audio/old_take.wav",
          audioVersions: [{ take: 1, filePath: "/audio/old_take.wav", isActive: true }],
          proposed_diff: {
            previous_speaker: "John",
            proposed_speaker: "Jane",
            confidence: 0.92
          }
        }
      ];

      window.active_loaded_project_state_object.directorialSegments = [
        {
          index_position: 0,
          type: "dialogue",
          speaker: "John",
          text: "I might be Jane.",
          delivery: { pitch: "medium", pacing: "normal" }
        }
      ];

      accept_attribution_diff(0);

      const segment = window.active_loaded_project_state_object.scriptSegments[0];
      expect(segment.speaker).toBe("Jane");
      expect(segment.proposed_diff).toBeUndefined();
      // Audio versions safely retained, not deleted
      expect(segment.audioVersions.length).toBe(1);
      expect(segment.audioVersions[0].isActive).toBe(false);
      expect(segment.audioPath).toBeNull();

      // Column 3 directorial segment updated & flagged for re-sync
      const directorial_segment = window.active_loaded_project_state_object.directorialSegments[0];
      expect(directorial_segment.speaker).toBe("Jane");
      expect(directorial_segment.needs_resync).toBe(true);
    });

    it("dismisses diff, retaining current speaker baseline", () => {
      window.active_loaded_project_state_object.scriptSegments = [
        {
          index_position: 0,
          type: "dialogue",
          speaker: "John",
          text: "Stay as John.",
          proposed_diff: {
            previous_speaker: "John",
            proposed_speaker: "Jane",
            confidence: 0.70
          }
        }
      ];

      dismiss_attribution_diff(0);

      const segment = window.active_loaded_project_state_object.scriptSegments[0];
      expect(segment.speaker).toBe("John");
      expect(segment.proposed_diff).toBeUndefined();
    });

    it("bulk accepts and bulk dismisses diffs correctly", () => {
      window.active_loaded_project_state_object.scriptSegments = [
        {
          index_position: 0,
          speaker: "John",
          proposed_diff: { previous_speaker: "John", proposed_speaker: "Jane" }
        },
        {
          index_position: 1,
          speaker: "Jane",
          proposed_diff: { previous_speaker: "Jane", proposed_speaker: "John" }
        }
      ];

      bulk_accept_all_attribution_diffs();

      expect(window.active_loaded_project_state_object.scriptSegments[0].speaker).toBe("Jane");
      expect(window.active_loaded_project_state_object.scriptSegments[1].speaker).toBe("John");
      expect(window.active_loaded_project_state_object.scriptSegments[0].proposed_diff).toBeUndefined();
      expect(window.active_loaded_project_state_object.scriptSegments[1].proposed_diff).toBeUndefined();

      // Reset with new diffs and test bulk dismiss
      window.active_loaded_project_state_object.scriptSegments[0].proposed_diff = { previous_speaker: "Jane", proposed_speaker: "Narrator" };
      bulk_dismiss_all_attribution_diffs();
      expect(window.active_loaded_project_state_object.scriptSegments[0].speaker).toBe("Jane");
      expect(window.active_loaded_project_state_object.scriptSegments[0].proposed_diff).toBeUndefined();
    });

    it("locks segment and flags directorial sync on manual speaker dropdown selection", () => {
      window.active_loaded_project_state_object.scriptSegments = [
        {
          index_position: 0,
          type: "dialogue",
          speaker: "John",
          text: "Manual reassignment line."
        }
      ];

      window.active_loaded_project_state_object.directorialSegments = [
        {
          index_position: 0,
          type: "dialogue",
          speaker: "John",
          text: "Manual reassignment line."
        }
      ];

      handle_card_speaker_modification_event(0, "Jane");

      const segment = window.active_loaded_project_state_object.scriptSegments[0];
      expect(segment.speaker).toBe("Jane");
      expect(segment.is_user_locked).toBe(true);

      const directorial_segment = window.active_loaded_project_state_object.directorialSegments[0];
      expect(directorial_segment.speaker).toBe("Jane");
      expect(directorial_segment.needs_resync).toBe(true);
    });
  });

  describe("Real-time Attribution Progress UI and Status Reporting", () => {
    it("updates progress box and bar dynamically when attribution progress events arrive", () => {
      handle_incoming_attribution_progress_update({
        engine: "laya",
        current_line: 12,
        total_lines: 36,
        current_paragraph: 4,
        total_paragraphs: 10,
        phase: "Attributing dialogue line",
        snippet: "Where did you go last night?",
        speaker: "Jane",
        emotion: "whisper",
        confidence: 0.94
      });

      const container = document.getElementById("screenplay_segment_cards_wrapper");
      expect(container.innerHTML).toContain("attribution_progress_box");

      const counter_el = document.getElementById("attribution_progress_counter");
      expect(counter_el.textContent).toBe("Doing line 12 of 36 (33%)");

      const fill_el = document.getElementById("attribution_progress_bar_fill");
      expect(fill_el.style.width).toBe("33%");

      const snippet_el = document.getElementById("attribution_progress_snippet");
      expect(snippet_el.textContent).toContain("Where did you go last night?");

      const result_el = document.getElementById("attribution_progress_result");
      expect(result_el.textContent).toContain("Speaker: Jane");
      expect(result_el.textContent).toContain("whisper");
      expect(result_el.textContent).toContain("94% conf");
    });

    it("smoothly updates existing DOM elements without re-creating container", () => {
      handle_incoming_attribution_progress_update({
        engine: "laya",
        current_line: 1,
        total_lines: 10,
        phase: "Line 1"
      });

      const initial_box = document.getElementById("attribution_progress_box");
      expect(initial_box).toBeTruthy();

      handle_incoming_attribution_progress_update({
        engine: "laya",
        current_line: 5,
        total_lines: 10,
        snippet: "Second quote here",
        speaker: "John",
        confidence: 0.9
      });

      const after_box = document.getElementById("attribution_progress_box");
      expect(after_box).toBe(initial_box); // Exact same DOM element preserved

      const counter_el = document.getElementById("attribution_progress_counter");
      expect(counter_el.textContent).toBe("Doing line 5 of 10 (50%)");
      expect(document.getElementById("attribution_progress_bar_fill").style.width).toBe("50%");
    });
  });
});


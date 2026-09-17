/** @jest-environment jsdom */
const filesystem_library = require("fs");
const path_library = require("path");

const voice_matrix_script_content = filesystem_library.readFileSync(
  path_library.resolve(__dirname, "../renderer/js/voiceMatrix.js"),
  "utf8"
);
const editor_script_content = filesystem_library.readFileSync(
  path_library.resolve(__dirname, "../renderer/js/editor.js"),
  "utf8"
);

describe("AuK Workflow Integration & Audio Editing Suite", () => {

  describe("AuK ComfyUI Workflow JSON Templates Integrity", () => {
    // WHAT: Testing that all primary AuK generation and editing templates exist and parse without syntax errors.
    // WHY: Invalid JSON syntax in a workflow template causes hard runtime crashes during ComfyUI dispatch.
    const expected_auk_workflow_filenames = [
      "AuK-01-Instruct-TTS_api.json",
      "AuK-02-Voice-Clone_api.json",
      "AuK-03-Speech-Content-Editing_api.json",
      "AuK-05-Pitch-Editing_api.json",
      "AuK-06-Speed-Editing_api.json",
      "AuK-07-Volume-Editing_api.json",
      "AuK-08-Emotion-Editing_api.json",
      "AuK-10-De-accent_api.json",
      "AuK-12-Whisper-Conversion_api.json",
      "AuK-13-Speech-Enhancement_api.json"
    ];

    expected_auk_workflow_filenames.forEach(template_filename => {
      it(`should successfully parse ${template_filename} with required AuK node structure`, () => {
        const template_absolute_path = path_library.resolve(__dirname, "../comfyui_workflows", template_filename);
        expect(filesystem_library.existsSync(template_absolute_path)).toBe(true);

        const workflow_json_object = JSON.parse(filesystem_library.readFileSync(template_absolute_path, "utf8"));
        
        // WHAT: Verifying presence of AuKModelLoader and AuKGenerateEdit nodes.
        // WHY: Every AuK workflow relies on these two core native nodes for model loading and execution.
        const list_of_class_types = Object.values(workflow_json_object).map(node => node.class_type);
        expect(list_of_class_types).toContain("AuKModelLoader");
        expect(list_of_class_types).toContain("AuKGenerateEdit");
      });
    });
  });

  describe("Voice Matrix - AuK Workflow Selection", () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="voice_matrix_cards_container"></div>
      `;

      window.audiobook_api = {
        subscribe_to_generation_status_updates: jest.fn()
      };
      window.trigger_project_state_disk_flush = jest.fn();
      window.populate_voice_matrix_configuration_cards = jest.fn();

      window.active_loaded_project_state_object = {
        projectName: "TestAuKProject",
        voiceMapping: {
          "Kaelen": {
            gender: "Male",
            age: "Adult",
            traits: "Resolute leader",
            workflowType: "custom"
          }
        }
      };

      window.eval(voice_matrix_script_content);
      window.populate_voice_matrix_configuration_cards = jest.fn();
      window.trigger_project_state_disk_flush = jest.fn();
    });

    it("successfully sets character engine to AuK Voice Clone", () => {
      // WHAT: Testing modify_character_workflow_type assigns 'auk_voice_clone'.
      // WHY: Binds zero-shot reference voice cloning to character generation requests.
      modify_character_workflow_type("Kaelen", "auk_voice_clone");
      expect(window.active_loaded_project_state_object.voiceMapping["Kaelen"].workflowType).toBe("auk_voice_clone");
      expect(window.trigger_project_state_disk_flush).toHaveBeenCalled();
    });

    it("successfully sets character engine to AuK Instruct-TTS", () => {
      // WHAT: Testing modify_character_workflow_type assigns 'auk_instruct_tts'.
      // WHY: Enables description-driven speech synthesis for characters without reference clips.
      modify_character_workflow_type("Kaelen", "auk_instruct_tts");
      expect(window.active_loaded_project_state_object.voiceMapping["Kaelen"].workflowType).toBe("auk_instruct_tts");
      expect(window.trigger_project_state_disk_flush).toHaveBeenCalled();
    });
  });

  describe("Script Editor - AuK Take Editing Modal", () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="screenplay_segment_cards_wrapper"></div>
        <div id="directorial_segment_cards_wrapper"></div>
        <div id="auk_edit_tools_modal" class="d-none">
          <span id="modal_auk_edit_subtitle"></span>
          <span id="modal_auk_edit_status_message"></span>
          <select id="modal_auk_edit_task_dropdown">
            <option value="whisper">Whisper</option>
            <option value="pitch">Pitch</option>
            <option value="speed">Speed</option>
            <option value="volume">Volume</option>
            <option value="emotion">Emotion</option>
          </select>
          <div id="auk_control_pitch" class="d-none">
            <input type="range" id="input_auk_pitch_semitones" value="3">
          </div>
          <div id="auk_control_speed" class="d-none">
            <input type="range" id="input_auk_speed_multiplier" value="1.20">
          </div>
          <div id="auk_control_volume" class="d-none">
            <input type="range" id="input_auk_volume_decibels" value="4">
          </div>
          <div id="auk_control_emotion" class="d-none">
            <select id="select_auk_target_emotion">
              <option value="sad" selected>Sad</option>
            </select>
          </div>
          <div id="auk_control_speech_content" class="d-none">
            <input type="text" id="input_auk_speech_content_instruction">
            <input type="text" id="input_auk_speech_content_original">
          </div>
          <button id="btn_execute_auk_edit"></button>
        </div>
        <audio id="master_hidden_audio_player"></audio>
      `;

      window.audiobook_api = {
        apply_auk_audio_edit: jest.fn(),
        save_audiobook_project_state: jest.fn().mockResolvedValue({ success: true }),
        subscribe_to_generation_status_updates: jest.fn()
      };
      window.alert = jest.fn();

      window.active_selected_workspace_directory_path = "C:/TestWorkspace";
      window.configuration_comfyui_api_url_address = "http://127.0.0.1:8188";
      window.active_loaded_project_state_object = {
        projectName: "TestAudiobook",
        scriptSegments: [
          {
            index_position: 0,
            speaker: "Narrator",
            text: "The sun set behind the jagged cliffs.",
            audioVersions: ["C:/TestWorkspace/TestAudiobook/audio/takes/line_0/take_1.wav"],
            activeTake: 1
          }
        ],
        directorialSegments: []
      };

      window.eval(editor_script_content);
      window.trigger_project_state_disk_flush = jest.fn().mockResolvedValue(true);
      window.populate_screenplay_cards_in_editor_view = jest.fn();
      window.populate_directorial_cards_in_editor_view = jest.fn();
    });

    it("opens AuK editing modal and reveals controls for pitch task", () => {
      // WHAT: Calling open_auk_edit_tools_modal for line index 0.
      open_auk_edit_tools_modal(0, false);
      const modal_element = document.getElementById("auk_edit_tools_modal");
      expect(modal_element.classList.contains("d-none")).toBe(false);

      // WHAT: Selecting 'pitch' task and verifying pitch slider visibility.
      handle_auk_edit_task_selection_change("pitch");
      expect(document.getElementById("auk_control_pitch").classList.contains("d-none")).toBe(false);
      expect(document.getElementById("auk_control_speed").classList.contains("d-none")).toBe(true);
    });

    it("executes AuK edit successfully and appends new take without destroying previous take", async () => {
      open_auk_edit_tools_modal(0, false);

      window.audiobook_api.apply_auk_audio_edit.mockResolvedValue({
        success: true,
        newTakeNumber: 2,
        filePath: "C:/TestWorkspace/TestAudiobook/audio/takes/line_0/take_2.flac",
        message: "Take 2 created with AuK whisper."
      });

      await execute_active_auk_edit_task();

      expect(window.audiobook_api.apply_auk_audio_edit).toHaveBeenCalledWith(
        expect.objectContaining({
          edit_task_identifier: "whisper",
          index_position: 0,
          source_take_file_path: "C:/TestWorkspace/TestAudiobook/audio/takes/line_0/take_1.wav"
        })
      );

      const target_segment = window.active_loaded_project_state_object.scriptSegments[0];
      expect(target_segment.audioVersions.length).toBe(2);
      expect(target_segment.activeTake).toBe(2);
      expect(target_segment.audioVersions[1]).toBe("C:/TestWorkspace/TestAudiobook/audio/takes/line_0/take_2.flac");
      expect(window.trigger_project_state_disk_flush).toHaveBeenCalled();
    });
  });

});

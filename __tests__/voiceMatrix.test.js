/** @jest-environment jsdom */
const filesystem_library = require('fs');
const path_library = require('path');

const scriptContent = filesystem_library.readFileSync(path_library.resolve(__dirname, '../renderer/js/voiceMatrix.js'), 'utf8');

describe('Voice Anchor Pipeline', () => {
  beforeEach(() => {
    // Basic DOM setup
    document.body.innerHTML = `
      <button id="save_custom_voice_btn_Character 1">💾 Save to ComfyUI</button>
    `;

    // Mock global API objects
    window.audiobook_api = {
      promote_test_to_anchor: jest.fn(),
      save_custom_voice: jest.fn(),
      subscribe_to_generation_status_updates: jest.fn()
    };

    // Mock global functions from other files that we don't want to test here
    window.alert = jest.fn();
    window.console.error = jest.fn();
    window.trigger_project_state_disk_flush = jest.fn();

    // Mock global state
    window.active_selected_workspace_directory_path = "/mock/workspace";
    window.active_loaded_project_state_object = {
      projectName: "MockProject",
      voiceMapping: {
        "Character 1": {
          testTakes: {
            "happy": "/mock/test_takes/happy_take.wav"
          },
          testPhrase: "This is a test phrase.",
          anchorFilePath: "/mock/anchors/master_anchor.wav",
          anchorPhrase: "This is the master anchor phrase."
        },
        "Character 2": {} // Missing test takes and anchors
      }
    };

    // Evaluate script in the Jest jsdom window context
    // This allows functions like promote_test_take_to_anchor to be attached globally
    window.eval(scriptContent);
    
    window.original_populate_cards = window.populate_voice_matrix_configuration_cards;
    // Assign mocks that might be defined inside the script we just eval'd
    window.populate_voice_matrix_configuration_cards = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('promote_test_take_to_anchor()', () => {
    it('alerts and aborts if test take does not exist', async () => {
      await promote_test_take_to_anchor("Character 2", "sad");
      expect(window.alert).toHaveBeenCalledWith("Test take not found.");
      expect(window.audiobook_api.promote_test_to_anchor).not.toHaveBeenCalled();
    });

    it('successfully promotes a test take to character anchor and calls ComfyUI export', async () => {
      window.audiobook_api.promote_test_to_anchor.mockResolvedValue({
        success: true,
        anchor_file_path: "/mock/anchors/new_master_anchor.wav"
      });

      // We need to mock the next sequential step which gets called
      window.audiobook_api.save_custom_voice.mockResolvedValue({
        success: true,
        saved_filename: "mock_custom_voice.safetensors"
      });

      await promote_test_take_to_anchor("Character 1", "happy");

      // Verify IPC was called with correct paths
      expect(window.audiobook_api.promote_test_to_anchor).toHaveBeenCalledWith(
        "/mock/workspace",
        "MockProject",
        "Character 1",
        "/mock/test_takes/happy_take.wav"
      );

      const characterData = window.active_loaded_project_state_object.voiceMapping["Character 1"];
      
      // Verify state was correctly mutated
      expect(characterData.anchorFilePath).toBe("/mock/anchors/new_master_anchor.wav");
      expect(characterData.anchorPhrase).toBe("This is a test phrase.");
      expect(characterData.anchorBakedAt).toBeDefined();
      expect(characterData.lockedTake).toBe("happy");
      expect(characterData.lockedTakePath).toBe("/mock/test_takes/happy_take.wav");

      // Verify UI/State refreshes occurred
      expect(window.trigger_project_state_disk_flush).toHaveBeenCalled();
      expect(window.populate_voice_matrix_configuration_cards).toHaveBeenCalled();

      // Verify auto-save to ComfyUI occurred
      expect(window.audiobook_api.save_custom_voice).toHaveBeenCalled();
    });

    it('alerts on promotion failure from backend', async () => {
      window.audiobook_api.promote_test_to_anchor.mockResolvedValue({
        success: false,
        error: "Permission denied copying file"
      });

      await promote_test_take_to_anchor("Character 1", "happy");

      expect(window.alert).toHaveBeenCalledWith("Error promoting test take: Permission denied copying file");
      expect(window.trigger_project_state_disk_flush).not.toHaveBeenCalled();
    });
  });

  describe('save_custom_voice_to_comfyui()', () => {
    it('alerts and aborts if character lacks a baked anchor', async () => {
      await save_custom_voice_to_comfyui("Character 2");
      expect(window.alert).toHaveBeenCalledWith("Please save an anchor first.");
      expect(window.audiobook_api.save_custom_voice).not.toHaveBeenCalled();
    });

    it('successfully triggers ComfyUI save, updates UI, and stores filename', async () => {
      window.audiobook_api.save_custom_voice.mockResolvedValue({
        success: true,
        saved_filename: "character_1_voice.safetensors"
      });

      const btn = document.getElementById("save_custom_voice_btn_Character 1");

      await save_custom_voice_to_comfyui("Character 1");

      // The button remains disabled in the old DOM reference since populate_voice_matrix_configuration_cards is mocked and doesn't rebuild the DOM.
      expect(btn.disabled).toBe(true);

      // Verify IPC arguments
      expect(window.audiobook_api.save_custom_voice).toHaveBeenCalledWith(
        "/mock/workspace",
        "MockProject",
        "Character 1",
        "/mock/anchors/master_anchor.wav",
        "This is the master anchor phrase."
      );

      const characterData = window.active_loaded_project_state_object.voiceMapping["Character 1"];
      expect(characterData.savedVoiceFilename).toBe("character_1_voice.safetensors");
      expect(window.trigger_project_state_disk_flush).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("successfully saved"));
    });

    it('handles ComfyUI save failure and restores button state', async () => {
      window.audiobook_api.save_custom_voice.mockResolvedValue({
        success: false,
        error: "ComfyUI offline"
      });

      const btn = document.getElementById("save_custom_voice_btn_Character 1");

      await save_custom_voice_to_comfyui("Character 1");

      expect(window.alert).toHaveBeenCalledWith("Error saving custom voice: ComfyUI offline");
      
      // Assure UI restored
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe("💾 Save to ComfyUI");
    });
    
    it('handles IPC exception smoothly without crashing', async () => {
      window.audiobook_api.save_custom_voice.mockRejectedValue(new Error("IPC Broken Pipe"));
      
      const btn = document.getElementById("save_custom_voice_btn_Character 1");

      await save_custom_voice_to_comfyui("Character 1");

      expect(window.console.error).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith("Failed to save custom voice.");
      
      // Assure UI restored
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe("💾 Save to ComfyUI");
    });
  });

  describe('modify_character_gender(), modify_character_age(), and modify_character_voice_mapping_template()', () => {
    it('successfully updates character gender and triggers UI update', () => {
      modify_character_gender("Character 1", "Female");
      
      const updated_character_details = window.active_loaded_project_state_object.voiceMapping["Character 1"];
      expect(updated_character_details.gender).toBe("Female");
      expect(window.trigger_project_state_disk_flush).toHaveBeenCalled();
      expect(window.populate_voice_matrix_configuration_cards).toHaveBeenCalled();
    });

    it('successfully updates character age and triggers UI update', () => {
      modify_character_age("Character 1", "Elderly");
      
      const updated_character_details = window.active_loaded_project_state_object.voiceMapping["Character 1"];
      expect(updated_character_details.age).toBe("Elderly");
      expect(window.trigger_project_state_disk_flush).toHaveBeenCalled();
      expect(window.populate_voice_matrix_configuration_cards).toHaveBeenCalled();
    });

    it('successfully updates voice mapping template and triggers UI update', () => {
      modify_character_voice_mapping_template("Character 1", "Serena");
      
      const updated_character_details = window.active_loaded_project_state_object.voiceMapping["Character 1"];
      expect(updated_character_details.voice).toBe("Serena");
      expect(window.trigger_project_state_disk_flush).toHaveBeenCalled();
      expect(window.populate_voice_matrix_configuration_cards).toHaveBeenCalled();
    });
  });

  describe('format_relationships_to_readable_string() with split structure', () => {
    it('correctly formats split relationship schema entries', () => {
      const split_rels = [
        {
          a: "Maren",
          b: "Josh",
          relation_type: "family",
          relation_tone: "hostile",
          status: "estranged",
          power_dynamic: "equal"
        },
        {
          a: "Priya",
          b: "Tom",
          relation_type: "romantic",
          relation_tone: "tense",
          status: "current",
          power_dynamic: "a_over_b"
        }
      ];

      const formatted = format_relationships_to_readable_string(split_rels);
      expect(formatted).toContain("Maren -> family (hostile) [estranged] with Josh");
      expect(formatted).toContain("Priya -> romantic (tense) <a_over_b> with Tom");
    });

    it('correctly formats dynamic relationship state timelines with transitions and triggers', () => {
      const timeline_rels = [
        {
          id: "maren_josh",
          a: "Maren",
          b: "Josh",
          states: [
            {
              from: { chapter: 1, segment: 1 },
              relation_type: "family",
              relation_tone: "warm",
              status: "current",
              power_dynamic: "a_over_b",
              trigger: null
            },
            {
              from: { chapter: 7, segment: 3 },
              relation_type: "family",
              relation_tone: "tense",
              status: "current",
              power_dynamic: "equal",
              trigger: "Josh finds the forged will"
            }
          ]
        }
      ];

      const formatted = format_relationships_to_readable_string(timeline_rels);
      expect(formatted).toContain("Maren ↔ Josh");
      expect(formatted).toContain("2 states");
      expect(formatted).toContain("family (warm) <a_over_b> @ ch.1s.1");
      expect(formatted).toContain("family (tense) @ ch.7s.3 \"Josh finds the forged will\"");
    });

    it('gracefully handles legacy string and object structures', () => {
      expect(format_relationships_to_readable_string("married to John")).toBe("married to John");
      expect(format_relationships_to_readable_string([{ target_id: "John", relation: "spouse" }])).toBe("spouse with John");
      expect(format_relationships_to_readable_string(null)).toBe("");
    });
  });

  describe('resolve_relationship_state_at_position()', () => {
    const mock_timeline = [
      {
        id: "maren_josh",
        a: "Maren",
        b: "Josh",
        states: [
          {
            from: { chapter: 1, segment: 1 },
            relation_type: "family",
            relation_tone: "warm",
            status: "current",
            power_dynamic: "a_over_b",
            trigger: null
          },
          {
            from: { chapter: 7, segment: 3 },
            relation_type: "family",
            relation_tone: "tense",
            status: "current",
            power_dynamic: "equal",
            trigger: "Josh finds the forged will"
          },
          {
            from: { chapter: 12, segment: 1 },
            relation_type: "family",
            relation_tone: "hostile",
            status: "estranged",
            power_dynamic: "equal",
            trigger: "Maren testifies against him"
          }
        ]
      }
    ];

    it('resolves the initial state before any triggers occur', () => {
      const state_ch3 = resolve_relationship_state_at_position(mock_timeline, "Maren", "Josh", 3, 5);
      expect(state_ch3).not.toBeNull();
      expect(state_ch3.relation_tone).toBe("warm");
      expect(state_ch3.power_dynamic).toBe("a_over_b");
    });

    it('resolves the updated state after trigger point is reached', () => {
      const state_ch7_seg4 = resolve_relationship_state_at_position(mock_timeline, "Maren", "Josh", 7, 4);
      expect(state_ch7_seg4).not.toBeNull();
      expect(state_ch7_seg4.relation_tone).toBe("tense");
      expect(state_ch7_seg4.trigger).toBe("Josh finds the forged will");

      const state_ch15 = resolve_relationship_state_at_position(mock_timeline, "Maren", "Josh", 15, 1);
      expect(state_ch15.relation_tone).toBe("hostile");
      expect(state_ch15.status).toBe("estranged");
    });

    it('inverts directional power dynamic when characters are queried in reverse order', () => {
      const state_josh_view = resolve_relationship_state_at_position(mock_timeline, "Josh", "Maren", 1, 1);
      expect(state_josh_view.power_dynamic).toBe("b_over_a");
    });
  });

  describe('AuK Voice Clone & Flip Tab Controls', () => {
    it('successfully flips character synthesis mode between seed and auk_clone', () => {
      set_character_synthesis_mode("Character 1", "auk_clone");

      const characterData = window.active_loaded_project_state_object.voiceMapping["Character 1"];
      expect(characterData.synthesisMode).toBe("auk_clone");
      expect(characterData.workflowType).toBe("auk_voice_clone");
      expect(window.trigger_project_state_disk_flush).toHaveBeenCalled();
      expect(window.populate_voice_matrix_configuration_cards).toHaveBeenCalled();

      set_character_synthesis_mode("Character 1", "seed");
      expect(characterData.synthesisMode).toBe("seed");
      expect(characterData.workflowType).toBe("design");
    });

    it('loads external reference audio and sets up AuK clone profile', async () => {
      window.audiobook_api.select_audio_file = jest.fn().mockResolvedValue("/path/to/character_voice.wav");
      window.audiobook_api.import_character_voice_audio = jest.fn().mockResolvedValue({
        success: true,
        anchor_file_path: "/mock/workspace/MockProject/audio/anchors/character_voice_character_1.wav"
      });

      await trigger_character_reference_audio_load("Character 1");

      const characterData = window.active_loaded_project_state_object.voiceMapping["Character 1"];
      expect(characterData.referenceAudioPath).toBe("/mock/workspace/MockProject/audio/anchors/character_voice_character_1.wav");
      expect(characterData.anchorFilePath).toBe("/mock/workspace/MockProject/audio/anchors/character_voice_character_1.wav");
      expect(characterData.workflowType).toBe("auk_voice_clone");
      expect(characterData.synthesisMode).toBe("auk_clone");
      expect(window.trigger_project_state_disk_flush).toHaveBeenCalled();
      expect(window.populate_voice_matrix_configuration_cards).toHaveBeenCalled();
    });

    it('removes reference audio and reverts character profile to seed mode', () => {
      const characterData = window.active_loaded_project_state_object.voiceMapping["Character 1"];
      characterData.referenceAudioPath = "/mock/path.wav";
      characterData.synthesisMode = "auk_clone";

      trigger_character_reference_audio_remove("Character 1");

      expect(characterData.referenceAudioPath).toBeUndefined();
      expect(characterData.synthesisMode).toBe("seed");
      expect(characterData.workflowType).toBe("design");
      expect(window.trigger_project_state_disk_flush).toHaveBeenCalled();
      expect(window.populate_voice_matrix_configuration_cards).toHaveBeenCalled();
    });

    it('dispatches AuK clone task with referenceAudioPath when in auk_clone mode', () => {
      window.audiobook_api.enqueue_speech_generation_task = jest.fn();
      window.audiobook_api.delete_take_file = jest.fn().mockResolvedValue({ success: true });

      document.body.innerHTML += `
        <textarea id="test_phrase_Character 1">Sample voice phrase.</textarea>
        <div id="test_audio_container_Character 1"></div>
      `;

      const characterData = window.active_loaded_project_state_object.voiceMapping["Character 1"];
      characterData.synthesisMode = "auk_clone";
      characterData.referenceAudioPath = "/mock/anchors/custom_voice.wav";

      trigger_character_voice_test("Character 1");

      expect(window.audiobook_api.enqueue_speech_generation_task).toHaveBeenCalledWith(
        "/mock/workspace",
        "MockProject",
        expect.objectContaining({
          speaker: "Character 1",
          text: "Sample voice phrase.",
          workflowOverride: expect.objectContaining({
            workflowType: "auk_voice_clone",
            referenceAudioPath: "/mock/anchors/custom_voice.wav"
          })
        }),
        expect.any(Object),
        expect.any(String),
        1
      );
    });

    it('formats safe peaksaudio URLs correctly', () => {
      expect(format_safe_audio_playback_url("")).toBe("");
      expect(format_safe_audio_playback_url(null)).toBe("");
      
      const windowsPath = "C:\\Users\\Desktop-Dev\\AudioBooks\\takes\\take_1.flac";
      const formattedWindows = format_safe_audio_playback_url(windowsPath);
      expect(formattedWindows).toMatch(/^peaksaudio:\/\/\/C:\/Users\/Desktop-Dev\/AudioBooks\/takes\/take_1\.flac\?t=\d+$/);

      const fileUrl = "file:///C:/Users/Desktop-Dev/AudioBooks/takes/take_1.flac";
      const formattedFileUrl = format_safe_audio_playback_url(fileUrl);
      expect(formattedFileUrl).toMatch(/^peaksaudio:\/\/\/C:\/Users\/Desktop-Dev\/AudioBooks\/takes\/take_1\.flac\?t=\d+$/);

      const alreadyPeaks = "peaksaudio:///workspace/audio/take.wav";
      const formattedPeaks = format_safe_audio_playback_url(alreadyPeaks);
      expect(formattedPeaks).toMatch(/^peaksaudio:\/\/\/workspace\/audio\/take\.wav\?t=\d+$/);
    });

    it('persists completed test takes to state and updates player when status update arrives', () => {
      // Find the listener callback registered to subscribe_to_generation_status_updates
      expect(window.audiobook_api.subscribe_to_generation_status_updates).toHaveBeenCalled();
      const listenerCallback = window.audiobook_api.subscribe_to_generation_status_updates.mock.calls[0][0];

      document.body.innerHTML += `
        <div id="test_status_normal_Character 1">Queued...</div>
        <audio id="test_player_normal_Character 1" class="d-none"></audio>
        <button id="test_lock_btn_normal_Character 1" class="d-none">Lock</button>
      `;

      listenerCallback({
        index_position: "test_normal_Character 1",
        status: "completed",
        filePath: "C:\\mock\\takes\\take_1.flac"
      });

      const characterData = window.active_loaded_project_state_object.voiceMapping["Character 1"];
      expect(characterData.testTakes).toBeDefined();
      expect(characterData.testTakes.normal).toBe("C:\\mock\\takes\\take_1.flac");
      expect(window.trigger_project_state_disk_flush).toHaveBeenCalled();

      const playerEl = document.getElementById("test_player_normal_Character 1");
      expect(playerEl.classList.contains("d-block")).toBe(true);
      expect(playerEl.classList.contains("d-none")).toBe(false);
      expect(playerEl.src).toMatch(/^peaksaudio:\/\/\/C:\/mock\/takes\/take_1\.flac\?t=\d+$/);

      const lockBtn = document.getElementById("test_lock_btn_normal_Character 1");
      expect(lockBtn.classList.contains("d-none")).toBe(false);
      expect(lockBtn.textContent).toContain("Lock in character");
    });

    it('renders locked button styling and text when voice take is already locked as anchor', () => {
      document.body.innerHTML = `<div id="voice_matrix_cards_grid"></div>`;
      
      const char1 = window.active_loaded_project_state_object.voiceMapping["Character 1"];
      char1.anchorFilePath = "/mock/anchors/master_anchor.wav";
      char1.lockedTakePath = "/mock/test_takes/happy_take.wav";
      char1.testTakes = { normal: "/mock/test_takes/happy_take.wav" };

      window.original_populate_cards();

      const lockBtn = document.getElementById("test_lock_btn_normal_Character 1");
      expect(lockBtn).not.toBeNull();
      expect(lockBtn.textContent).toContain("Voice Locked In (Active Anchor)");
      expect(lockBtn.classList.contains("border-gold-glow")).toBe(true);
      expect(lockBtn.classList.contains("text-gold")).toBe(true);
    });
  });
});


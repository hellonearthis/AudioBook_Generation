/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const scriptContent = fs.readFileSync(path.resolve(__dirname, '../renderer/js/voiceMatrix.js'), 'utf8');

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

    it('successfully promotes a test take to master anchor and calls ComfyUI export', async () => {
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
});

// =========================================================================
// CAST METADATA FORMATTING UTILITIES
// =========================================================================

// WHAT: Formats relationships structured data to a clean, comma-separated string.
// WHY: We want to ensure that if the relationships are stored as an array of target/dynamic objects
//      (e.g., from the cast discovery LLM schema), we format them beautifully for the user textarea
//      and prevent raw "[object Object]" displaying in the DOM.
function format_relationships_to_readable_string(relationships_input_field) {
  // WHAT: If it is already a plain string, return it immediately.
  // WHY: Simplifies parsing for manual inputs or already processed records.
  if (typeof relationships_input_field === "string") {
    return relationships_input_field;
  }
  // WHAT: If it is null or undefined, return an empty string.
  // WHY: Avoids syntax errors or displaying "undefined" values.
  if (!relationships_input_field) {
    return "";
  }
  // WHAT: If it is a structured array, iterate and compile each relationship description.
  // WHY: Translates raw object arrays like [{"target_id": "kin", "dynamic": "spouse"}] into readable prose.
  if (Array.isArray(relationships_input_field)) {
    const formatted_relationship_parts = [];
    for (let item_index = 0; item_index < relationships_input_field.length; item_index++) {
      const relationship_item = relationships_input_field[item_index];
      if (relationship_item && typeof relationship_item === "object") {
        const target_id_string = relationship_item.target_id || "";
        const relationship_dynamic_string = relationship_item.dynamic || relationship_item.relation || "";
        if (target_id_string && relationship_dynamic_string) {
          formatted_relationship_parts.push(`${relationship_dynamic_string} with ${target_id_string}`);
        } else if (target_id_string) {
          formatted_relationship_parts.push(`connected to ${target_id_string}`);
        } else if (relationship_dynamic_string) {
          formatted_relationship_parts.push(relationship_dynamic_string);
        }
      } else if (typeof relationship_item === "string") {
        formatted_relationship_parts.push(relationship_item);
      }
    }
    return formatted_relationship_parts.join(", ");
  }
  // WHAT: If it is a single object instead of an array, format its parameters.
  // WHY: Adapts to model variations that output single relationship instances.
  if (typeof relationships_input_field === "object") {
    const target_id_string = relationships_input_field.target_id || "";
    const relationship_dynamic_string = relationships_input_field.dynamic || relationships_input_field.relation || "";
    if (target_id_string && relationship_dynamic_string) {
      return `${relationship_dynamic_string} with ${target_id_string}`;
    } else if (target_id_string) {
      return `connected to ${target_id_string}`;
    } else if (relationship_dynamic_string) {
      return relationship_dynamic_string;
    }
  }
  return String(relationships_input_field);
}

// WHAT: Formats general metadata fields (traits, visual details, key objects) to a clean string.
// WHY: Ensures that if an LLM outputs lists or arrays instead of flat strings, the UI parses and
//      renders them elegantly without displaying "[object Object]" or raw arrays.
function format_general_metadata_field_to_string(metadata_field_value) {
  // WHAT: If it is already a plain string, return it immediately.
  // WHY: Reduces processing overhead for standard text structures.
  if (typeof metadata_field_value === "string") {
    return metadata_field_value;
  }
  // WHAT: If it is null or undefined, return an empty string.
  // WHY: Prevents displaying placeholder garbage text.
  if (!metadata_field_value) {
    return "";
  }
  // WHAT: If it is an array, join elements gracefully.
  // WHY: Combines list elements (like ["key", "props"]) into a single, clean text string.
  if (Array.isArray(metadata_field_value)) {
    const formatted_metadata_parts = [];
    for (let item_index = 0; item_index < metadata_field_value.length; item_index++) {
      const metadata_item = metadata_field_value[item_index];
      if (metadata_item && typeof metadata_item === "object") {
        formatted_metadata_parts.push(JSON.stringify(metadata_item));
      } else if (metadata_item) {
        formatted_metadata_parts.push(String(metadata_item));
      }
    }
    return formatted_metadata_parts.join(", ");
  }
  // WHAT: If it is an object, format using standard JSON serialization.
  // WHY: Safely displays the content instead of failing with [object Object].
  if (typeof metadata_field_value === "object") {
    return JSON.stringify(metadata_field_value);
  }
  return String(metadata_field_value);
}

// =========================================================================
// CAST PROFILE CARD BUILDER
// =========================================================================

// WHAT: Compiles and renders list cards for each discovered speaking entity in the book project.
// WHY: Allows the user to cast voice profiles, specify gender/age tags, and select seed parameters.
function populate_voice_matrix_configuration_cards() {
  const cards_grid_wrapper_element = document.getElementById("voice_matrix_cards_grid");
  cards_grid_wrapper_element.innerHTML = "";

  if (!active_loaded_project_state_object || !active_loaded_project_state_object.voiceMapping) {
    return;
  }

  const list_of_cast_names = Object.keys(active_loaded_project_state_object.voiceMapping);

  if (list_of_cast_names.length === 0) {
    // WHAT: Displaying empty placeholder warning.
    // WHY: Shows instructions to scan book paragraphs if no characters are found yet.
    cards_grid_wrapper_element.innerHTML = `
      <div class="empty_state_screen grid-col-full vh-50">
        <div class="empty_state_hex_glow text-gold border-gold-glow">
          <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <h4 class="empty_state_title">No Cast Profiles Identified</h4>
        <p class="empty_state_tagline">Discover speakers automatically by clicking "Scan Characters" above or parse book paragraphs in the Script Editor tab.</p>
      </div>
    `;
    return;
  }

  // WHAT: Iterating through mapped characters.
  // WHY: Renders a control dashboard for each specific persona.
  for (let cast_index = 0; cast_index < list_of_cast_names.length; cast_index++) {
    const character_name_string = list_of_cast_names[cast_index];
    const character_timbre_details = active_loaded_project_state_object.voiceMapping[character_name_string];

    const character_timbre_card_element = document.createElement("div");
    character_timbre_card_element.className = "character_timbre_card";

    // WHAT: Formatting the new Qwen3 DesignVoice schema fields into readable strings for the UI.
    // WHY: Keeps UI elements clean and ensures textareas display readable strings rather than "[object Object]".
    //      Uses backward-compatible fallback reads from old field names for pre-upgrade projects.
    const human_readable_voice_profile_string = format_general_metadata_field_to_string(
      character_timbre_details.voiceProfile || character_timbre_details.baseVoice || character_timbre_details.traits || ""
    );
    const human_readable_identity_background_string = format_general_metadata_field_to_string(
      character_timbre_details.identityBackground || ""
    );
    const human_readable_physical_appearance_string = format_general_metadata_field_to_string(
      character_timbre_details.physicalAppearance || character_timbre_details.visualDetails || ""
    );
    const human_readable_personality_traits_string = format_general_metadata_field_to_string(
      character_timbre_details.personalityTraits || character_timbre_details.traits || ""
    );
    const human_readable_personal_motto_string = format_general_metadata_field_to_string(
      character_timbre_details.personalMotto || ""
    );



    // WHAT: Checking if this is the fallback "Narrator" profile.
    // WHY: The Narrator profile must never be deleted as it is the absolute default fallback speaker.
    const is_narrator_profile = (character_name_string === "Narrator");
    const is_locked = character_timbre_details.isLocked === true;
    
    // WHAT: Header buttons container with dynamic lock icon and delete button.
    // WHY: Groups the utility actions on the right side of the card header.
    const header_buttons_html = `
      <div class="d-flex gap-6" style="margin-left: auto;">
        <button class="cyber_btn btn_secondary p-6-10 text-12 ${is_locked ? 'border-purple-glow text-purple' : 'border-glass-subtle text-muted'}" onclick="toggle_character_lock('${character_name_string.replace(/'/g, "\\'")}')" title="${is_locked ? 'Unlock Profile' : 'Lock Profile from AI Overwrites'}">
          ${is_locked ? '🔒' : '🔓'}
        </button>
        ${!is_narrator_profile ? `
          <button class="cyber_btn btn_secondary p-6-10 text-12 border-coral-glow text-coral" onclick="trigger_character_deletion('${character_name_string.replace(/'/g, "\\'")}')" title="Delete Cast Profile">
            🗑️
          </button>
        ` : ''}
      </div>
    `;

    // WHAT: Pre-rendering test audio players from saved state.
    // WHY: Ensures the test takes persist visually when the app is reloaded.
    let test_audio_players_html = "";
    if (character_timbre_details.testTakes) {
      const emotions = ["normal"];
      emotions.forEach(emotion => {
        if (character_timbre_details.testTakes[emotion]) {
          const raw_path = character_timbre_details.testTakes[emotion];
          const normalized_path = raw_path.replace(/\\/g, "/").replace(/^\/+/, "");
          const src_url = `file:///${normalized_path}?t=${Date.now()}`;
          test_audio_players_html += `
            <div class="d-flex flex-column p-8 border-radius-4 gap-6 mb-8" style="background: rgba(0,0,0,0.2);">
              <div class="d-flex align-items-center justify-content-between w-100">
                <span class="text-10 text-muted" style="text-transform: capitalize; font-weight: 500;">${emotion} take</span>
                <span id="test_status_${emotion}_${character_name_string}" class="d-none text-10 text-gold"></span>
              </div>
              <audio id="test_player_${emotion}_${character_name_string}" src="${src_url}" controls class="w-100 d-block" style="height: 24px;"></audio>
              <button class="cyber_btn btn_secondary text-10 p-4-8 mt-2 w-100" onclick="promote_test_take_to_anchor('${character_name_string.replace(/'/g, "\\'")}', '${emotion}')" title="Saves this take as the Character Anchor and exports it directly to ComfyUI for future generations.">⭐ Save as Character Anchor</button>
            </div>
          `;
        }
      });
    }

    // WHAT: Compiling HTML card layout.
    // WHY: Provides fields for gender details, voice profile inputs, voice selection, and seed randomizers.
    //      The collapsible panel now mirrors the Qwen3-TTS DesignVoice character card schema.
    character_timbre_card_element.innerHTML = `
      <div class="character_card_identity_header">
        <div class="character_avatar_emblem">${character_name_string.charAt(0).toUpperCase()}</div>
        <div class="character_identity_details">
          <h3>${character_name_string}</h3>
          <span>Synthesizer Cast Profile</span>
        </div>
        ${header_buttons_html}
      </div>

      <div class="character_implicit_metadata_badges">
        <span class="character_meta_badge text-purple border-purple-glow">${character_timbre_details.gender || 'Unknown'}</span>
        <span class="character_meta_badge">${character_timbre_details.age || 'Adult'}</span>
        ${character_timbre_details.savedVoiceFilename ? `<span class="character_meta_badge text-gold border-gold-glow">${character_timbre_details.savedVoiceFilename}</span>` : ""}
      </div>

      <!-- Voice Design Character Card properties -->
      <div class="d-flex flex-column gap-10 mt-15 pt-10 border-top-glass">
        <h4 class="font-display text-11 font-semibold text-gold" style="margin: 0;">🎭 VOICE DESIGN CHARACTER CARD</h4>
        
        <div class="form_input_group mb-0">
          <label class="form_input_label text-10 text-muted mb-4">Voice Profile</label>
          <textarea class="form_text_field w-100 text-11 line-height-1-4 resize-vertical bg-input-glass" rows="3" placeholder="Detailed physical voice description, pitch, resonance, and delivery register..." onchange="modify_character_voice_profile_text('${character_name_string}', this.value)">${human_readable_voice_profile_string}</textarea>
        </div>

        <div class="form_input_group mb-0">
          <label class="form_input_label text-10 text-muted mb-4">Identity & Background</label>
          <textarea class="form_text_field w-100 text-11 line-height-1-4 resize-vertical bg-input-glass" rows="3" placeholder="Professional standing, age context, life experience, cultural gravity..." onchange="modify_character_identity_background('${character_name_string}', this.value)">${human_readable_identity_background_string}</textarea>
        </div>

        <div class="form_input_group mb-0">
          <label class="form_input_label text-10 text-muted mb-4">Physical Appearance</label>
          <textarea class="form_text_field w-100 text-11 line-height-1-4 resize-vertical bg-input-glass" rows="3" placeholder="Stature, attire, facial expressions, physical presence..." onchange="modify_character_physical_appearance('${character_name_string}', this.value)">${human_readable_physical_appearance_string}</textarea>
        </div>

        <div class="form_input_group mb-0">
          <label class="form_input_label text-10 text-muted mb-4">Personality Traits</label>
          <textarea class="form_text_field w-100 text-11 line-height-1-4 resize-vertical bg-input-glass" rows="3" placeholder="Core conviction, psychological disposition, surface vs internal nature..." onchange="modify_character_personality_traits('${character_name_string}', this.value)">${human_readable_personality_traits_string}</textarea>
        </div>

        <div class="form_input_group mb-0">
          <label class="form_input_label text-10 text-muted mb-4">Personal Motto</label>
          <textarea class="form_text_field w-100 text-11 line-height-1-4 resize-vertical bg-input-glass" rows="2" placeholder="A defining quote or life philosophy..." onchange="modify_character_personal_motto('${character_name_string}', this.value)">${human_readable_personal_motto_string}</textarea>
        </div>

        <div class="form_input_group mb-0 mt-10">
          <label class="form_input_label">Character Timeline Color</label>
          <div class="d-flex gap-10 align-items-center">
            <input type="color" value="${character_timbre_details.colorCode || '#485F86'}" class="voice-color-picker" onchange="modify_character_color_code('${character_name_string.replace(/'/g, "\\'")}', this.value)">
            <span class="text-11 text-muted">Identifies character clips in the Post-Production Audio Editor</span>
          </div>
        </div>

        ${character_timbre_details.savedVoiceFilename ? `
          <div class="d-flex align-items-center gap-6 p-8 border-radius-4 bg-glass-panel border-gold-glow mt-8">
            <span class="text-gold">⭐</span>
            <span class="text-11 text-gold flex-1">Character Anchor Bound: <strong>${character_timbre_details.savedVoiceFilename}</strong></span>
            <button class="cyber_btn btn_secondary p-2-6 text-9 text-coral" onclick="trigger_character_voice_mapping_reset('${character_name_string.replace(/'/g, "\\'")}')">Remove</button>
          </div>
        ` : ""}

        <div class="form_input_group mb-0 mt-15 pt-10 border-top-glass">
          <h4 class="font-display text-11 font-semibold text-gold mb-10" style="margin: 0;">🧪 TESTING & VOICE SEED</h4>
          
          <div class="form_input_group mb-10 d-flex align-items-center gap-10 flex-wrap flex-row" style="align-content: flex-start;">
            <input type="number" id="test_seed_${character_name_string}" value="${character_timbre_details.seed || Math.floor(Math.random() * 90000) + 10000}" class="form_text_field flex-1 text-11 bg-input-glass" onchange="modify_character_voice_synthesis_seed('${character_name_string.replace(/'/g, "\\'")}', this.value)">
            <button class="cyber_btn btn_secondary text-11 p-0 p-4-8" onclick="trigger_randomized_voice_seed_generation('${character_name_string.replace(/'/g, "\\'")}')" title="Randomize Seed">🎲</button>
            <label class="form_input_label text-10 text-muted" style="margin: 0; white-space: nowrap;">Voice Seed</label>
          </div>
          
          <div class="form_input_group mb-10">
            <div class="d-flex justify-content-between align-items-center mb-4">
              <label class="form_input_label text-10 text-muted mb-0">Calibration / Anchor Phrase</label>
              <select class="form_text_field bg-input-glass text-muted" style="width: 120px; font-size: 9px; padding: 2px;" onchange="populate_test_phrase_dropdown('${character_name_string.replace(/'/g, "\\'")}', this.value)">
                <option value="">-- Load Script --</option>
                <option value="option1" selected>1: Smooth & Resonance-Rich</option>
                <option value="option2">2: Articulate & Crisp</option>
                <option value="option3">3: Sibilant Specialist</option>
                <option value="option4">4: Plosive Torture Test</option>
                <option value="option5">5: Complex Vowel Test</option>
              </select>
            </div>
            <textarea id="test_phrase_${character_name_string}" class="form_text_field w-100 text-11 line-height-1-4 resize-vertical bg-input-glass p-2-4" rows="6" onchange="modify_character_test_phrase('${character_name_string.replace(/'/g, "\\'")}', this.value)">${character_timbre_details.testPhrase || character_timbre_details.anchorPhrase || 'The direct path through the valley was covered in thick, dark moss. Young children should always evaluate their choices before jumping into unknown waters. She saw a magnificent bluejay perched high upon the smooth wooden fence, singing a remarkably clear tune that echoed softly across the quiet, frozen northern landscape.'}</textarea>
          </div>
          
          <button class="cyber_btn btn_primary w-100 text-11 p-6 mb-10" onclick="trigger_character_voice_test('${character_name_string.replace(/'/g, "\\'")}')" title="Generates a short test clip of the phrase above using the current voice profile traits.">
            Generate Test Phrase
          </button>
          
          <div id="test_audio_container_${character_name_string}" class="d-flex flex-column gap-6">
            ${test_audio_players_html}
          </div>
        </div>

      </div>
    `;

    cards_grid_wrapper_element.appendChild(character_timbre_card_element);
  }
}

// =========================================================================
// CAST MODIFICATION EVENT HANDLERS
// =========================================================================

// WHAT: Toggles the lock state of a character profile to protect it from AI scans.
// WHY: The user can manually lock a hand-edited profile so that Pass 1 doesn't overwrite it.
function toggle_character_lock(character_name_string) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    const is_currently_locked = active_loaded_project_state_object.voiceMapping[character_name_string].isLocked;
    active_loaded_project_state_object.voiceMapping[character_name_string].isLocked = !is_currently_locked;
    trigger_project_state_disk_flush();
    populate_voice_matrix_configuration_cards();
  }
}

// WHAT: Completely removes a character profile from the active project state.
// WHY: Allows the user to clean up misidentified or unwanted cast members from the matrix.
function trigger_character_deletion(character_name_string) {
  if (confirm(`Are you sure you want to permanently delete the cast profile for "${character_name_string}"?`)) {
    if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping) {
      delete active_loaded_project_state_object.voiceMapping[character_name_string];
      trigger_project_state_disk_flush();
      populate_voice_matrix_configuration_cards();
    }
  }
}

// WHAT: Updating the assigned ComfyUI voice model template.
// WHY: Binds selected voice characteristics to the targeted speaker profile.
function modify_character_voice_mapping_template(character_name_string, selected_voice_preset_name) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    active_loaded_project_state_object.voiceMapping[character_name_string].voice = selected_voice_preset_name;
    trigger_project_state_disk_flush();
  }
}

// WHAT: Updating the voice generation seed value.
// WHY: Seed edits change pitch/timbre variations inside the Instruct-TTS engine.
function modify_character_voice_synthesis_seed(character_name_string, updated_seed_numerical_value) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    active_loaded_project_state_object.voiceMapping[character_name_string].seed = Number(updated_seed_numerical_value);
    trigger_project_state_disk_flush();
  }
}

// WHAT: Generates a random seed integer for a character and refreshes UI grids.
// WHY: Randomizing seeds lets users explore voice pitch variations easily.
function trigger_randomized_voice_seed_generation(character_name_string) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    const randomized_speech_synthesis_seed = Math.floor(Math.random() * 90000) + 10000;
    active_loaded_project_state_object.voiceMapping[character_name_string].seed = randomized_speech_synthesis_seed;
    
    trigger_project_state_disk_flush();
    populate_voice_matrix_configuration_cards();
  }
}

// WHAT: Saves the user's test phrase to the character's state.
// WHY: Ensures the test phrase persists across reloads.
function modify_character_test_phrase(character_name_string, updated_test_phrase_text) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    active_loaded_project_state_object.voiceMapping[character_name_string].testPhrase = updated_test_phrase_text;
    active_loaded_project_state_object.voiceMapping[character_name_string].anchorPhrase = updated_test_phrase_text;
    trigger_project_state_disk_flush();
  }
}

// WHAT: Dispatches three test generation tasks (Normal, Surprised, Angry) to the backend.
// WHY: Allows the user to hear the exact seed/key vocal timbre across different emotional contexts.
function trigger_character_voice_test(character_name_string) {
  const seed_input = document.getElementById(`test_seed_${character_name_string}`);
  const phrase_input = document.getElementById(`test_phrase_${character_name_string}`);
  const container = document.getElementById(`test_audio_container_${character_name_string}`);
  
  if (!seed_input || !phrase_input || !container) return;
  
  const test_phrase = phrase_input.value || "This is a test phrase.";
  const seed_value = Number(seed_input.value);
  
  // Update state to make sure seed is set
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    active_loaded_project_state_object.voiceMapping[character_name_string].seed = seed_value;
    trigger_project_state_disk_flush();
  }
  
  // Set up UI for 1 player (Normal)
  const emotions = ["normal"];
  container.innerHTML = ""; // Clear existing
  
  emotions.forEach(emotion => {
    container.innerHTML += `
      <div class="d-flex align-items-center justify-content-between p-5 border-radius-4 bg-dark-overlay">
        <span class="text-10 text-muted-cyan w-60px text-capitalize">${emotion}</span>
        <span id="test_status_${emotion}_${character_name_string}" class="text-10 text-gold">Queued...</span>
        <audio id="test_player_${emotion}_${character_name_string}" controls class="h-20px w-180px d-none"></audio>
      </div>
    `;
    
    // Dispatch to API
    const test_segment_data = {
      index_position: `test_${emotion}_${character_name_string}`,
      speaker: character_name_string,
      text: test_phrase,
      direction: emotion, // This feeds into Qwen's emotion processing
      workflowOverride: {
        seed: seed_value
      }
    };
    
    // Using enqueue_speech_generation_task directly hooks into ComfyUI
    if (window.audiobook_api) {
      // WHAT: Deleting any prior test audio takes (both .mp3 and .wav variants) before starting new generation.
      // WHY: Ensures the user doesn't hear stale cached test results if the new generation queue fails.
      window.audiobook_api.delete_take_file(
        active_selected_workspace_directory_path,
        active_loaded_project_state_object.projectName,
        false,
        `test_${emotion}_${character_name_string}`,
        1,
        ".mp3"
      ).catch(() => {});
      
      window.audiobook_api.delete_take_file(
        active_selected_workspace_directory_path,
        active_loaded_project_state_object.projectName,
        false,
        `test_${emotion}_${character_name_string}`,
        1,
        ".wav"
      ).catch(() => {});

      window.audiobook_api.enqueue_speech_generation_task(
        active_selected_workspace_directory_path,
        active_loaded_project_state_object.projectName,
        test_segment_data,
        active_loaded_project_state_object.voiceMapping,
        typeof configuration_comfyui_api_url_address !== 'undefined' ? configuration_comfyui_api_url_address : "http://127.0.0.1:8188",
        1
      );
    }
  });
}

// WHAT: Register listener to catch status updates specifically for test voice generation and master anchor saves.
// WHY: We need to know when the audio is ready so we can show the native audio player.
if (window.audiobook_api && window.audiobook_api.subscribe_to_generation_status_updates) {
  window.audiobook_api.subscribe_to_generation_status_updates((status_payload) => {
    // WHAT: Handling master anchor save status updates.
    // WHY: Updates the master anchor save button, status label, and inline player in real-time
    //      as the backend progresses through the VoiceDesign → FFmpeg → save pipeline.
    if (typeof status_payload.index_position === "string" && status_payload.index_position.startsWith("anchor_bake_")) {
      const anchor_character_name_key = status_payload.index_position.replace("anchor_bake_", "");

      // WHAT: Finding the matching character name in the voice mapping (case-insensitive lookup).
      // WHY: The status update uses the standardized lowercase name, but the voiceMapping keys
      //      use the original casing from cast discovery.
      let resolved_character_display_name = null;
      if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping) {
        const all_character_names = Object.keys(active_loaded_project_state_object.voiceMapping);
        for (let name_index = 0; name_index < all_character_names.length; name_index++) {
          const candidate_name = all_character_names[name_index];
          if (candidate_name.toLowerCase().replace(/\s+/g, "_") === anchor_character_name_key) {
            resolved_character_display_name = candidate_name;
            break;
          }
        }
      }

      if (resolved_character_display_name) {
        const anchor_bake_status_element = document.getElementById(`anchor_bake_status_${resolved_character_display_name}`);
        const anchor_bake_button_element = document.getElementById(`anchor_bake_btn_${resolved_character_display_name}`);

        if (status_payload.status === "processing") {
          if (anchor_bake_status_element) {
            anchor_bake_status_element.classList.remove('d-none');
            anchor_bake_status_element.classList.add('d-block');
            anchor_bake_status_element.style.color = "var(--accent-cyber-gold)";
            anchor_bake_status_element.textContent = status_payload.message || "Processing...";
          }
        } else if (status_payload.status === "completed" && status_payload.filePath) {
          // WHAT: The master anchor save completed successfully — update state and refresh UI.
          if (active_loaded_project_state_object.voiceMapping[resolved_character_display_name]) {
            active_loaded_project_state_object.voiceMapping[resolved_character_display_name].anchorFilePath = status_payload.filePath;
            active_loaded_project_state_object.voiceMapping[resolved_character_display_name].anchorBakedAt = Date.now();
            trigger_project_state_disk_flush();
          }
          // WHAT: Full UI refresh to update badge, button text, and player.
          populate_voice_matrix_configuration_cards();
        } else if (status_payload.status === "failed") {
          if (anchor_bake_status_element) {
            anchor_bake_status_element.classList.remove('d-none');
            anchor_bake_status_element.classList.add('d-block');
            anchor_bake_status_element.style.color = "var(--accent-cyber-red, #ff4444)";
            anchor_bake_status_element.textContent = status_payload.message || "Save failed.";
          }
          if (anchor_bake_button_element) {
            anchor_bake_button_element.disabled = false;
            anchor_bake_button_element.textContent = "🎬 Save as Master Anchor";
          }
        }
      }
      return;
    }

    if (typeof status_payload.index_position === "string" && status_payload.index_position.startsWith("test_")) {
      const parts = status_payload.index_position.split("_"); 
      if (parts.length >= 3) {
        const emotion = parts[1];
        const character_name = parts.slice(2).join("_");
        
        const status_el = document.getElementById(`test_status_${emotion}_${character_name}`);
        const player_el = document.getElementById(`test_player_${emotion}_${character_name}`);
        
        if (status_el) {
          status_el.innerText = status_payload.status === "processing" ? "Processing..." : (status_payload.status === "completed" ? "Done" : status_payload.status);
        }
        
        if (status_payload.status === "completed" && player_el && status_payload.filePath) {
          const normalized_path = status_payload.filePath.replace(/\\\\/g, '/').replace(/\\/g, '/').replace(/^\/+/, "");
          const final_src_url = `file:///${normalized_path}?t=${Date.now()}`;
          player_el.src = final_src_url;
          player_el.classList.remove('d-none');
          player_el.classList.add('d-block');
          if (status_el) status_el.classList.add('d-none');
          
          if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name]) {
            if (!active_loaded_project_state_object.voiceMapping[character_name].testTakes) {
              active_loaded_project_state_object.voiceMapping[character_name].testTakes = {};
            }
            active_loaded_project_state_object.voiceMapping[character_name].testTakes[emotion] = status_payload.filePath;
            trigger_project_state_disk_flush();
          }
        }
      }
    }
  });
}

// WHAT: Updates the visual color code for timeline block rendering.
// WHY: Enables character color-coding in the Post-Production Editor.
function modify_character_color_code(character_name_string, updated_color_code) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    active_loaded_project_state_object.voiceMapping[character_name_string].colorCode = updated_color_code;
    trigger_project_state_disk_flush();
    
    if (typeof timeline_clips_data !== 'undefined') {
      timeline_clips_data.forEach(clip => {
        if (clip.speaker === character_name_string) {
          clip.color = updated_color_code;
        }
      });
      if (typeof render_data_driven_timeline === 'function') {
        render_data_driven_timeline();
      }
    }
  }
}

// WHAT: Updates manual edits made to the character's core voice profile descriptor.
// WHY: Binds the Qwen3 DesignVoice "Voice Profile" field to the persistent memory profile,
//      then recompiles the full designPrompt character card to keep the DesignVoice API node in sync.
function modify_character_voice_profile_text(character_name_string, updated_voice_profile_text) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    active_loaded_project_state_object.voiceMapping[character_name_string].voiceProfile = updated_voice_profile_text;
    recompile_character_design_prompt(character_name_string);
    trigger_project_state_disk_flush();
  }
}

// WHAT: Updates manual edits made to the character's identity and background context.
// WHY: Binds the Qwen3 DesignVoice "Identity & Background" field to the persistent memory profile,
//      then recompiles the full designPrompt character card to keep the DesignVoice API node in sync.
function modify_character_identity_background(character_name_string, updated_identity_background_text) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    active_loaded_project_state_object.voiceMapping[character_name_string].identityBackground = updated_identity_background_text;
    recompile_character_design_prompt(character_name_string);
    trigger_project_state_disk_flush();
  }
}

// WHAT: Updates manual edits made to the character's physical appearance description.
// WHY: Binds the Qwen3 DesignVoice "Physical Appearance" field to the persistent memory profile,
//      then recompiles the full designPrompt character card to keep the DesignVoice API node in sync.
function modify_character_physical_appearance(character_name_string, updated_physical_appearance_text) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    active_loaded_project_state_object.voiceMapping[character_name_string].physicalAppearance = updated_physical_appearance_text;
    recompile_character_design_prompt(character_name_string);
    trigger_project_state_disk_flush();
  }
}

// WHAT: Updates manual edits made to the character's personality traits profile.
// WHY: Binds the Qwen3 DesignVoice "Personality Traits" field to the persistent memory profile,
//      then recompiles the full designPrompt character card to keep the DesignVoice API node in sync.
function modify_character_personality_traits(character_name_string, updated_personality_traits_text) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    active_loaded_project_state_object.voiceMapping[character_name_string].personalityTraits = updated_personality_traits_text;
    recompile_character_design_prompt(character_name_string);
    trigger_project_state_disk_flush();
  }
}

// WHAT: Updates manual edits made to the character's defining quote or philosophy.
// WHY: Binds the Qwen3 DesignVoice "Personal Motto" field to the persistent memory profile,
//      then recompiles the full designPrompt character card to keep the DesignVoice API node in sync.
function modify_character_personal_motto(character_name_string, updated_personal_motto_text) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    active_loaded_project_state_object.voiceMapping[character_name_string].personalMotto = updated_personal_motto_text;
    recompile_character_design_prompt(character_name_string);
    trigger_project_state_disk_flush();
  }
}

// =========================================================================
// VOICE ANCHOR BAKING UI FUNCTIONS
// =========================================================================

// WHAT: Saves the user's custom anchor phrase to the character's persistent state.
// WHY: The anchor phrase is the neutral, punctuation-balanced script (~12 seconds) spoken in the
//      master anchor WAV. It must be stored so the backend can provide it as the exact transcript
//      reference for the VoiceClone ICL alignment mechanism.
function modify_character_anchor_phrase(character_name_string, updated_anchor_phrase_text) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
    active_loaded_project_state_object.voiceMapping[character_name_string].anchorPhrase = updated_anchor_phrase_text;
    trigger_project_state_disk_flush();
  }
}

// WHAT: Dispatches the Master Anchor Save request to the backend via the preload bridge.
// WHY: Triggers Step 1 of the Two-Step Voice Cloning pipeline: runs VoiceDesign once with the
//      character's design prompt, seed, and anchor phrase, then converts the output to a 16-bit
//      Mono WAV via FFmpeg and saves it as the character's permanent master anchor file.
// STYLE: Here is a friendly tutorial on how this function works:
//        We gather the character's design prompt (or recompile it from individual fields),
//        the anchor phrase, and the seed value. We then call the preload bridge function
//        which dispatches to the backend IPC handler. The backend runs the VoiceDesign
//        workflow, converts to WAV, and returns the file path. We update the project state
//        and refresh the UI to show the anchor player and status badge.
async function trigger_anchor_bake(character_name_string) {
  if (!active_loaded_project_state_object || !active_selected_workspace_directory_path) {
    alert("Please load a project first.");
    return;
  }

  const character_profile_object = active_loaded_project_state_object.voiceMapping[character_name_string];
  if (!character_profile_object) {
    alert(`Character profile not found: ${character_name_string}`);
    return;
  }

  // WHAT: Gathering the anchor phrase from the shared calibration textarea.
  const anchor_phrase_textarea_element = document.getElementById(`test_phrase_${character_name_string}`);
  const resolved_anchor_phrase_text = anchor_phrase_textarea_element
    ? anchor_phrase_textarea_element.value.trim()
    : (character_profile_object.testPhrase || character_profile_object.anchorPhrase || "The morning sun filtered through the curtains, casting a gentle warmth across the room. She paused by the window, watching the clouds drift slowly against the blue sky, feeling the quiet rhythm of the day begin to unfold.");

  // WHAT: Ensuring the anchor phrase is saved to state before baking.
  // WHY: The backend reads the anchor phrase from the request, but we also persist it
  //      so it survives app restarts and appears pre-filled in the UI on reload.
  character_profile_object.anchorPhrase = resolved_anchor_phrase_text;
  trigger_project_state_disk_flush();

  // WHAT: Resolving the character's design prompt for the VoiceDesign workflow.
  // WHY: If no pre-compiled designPrompt exists, we recompile it from individual fields.
  if (!character_profile_object.designPrompt || !character_profile_object.designPrompt.includes("Voice Profile:")) {
    recompile_character_design_prompt(character_name_string);
  }
  const resolved_design_prompt_string = character_profile_object.designPrompt || "";

  const resolved_seed_value = character_profile_object.seed || Math.floor(Math.random() * 90000) + 10000;

  // WHAT: Updating the UI to show baking-in-progress state.
  const bake_button_element = document.getElementById(`anchor_bake_btn_${character_name_string}`);
  const bake_status_element = document.getElementById(`anchor_bake_status_${character_name_string}`);
  if (bake_button_element) {
    bake_button_element.disabled = true;
    bake_button_element.textContent = "⏳ Saving...";
  }
  if (bake_status_element) {
    bake_status_element.classList.remove('d-none');
    bake_status_element.classList.add('d-block');
    bake_status_element.textContent = "Sending to ComfyUI...";
  }

  try {
    // WHAT: Dispatching the master anchor save request to the backend.
    const bake_result_payload = await window.audiobook_api.bake_voice_anchor(
      active_selected_workspace_directory_path,
      active_loaded_project_state_object.projectName,
      character_name_string,
      resolved_design_prompt_string,
      resolved_anchor_phrase_text,
      resolved_seed_value,
      typeof configuration_comfyui_api_url_address !== 'undefined' ? configuration_comfyui_api_url_address : "http://127.0.0.1:8188"
    );

    if (bake_result_payload && bake_result_payload.success) {
      // WHAT: Persisting the anchor metadata to the character's voice mapping state.
      // WHY: The queue worker checks for the anchor WAV on disk, but we also store the path
      //      and timestamp in state for the UI status badge and player.
      character_profile_object.anchorFilePath = bake_result_payload.anchor_file_path;
      character_profile_object.anchorTranscript = bake_result_payload.anchor_transcript;
      character_profile_object.anchorBakedAt = bake_result_payload.baked_at_timestamp;
      trigger_project_state_disk_flush();

      // WHAT: Refreshing the entire voice matrix to update the status badge and player.
      populate_voice_matrix_configuration_cards();
    } else {
      // WHAT: Displaying the error message if the bake failed.
      if (bake_status_element) {
        bake_status_element.textContent = `Failed: ${bake_result_payload ? bake_result_payload.error : 'Unknown error'}`;
        bake_status_element.style.color = "var(--accent-cyber-red, #ff4444)";
      }
      if (bake_button_element) {
        bake_button_element.disabled = false;
        bake_button_element.textContent = "🎬 Save as Master Anchor";
      }
    }
  } catch (anchor_bake_dispatch_exception) {
    console.error("Anchor bake dispatch failed:", anchor_bake_dispatch_exception);
    if (bake_status_element) {
      bake_status_element.textContent = `Error: ${anchor_bake_dispatch_exception.message}`;
      bake_status_element.style.color = "var(--accent-cyber-red, #ff4444)";
    }
    if (bake_button_element) {
      bake_button_element.disabled = false;
      bake_button_element.textContent = "🎬 Save as Master Anchor";
    }
  }
}

// WHAT: Recompiles the full multi-section designPrompt character card from individual Qwen3 schema fields.
// WHY: When any individual field (voiceProfile, identityBackground, physicalAppearance, personalityTraits)
//      is edited manually in the UI, the designPrompt must be rebuilt as the complete character card string
//      that gets sent directly to the VoiceStyle node (ID 43) of the Qwen3-TTS DesignVoice API workflow.
function recompile_character_design_prompt(character_name_string) {
  const character_profile_object = active_loaded_project_state_object.voiceMapping[character_name_string];
  if (!character_profile_object) return;

  // WHAT: Assembling the Qwen3 character card from stored individual fields.
  // WHY: Each field contributes a distinct semantic dimension to the synthesized voice print:
  //      voice_profile → acoustic texture, identity_background → narrative gravity,
  //      physical_appearance → pacing weight, personality_traits → delivery register, personal_motto → vocal intent.
  const compiled_voice_profile_section = character_profile_object.voiceProfile || character_profile_object.baseVoice || "A clear, natural speaking voice.";
  const compiled_identity_background_section = character_profile_object.identityBackground || "";
  const compiled_physical_appearance_section = character_profile_object.physicalAppearance || "";
  const compiled_personality_traits_section = character_profile_object.personalityTraits || "";
  const compiled_personal_motto_section = character_profile_object.personalMotto || "";

  let rebuilt_design_prompt_string = `Character Name: ${character_name_string}\n`;
  rebuilt_design_prompt_string += `Voice Profile: ${compiled_voice_profile_section}\n`;
  if (compiled_identity_background_section) {
    rebuilt_design_prompt_string += `Identity & Background: ${compiled_identity_background_section}\n`;
  }
  if (compiled_physical_appearance_section) {
    rebuilt_design_prompt_string += `Physical Appearance: ${compiled_physical_appearance_section}\n`;
  }
  if (compiled_personality_traits_section) {
    rebuilt_design_prompt_string += `Personality Traits: ${compiled_personality_traits_section}\n`;
  }
  if (compiled_personal_motto_section) {
    rebuilt_design_prompt_string += `Personal Motto: ${compiled_personal_motto_section}`;
  }

  character_profile_object.designPrompt = rebuilt_design_prompt_string.trim();
}

// =========================================================================
// PIPELINE WORKER - PASS 1: GLOBAL CAST DISCOVERY
// =========================================================================

// WHAT: Dispatches cast scanning passes using local LLM models (Pass 1).
// WHY: Reads book segments to identify speakers and compiling traits automatically.
async function run_cast_discovery_pass_one() {
  if (!active_loaded_project_state_object || !active_selected_workspace_directory_path) {
    return;
  }

  const raw_book_text_input = document.getElementById("raw_source_book_textarea_editor").value.trim();
  if (!raw_book_text_input) {
    alert("The raw text area is currently empty. Please load or paste content to scan.");
    return;
  }

  // WHAT: Multi-pass chunked strategy.
  // WHY: Discovering all cast profiles requires scanning the entire text, not just the first 3500 chars.
  const target_chunk_size = 3500;
  const total_discovery_chunks = Math.ceil(raw_book_text_input.length / target_chunk_size);
  const cards_grid_wrapper_element = document.getElementById("voice_matrix_cards_grid");

  // WHAT: Iterating through the text in blocks.
  // WHY: Bypasses LLM context window limits to find characters that appear late in the book.
  for (let current_chunk_index = 0; current_chunk_index < total_discovery_chunks; current_chunk_index++) {
    const chunk_start_index = current_chunk_index * target_chunk_size;
    const sample_text_window_block = raw_book_text_input.substring(chunk_start_index, chunk_start_index + target_chunk_size);
    
    cards_grid_wrapper_element.innerHTML = `
      <div class="empty_state_screen grid-col-full vh-50">
        <div class="status_dot state_processing w-40px h-40px"></div>
        <h4 class="empty_state_title">Orchestrating Global Cast Discovery (Pass ${current_chunk_index + 1}/${total_discovery_chunks})...</h4>
        <p class="empty_state_tagline">LM Studio is scanning content to identify characters, age traits, and personality cues. Please wait...</p>
      </div>
    `;

  try {
    const discovery_response_json = await window.audiobook_api.trigger_global_cast_extraction(
      sample_text_window_block,
      configuration_lm_studio_api_url_address,
      active_selected_workspace_directory_path,
      active_loaded_project_state_object.projectName
    );

    if (discovery_response_json && discovery_response_json.cast) {
      const voice_mapping_matrix = active_loaded_project_state_object.voiceMapping || {};

      for (let cast_index = 0; cast_index < discovery_response_json.cast.length; cast_index++) {
        const discovered_member = discovery_response_json.cast[cast_index];
        
        // WHAT: Merging discovered profiles into the persistent casting database.
        // WHY: Preserves existing mappings but updates traits, gender, and age fields.
        if (discovered_member.name) {
          let character_key = discovered_member.name;

          // WHAT: Resolving short names (e.g. "Miranda") to their full names (e.g. "Miranda Stewart") if they already exist in the matrix.
          // WHY: Subsequent cast scans might only see short names depending on the text chunk, leading to duplicates.
          const existing_cast_keys = Object.keys(voice_mapping_matrix);
          for (let existing_key_counter = 0; existing_key_counter < existing_cast_keys.length; existing_key_counter++) {
            const existing_name = existing_cast_keys[existing_key_counter];
            
            // Ignore common titles to prevent false positive matches
            const ignored_words = ["the", "a", "an", "mr", "mrs", "ms", "miss", "dr", "sir", "madam", "uncle", "aunt"];
            const existing_words = existing_name.toLowerCase().split(/[\s-]+/).filter(word_token => !ignored_words.includes(word_token));
            const resolved_words = character_key.toLowerCase().split(/[\s-]+/).filter(word_token => !ignored_words.includes(word_token));
            
            const has_word_match = existing_words.some(word => resolved_words.includes(word));
            
            if (has_word_match) {
              character_key = existing_name;
              break;
            }
          }

          if (!voice_mapping_matrix[character_key]) {
            // WHAT: Constructing standard initial schema for a newly discovered cast profile.
            // WHY: Registers the new character under the Custom Voice Design workflow type with a unique static seed and color.
            voice_mapping_matrix[character_key] = {
              voice: "Eric",
              seed: Math.floor(Math.random() * 90000) + 10000,
              isLocked: false,
              workflowType: "design",
              designPrompt: "",
              colorCode: "#" + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
            };
          } else if (voice_mapping_matrix[character_key].isLocked) {
            // WHAT: Skipping updates if the user locked this profile.
            // WHY: Protects manual edits from being overwritten by subsequent AI scans.
            continue;
          }
          // WHAT: Extracting gender and age from the voice_profile string since the cast_discovery prompt
          //        returns them embedded there (e.g., "powerful, commanding middle-aged male voice").
          // WHY: The cast_discovery.txt schema asks for id, name, voice_profile, identity_background,
          //      physical_appearance, and personality_traits — not separate gender/age fields.
          //      We parse gender and age from the voice_profile description string.
          const raw_voice_profile_string = format_general_metadata_field_to_string(
            discovered_member.voice_profile || discovered_member.base_voice || discovered_member.personality_description || ""
          ).toLowerCase();

          // WHAT: Detecting gender from the voice_profile descriptor.
          // WHY: The LLM embeds gender tokens like "male", "female" directly into the voice_profile string.
          let extracted_gender_label = "Unknown";
          if (raw_voice_profile_string.includes("female")) {
            extracted_gender_label = "Female";
          } else if (raw_voice_profile_string.includes("male")) {
            extracted_gender_label = "Male";
          }

          // WHAT: Detecting age range from the voice_profile descriptor.
          // WHY: The LLM embeds age tokens like "middle-aged", "young adult", "elderly" directly into the voice_profile string.
          let extracted_age_label = "Adult";
          if (raw_voice_profile_string.includes("child") || raw_voice_profile_string.includes("young girl") || raw_voice_profile_string.includes("young boy")) {
            extracted_age_label = "Child";
          } else if (raw_voice_profile_string.includes("teenager") || raw_voice_profile_string.includes("teen") || raw_voice_profile_string.includes("fourteen") || raw_voice_profile_string.includes("adolescent")) {
            extracted_age_label = "Teenager";
          } else if (raw_voice_profile_string.includes("young adult") || raw_voice_profile_string.includes("young woman") || raw_voice_profile_string.includes("young man")) {
            extracted_age_label = "Young Adult";
          } else if (raw_voice_profile_string.includes("middle-aged") || raw_voice_profile_string.includes("middle aged")) {
            extracted_age_label = "Middle-Aged";
          } else if (raw_voice_profile_string.includes("elderly") || raw_voice_profile_string.includes("old")) {
            extracted_age_label = "Elderly";
          }

          voice_mapping_matrix[character_key].gender = discovered_member.gender || extracted_gender_label;
          voice_mapping_matrix[character_key].age = discovered_member.implied_age || extracted_age_label;
          
          // WHAT: Storing the Qwen3 DesignVoice schema fields extracted by Pass 1 AI.
          // WHY: Each field maps directly to a semantic dimension of the Qwen3-TTS voice synthesis engine:
          //      voice_profile → acoustic texture and register, identity_background → narrative gravity and weight,
          //      physical_appearance → pacing and structural presence, personality_traits → delivery register.
          //      Converts any complex object/array responses from the AI extraction directly into clean
          //      text format, preventing structural pollution or "[object Object]" artifacts in project_state.json.
          const clean_voice_profile_string = format_general_metadata_field_to_string(discovered_member.voice_profile || discovered_member.base_voice || "");
          const clean_identity_background_string = format_general_metadata_field_to_string(discovered_member.identity_background || "");
          const clean_physical_appearance_string = format_general_metadata_field_to_string(discovered_member.physical_appearance || "");
          const clean_personality_traits_string = format_general_metadata_field_to_string(discovered_member.personality_traits || "");
          const clean_personal_motto_string = format_general_metadata_field_to_string(discovered_member.personal_motto || "");

          voice_mapping_matrix[character_key].voiceProfile = clean_voice_profile_string || "Normal physical voice";
          voice_mapping_matrix[character_key].identityBackground = clean_identity_background_string;
          voice_mapping_matrix[character_key].physicalAppearance = clean_physical_appearance_string;
          voice_mapping_matrix[character_key].personalityTraits = clean_personality_traits_string;
          voice_mapping_matrix[character_key].personalMotto = clean_personal_motto_string;

          // WHAT: Backward-compatible population of legacy fields.
          // WHY: Other parts of the codebase (e.g., directorial script generation, style prompt compilation)
          //      may still read baseVoice and traits. We keep them populated to prevent regressions.
          voice_mapping_matrix[character_key].baseVoice = clean_voice_profile_string || voice_mapping_matrix[character_key].designPrompt || "Normal physical voice";
          voice_mapping_matrix[character_key].traits = clean_personality_traits_string || clean_voice_profile_string || "Story character";

          // WHAT: Compiling the full multi-section Qwen3 DesignVoice character card as the designPrompt.
          // WHY: This precompiled prompt is sent directly to the VoiceStyle PrimitiveString node (ID 43)
          //      in the Qwen3-tts-DesignVoice_API.json workflow during synthesis. By assembling it now,
          //      the synthesis handler can use it as-is without needing to re-read individual fields.
          let compiled_design_prompt_character_card = `Character Name: ${character_key}\n`;
          compiled_design_prompt_character_card += `Voice Profile: ${clean_voice_profile_string || "Normal physical voice"}\n`;
          if (clean_identity_background_string) {
            compiled_design_prompt_character_card += `Identity & Background: ${clean_identity_background_string}\n`;
          }
          if (clean_physical_appearance_string) {
            compiled_design_prompt_character_card += `Physical Appearance: ${clean_physical_appearance_string}\n`;
          }
          if (clean_personality_traits_string) {
            compiled_design_prompt_character_card += `Personality Traits: ${clean_personality_traits_string}\n`;
          }
          if (clean_personal_motto_string) {
            compiled_design_prompt_character_card += `Personal Motto: ${clean_personal_motto_string}`;
          }
          voice_mapping_matrix[character_key].designPrompt = compiled_design_prompt_character_card.trim();

          voice_mapping_matrix[character_key].currentEmotion = "neutral and observant";
        }
      }

      active_loaded_project_state_object.voiceMapping = voice_mapping_matrix;
      await trigger_project_state_disk_flush();
    }
  } catch (pass_one_error) {
    console.error(`Global Cast Extraction Pass 1 failed for chunk ${current_chunk_index + 1}.`, pass_one_error);
    alert(`Global Cast Discovery encountered an error: ${pass_one_error.message}`);
  }
  } // End of chunk loop

  // WHAT: Rebuilding lists and visual panels.
  // WHY: Keeps UI views synchronized with updated cast state modifications.
  populate_voice_matrix_configuration_cards();
  if (typeof populate_screenplay_cards_in_editor_view === "function") {
    populate_screenplay_cards_in_editor_view();
  }
}
// =========================================================================
// POST-PRODUCTION - STITCHING & ASSEMBLER CONSOLE (PASS 5)
// =========================================================================

// WHAT: Counts completed syntheses and advances visual tracking gauges.
// WHY: Keeps user updated on generation ratios in the stitching console.
function refresh_synthesis_progress_tracking_meters() {
  // WHAT: Guarding against unitialized project state models.
  // WHY: If no project is currently loaded into active memory, there are no lists to scan.
  if (!active_loaded_project_state_object) {
    return;
  }

  // WHAT: Summing up classic screenplay segments progress.
  // WHY: Displays rendering ratio in the post-production console.
  const classic_segments_list = active_loaded_project_state_object.scriptSegments || [];
  const classic_total_count = classic_segments_list.length;
  let classic_completed_count = 0;
  for (let index_counter = 0; index_counter < classic_total_count; index_counter++) {
    if (classic_segments_list[index_counter].audioPath) {
      classic_completed_count++;
    }
  }

  // WHAT: Summing up directorial segments progress.
  // WHY: Displays rendering ratio in the post-production console.
  const directorial_segments_list = active_loaded_project_state_object.directorialSegments || [];
  const directorial_total_count = directorial_segments_list.length;
  let directorial_completed_count = 0;
  for (let index_counter = 0; index_counter < directorial_total_count; index_counter++) {
    if (directorial_segments_list[index_counter].audioPath) {
      directorial_completed_count++;
    }
  }

  // WHAT: Calculating exact ratios for classic synthesis.
  // WHY: Feeds percentage integers to the visual progress track bars.
  const classic_synthesis_progress_percentage = (classic_total_count > 0) 
    ? Math.floor((classic_completed_count / classic_total_count) * 100) 
    : 0;

  // WHAT: Calculating exact ratios for directorial synthesis.
  // WHY: Feeds percentage integers to the visual progress track bars.
  const directorial_synthesis_progress_percentage = (directorial_total_count > 0) 
    ? Math.floor((directorial_completed_count / directorial_total_count) * 100) 
    : 0;

  // WHAT: Updating Classic Screenplay UI progress labels and fill bars.
  // WHY: Dynamically updates indicators to keep the user visually aligned.
  const label_classic_synthesis = document.getElementById("label_classic_queue_synthesis_ratio");
  const bar_classic_synthesis = document.getElementById("bar_classic_queue_synthesis_progress_fill");
  if (label_classic_synthesis && bar_classic_synthesis) {
    label_classic_synthesis.textContent = `${classic_completed_count} / ${classic_total_count} Lines (${classic_synthesis_progress_percentage}%)`;
    bar_classic_synthesis.style.width = `${classic_synthesis_progress_percentage}%`;
  }

  // WHAT: Updating Directorial Orchestration UI progress labels and fill bars.
  // WHY: Dynamically updates indicators to keep the user visually aligned.
  const label_directorial_synthesis = document.getElementById("label_directorial_queue_synthesis_ratio");
  const bar_directorial_synthesis = document.getElementById("bar_directorial_queue_synthesis_progress_fill");
  if (label_directorial_synthesis && bar_directorial_synthesis) {
    label_directorial_synthesis.textContent = `${directorial_completed_count} / ${directorial_total_count} Lines (${directorial_synthesis_progress_percentage}%)`;
    bar_directorial_synthesis.style.width = `${directorial_synthesis_progress_percentage}%`;
  }
}



// =========================================================================
// WAVEFORM-PLAYLIST INTERACTIVE MULTITRACK EDITOR & TRANSPORT CONTROLS
// =========================================================================

// =========================================================================
// POST-PRODUCTION DATA-DRIVEN TIMELINE EDITOR
// =========================================================================

let timeline_clips_data = [];
let timeline_pixels_per_second = 34;

function update_timeline_zoom(value) {
  timeline_pixels_per_second = parseInt(value, 10);
  const zoom_label = document.getElementById('timeline_zoom_label');
  if (zoom_label) zoom_label.textContent = `${timeline_pixels_per_second}px/s`;
  render_data_driven_timeline();
}

async function import_storyboard_takes_to_preview_playlist() {
  if (!active_loaded_project_state_object || !active_selected_workspace_directory_path) {
    alert('Please load an audiobook project first.');
    return;
  }

  const version_selector = document.getElementById('select_import_version');
  const is_directorial_flag = version_selector ? version_selector.value === 'directorial' : false;
  
  const segments_list = is_directorial_flag
    ? active_loaded_project_state_object.directorialSegments
    : active_loaded_project_state_object.scriptSegments;

  if (!segments_list || segments_list.length === 0) {
    alert('There are no segments loaded in the storyboard for this version.');
    return;
  }

  const start_line_input_element = document.getElementById('input_import_start_line');
  const end_line_input_element = document.getElementById('input_import_end_line');

  let import_start_index_boundary = start_line_input_element && start_line_input_element.value !== "" 
    ? parseInt(start_line_input_element.value, 10) 
    : 0;
  let import_end_index_boundary = end_line_input_element && end_line_input_element.value !== "" 
    ? parseInt(end_line_input_element.value, 10) 
    : segments_list.length - 1;

  if (import_start_index_boundary < 0) import_start_index_boundary = 0;
  if (import_end_index_boundary >= segments_list.length) import_end_index_boundary = segments_list.length - 1;
  if (import_start_index_boundary > import_end_index_boundary) {
    alert('Start line must be less than or equal to End line.');
    return;
  }

  const target_file_prefix_label = is_directorial_flag ? 'line_directorial' : 'line';
  
  const gap_input = document.getElementById('input_post_prod_pause_between_lines');
  const gap_seconds = gap_input ? parseFloat(gap_input.value) : 0.6;

  document.getElementById('waveform_sim_status_label').textContent = 'Fetching audio metadata...';

  timeline_clips_data = [];
  let current_start_time = 0;

  for (let segment_index = import_start_index_boundary; segment_index <= import_end_index_boundary; segment_index++) {
    const segment_item = segments_list[segment_index];
    
    let active_take_number = 1;
    let active_take_absolute_path = null;
    if (segment_item.audioVersions && segment_item.audioVersions.length > 0) {
      for (let version_index = 0; version_index < segment_item.audioVersions.length; version_index++) {
        if (segment_item.audioVersions[version_index].isActive) {
          active_take_number = segment_item.audioVersions[version_index].take;
          active_take_absolute_path = segment_item.audioVersions[version_index].filePath;
          break;
        }
      }
    }

    if (!active_take_absolute_path) {
      active_take_absolute_path = `${active_selected_workspace_directory_path.replace(/\\/g, '/')}/${active_loaded_project_state_object.projectName}/audio/takes/${target_file_prefix_label}_${segment_item.index_position}/take_${active_take_number}.mp3`;
    }

    // Call the fast metadata extractor via IPC
    const duration = await window.audiobook_api.get_audio_duration(active_take_absolute_path);
    
    const speaker_name = segment_item.speaker || 'Narrator';
    let block_color = '#485F86';
    if (active_loaded_project_state_object.voiceMapping && active_loaded_project_state_object.voiceMapping[speaker_name] && active_loaded_project_state_object.voiceMapping[speaker_name].colorCode) {
      block_color = active_loaded_project_state_object.voiceMapping[speaker_name].colorCode;
    }

    timeline_clips_data.push({
      id: `clip_${segment_item.index_position}`,
      index_position: segment_item.index_position,
      speaker: speaker_name,
      text: segment_item.text || "",
      audioVersions: segment_item.audioVersions || [],
      active_take_number: active_take_number,
      filePath: active_take_absolute_path,
      startTime: current_start_time,
      duration: duration,
      color: block_color,
      gap_before: gap_seconds
    });

    current_start_time += duration + gap_seconds;
  }

  document.getElementById('waveform_sim_status_label').textContent = 'Timeline Editor Ready - ' + timeline_clips_data.length + ' tracks loaded';
  render_data_driven_timeline();
}

function render_data_driven_timeline() {
  const track_container = document.getElementById('timeline_track');
  if (!track_container) return;
  
  track_container.innerHTML = '';
  
  // WHAT: Sequentially calculate absolute start times based on previous durations and gaps.
  // WHY: Since the UI now uses relative flex wrapping, we must calculate the math manually for the FFmpeg export backend.
  let current_start = 0;
  timeline_clips_data.forEach(clip => {
     clip.startTime = current_start + clip.gap_before;
     current_start = clip.startTime + clip.duration;
  });

  for (let clip_index = 0; clip_index < timeline_clips_data.length; clip_index++) {
    const clip = timeline_clips_data[clip_index];
    const clip_div = document.createElement('div');
    clip_div.id = clip.id;
    clip_div.className = 'timeline_clip_block';
    
    const width_px = clip.duration * timeline_pixels_per_second;
    const margin_left_px = clip.gap_before * timeline_pixels_per_second;
    
    clip_div.style.position = 'relative';
    clip_div.style.marginLeft = `${margin_left_px}px`;
    clip_div.style.height = '60px';
    clip_div.style.width = `${width_px}px`;
    clip_div.style.backgroundColor = clip.color;
    clip_div.style.borderRadius = '4px';
    clip_div.style.border = '1px solid rgba(255,255,255,0.3)';
    clip_div.style.cursor = 'grab';
    clip_div.style.display = 'inline-flex';
    clip_div.style.flexShrink = '0';
    clip_div.style.alignItems = 'center';
    clip_div.style.justifyContent = 'center';
    clip_div.style.overflow = 'hidden';
    clip_div.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
    clip_div.setAttribute('data-index', clip_index);
    clip_div.title = `[${clip.speaker}] ${clip.text}`;
    
    // WHAT: Hook right click context menu to audio playback.
    // WHY: Let's the user quickly preview a specific block without building a full playback transport.
    clip_div.addEventListener('contextmenu', (context_menu_mouse_event) => {
      context_menu_mouse_event.preventDefault();
      const audio = new Audio(clip.filePath);
      audio.play();
    });
    
    // WHAT: Hook double click to open the take selector modal.
    // WHY: Allows the user to switch takes visually from the timeline.
    clip_div.addEventListener('dblclick', (double_click_event) => {
      double_click_event.preventDefault();
      show_take_selector_modal(clip);
    });
    
    const label = document.createElement('span');
    label.textContent = `${clip.index_position}: ${clip.speaker}`;
    label.style.color = '#fff';
    label.style.fontSize = '10px';
    label.style.whiteSpace = 'nowrap';
    label.style.pointerEvents = 'none';
    label.style.textShadow = '0 1px 2px rgba(0,0,0,0.8)';
    label.style.padding = '0 4px';
    
    clip_div.appendChild(label);
    track_container.appendChild(clip_div);
  }
  
  setup_timeline_interactions();
}

function setup_timeline_interactions() {
  if (typeof interact !== 'undefined') {
    interact('.timeline_clip_block')
      .draggable({
        inertia: false,
        modifiers: [
          interact.modifiers.restrictRect({
            restriction: 'parent',
            endOnly: false
          })
        ],
        autoScroll: true,
        listeners: {
          move: dragMoveListener,
          end: dragEndListener
        }
      });
  }
}

function dragMoveListener(event) {
  const target = event.target;
  const horizontal_translation_pixels = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
  target.style.transform = `translate(${horizontal_translation_pixels}px, 0)`;
  target.setAttribute('data-x', horizontal_translation_pixels);
}

function dragEndListener(event) {
  const target = event.target;
  const clip_index = parseInt(target.getAttribute('data-index'), 10);
  const clip = timeline_clips_data[clip_index];
  
  const x_offset = parseFloat(target.getAttribute('data-x')) || 0;
  target.style.transform = 'translate(0px, 0)';
  target.setAttribute('data-x', 0);
  
  const time_shift = x_offset / timeline_pixels_per_second;
  if (time_shift === 0) return;
  
  // WHAT: Adjusting the block's physical margin gap directly.
  // WHY: In a flex wrap layout, absolute left positions don't exist. Gaps are controlled by margin-left.
  clip.gap_before += time_shift;
  if (clip.gap_before < 0) clip.gap_before = 0;
  
  render_data_driven_timeline();
}

// WHAT: Generates and displays a glassmorphism modal to select alternate takes.
// WHY: Fulfills the user requirement to switch takes from a dropdown via a double click interaction.
function show_take_selector_modal(clip) {
  let modal = document.getElementById('take_selector_modal');
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.id = 'take_selector_modal';
  modal.className = 'position-fixed top-50 left-50 translate-middle bg-slate-900-95 border-cyan-glow radius-lg p-20 shadow-lg text-white min-w-400px z-9999';

  let options_html = '';
  if (clip.audioVersions && clip.audioVersions.length > 0) {
    clip.audioVersions.forEach(v => {
      const selected = v.take === clip.active_take_number ? 'selected' : '';
      options_html += `<option value="${v.take}" ${selected}>Take ${v.take}</option>`;
    });
  } else {
    options_html = `<option value="1">Take 1 (Default)</option>`;
  }

  modal.innerHTML = `
    <h3 class="mt-0 text-gold">${clip.speaker}</h3>
    <p class="font-italic mb-20 text-14">"${clip.text}"</p>
    <div class="mb-20">
      <label class="d-block mb-5 text-12 text-muted-cyan">Select Take</label>
      <select id="take_selector_dropdown" class="form_select_dropdown w-100">
        ${options_html}
      </select>
    </div>
    <div class="d-flex justify-content-end gap-10">
      <button class="cyber_btn btn_secondary" onclick="document.getElementById('take_selector_modal').remove()">Cancel</button>
      <button class="cyber_btn btn_primary" onclick="apply_selected_take(${clip.index_position})">Apply Take</button>
    </div>
  `;
  
  document.body.appendChild(modal);
}

// WHAT: Applies the selected take back to the master project state and triggers a timeline reload.
// WHY: We must save the take decision and recalculate the block duration via the import function.
function apply_selected_take(index_position) {
  const dropdown = document.getElementById('take_selector_dropdown');
  if (!dropdown) return;
  const selected_take = parseInt(dropdown.value, 10);
  
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) return;
  
  const segments_list = active_loaded_project_state_object.scriptSegments;
  const segment = segments_list.find(s => s.index_position === index_position);
  
  if (segment && segment.audioVersions) {
    segment.audioVersions.forEach(v => {
      v.isActive = (v.take === selected_take);
    });
    
    // Push the state to disk so the decision persists
    trigger_project_state_disk_flush();
    
    // Remove the modal
    document.getElementById('take_selector_modal').remove();
    
    // Reload the timeline completely so that duration math updates based on the new file metadata
    import_storyboard_takes_to_preview_playlist();
  }
}

function trigger_export_mixdown() {
  if (timeline_clips_data.length === 0) {
    alert("No clips loaded in the timeline to export.");
    return;
  }
  
  document.getElementById('waveform_sim_status_label').textContent = 'Rendering mixdown with FFmpeg...';
  
  const version_selector = document.getElementById('select_import_version');
  const is_directorial_flag = version_selector ? version_selector.value === 'directorial' : false;
  
  window.audiobook_api.stitch_timeline(
    active_selected_workspace_directory_path,
    active_loaded_project_state_object.projectName,
    timeline_clips_data,
    is_directorial_flag
  ).then(response => {
    if (response.success) {
      document.getElementById('waveform_sim_status_label').textContent = 'Export Saved: ' + response.masterAudioPath;
    } else {
      document.getElementById('waveform_sim_status_label').textContent = 'Export Failed: ' + response.error;
    }
  }).catch(err => {
    console.error("Export Error:", err);
    document.getElementById('waveform_sim_status_label').textContent = 'Export Failed. Check console.';
  });
}

// WHAT: Populates the test phrase textarea with a pre-defined calibration script.
// WHY: Allows the user to quickly load phonetically dense scripts for voice testing.
function populate_test_phrase_dropdown(character_name_string, selected_option_value) {
  const scripts = {
    "option1": "The direct path through the valley was covered in thick, dark moss. Young children should always evaluate their choices before jumping into unknown waters. She saw a magnificent bluejay perched high upon the smooth wooden fence, singing a remarkably clear tune that echoed softly across the quiet, frozen northern landscape.",
    "option2": "Please pack those five big leather bags into the red truck as quickly as possible. We realized the complex project required specific technical expertise and an extra measure of patience. The bright yellow sunlight cast long, dramatic shadows through the glass windows, creating a striking contrast against the rough stone floor.",
    "option3": "The silver sunrise cast a sharp reflection across the frozen surface of the lake. She observed several small, unusual birds searching for seeds beneath the thick brush. It was a exceptionally quiet morning, matching her peaceful state of mind before the long, strenuous journey across the southern plains finally began.",
    "option4": "Please pull the heavy black tarp completely over the dynamic equipment before the storm begins. We discovered that a background packet of technical data could predict the group’s behavior with remarkable accuracy. The bright spotlight created distinct, dramatic patterns on the dark wooden floor, completely captivating the quiet audience.",
    "option5": "The winding mountain trail offered a truly magnificent view of the entire valley below. Many local folklore stories were originally written around these ancient, towering pine trees. As the cold autumn wind began to howl, a strange sense of wonder and calm settled over the solitary traveler."
  };

  if (scripts[selected_option_value]) {
    const textarea = document.getElementById(`test_phrase_${character_name_string}`);
    if (textarea) {
      textarea.value = scripts[selected_option_value];
      modify_character_test_phrase(character_name_string, scripts[selected_option_value]);
    }
  }
}

// WHAT: Promotes a test generation file directly to be the master anchor.
// WHY: Streamlines the workflow so the user doesn't have to re-save an anchor if the test sounds perfect.
async function promote_test_take_to_anchor(character_name_string, emotion) {
  const character_timbre_details = active_loaded_project_state_object.voiceMapping[character_name_string];
  
  // WHAT: Checking if the character mapping or the specific emotional take exists in the project state.
  // WHY: If the file is missing from state, we show an alert and abort early to prevent invoking the API with undefined values.
  if (!character_timbre_details || !character_timbre_details.testTakes || !character_timbre_details.testTakes[emotion]) {
    alert("Test take not found.");
    return;
  }

  const test_take_file_path = character_timbre_details.testTakes[emotion];
  
  // WHAT: Calling the backend IPC promote function to duplicate the audio take.
  // WHY: We copy the audio take WAV file physically into the persistent anchors directory.
  const response = await window.audiobook_api.promote_test_to_anchor(
    active_selected_workspace_directory_path,
    active_loaded_project_state_object.projectName,
    character_name_string,
    test_take_file_path
  );

  // WHAT: Evaluating the response from the backend promote operation.
  // WHY: If successful, we update the local UI state and persist it to disk; otherwise, we alert the user with the error message.
  if (response && response.success) {
    // WHAT: Updating the master anchor file path and timestamp in the local character state.
    // WHY: Updates the UI representation so the newly promoted anchor WAV is loaded in the player.
    character_timbre_details.anchorFilePath = response.anchor_file_path;
    character_timbre_details.anchorBakedAt = new Date().toISOString();
    
    // WHAT: Copying the test phrase text over to become the official anchor phrase.
    // WHY: The text used to generate the test take is now the transcript for the master anchor voice.
    if (character_timbre_details.testPhrase) {
      character_timbre_details.anchorPhrase = character_timbre_details.testPhrase;
    }
    
    // WHAT: Saving project state to disk and rendering the UI layout.
    // WHY: Flushes the modified state variables to project_state.json and updates the DOM elements.
    trigger_project_state_disk_flush();
    populate_voice_matrix_configuration_cards();
    
    // WHAT: Automatically saving the newly saved character anchor to the ComfyUI models folder.
    // WHY: Saves the user a manual step since anchoring natively implies saving the voice template for future use.
    save_custom_voice_to_comfyui(character_name_string);
    
    alert("Test take successfully saved as Character Anchor and exported to ComfyUI!");
  } else {
    // WHAT: Alerting the user of the promotion failure.
    // WHY: Keeps the user informed if there was a backend error during the copy operation.
    alert("Error promoting test take: " + (response ? response.error : "Unknown IPC error"));
  }
}

// WHAT: Saves a character's voice anchor directly into ComfyUI's model folder using the backend workflow.
// WHY: Allows for faster, more consistent custom voice generations in the future via LoadCustomVoice.
async function save_custom_voice_to_comfyui(character_name_string) {
  const character_timbre_details = active_loaded_project_state_object.voiceMapping[character_name_string];
  
  // WHAT: Ensuring that the character's details and active anchor path exist before proceeding.
  // WHY: We cannot execute the custom voice save operation without a valid baked audio file.
  if (!character_timbre_details || !character_timbre_details.anchorFilePath) {
    alert("Please save an anchor first.");
    return;
  }

  const save_button_element = document.getElementById(`save_custom_voice_btn_${character_name_string}`);
  
  // WHAT: Disabling the save button and updating its text during execution.
  // WHY: Prevents the user from double-clicking the button while the background ComfyUI workflow runs.
  if (save_button_element) {
    save_button_element.disabled = true;
    save_button_element.textContent = "⏳ Saving...";
  }

  try {
    // WHAT: Dispatching the custom voice save request to the backend.
    // WHY: Invokes the node-based ComfyUI prompt submission to generate and save the custom voice files.
    const response = await window.audiobook_api.save_custom_voice(
      active_selected_workspace_directory_path,
      active_loaded_project_state_object.projectName,
      character_name_string,
      character_timbre_details.anchorFilePath,
      character_timbre_details.anchorPhrase
    );

    // WHAT: Assessing the custom voice save response.
    // WHY: If successful, we update local state metadata, save to disk, and alert the user. Otherwise, we reset button state and alert error.
    if (response && response.success) {
      // WHAT: Storing the saved voice filename in the character timbre details.
      // WHY: Allows subsequent voice generation workflows to load this voice profile directly.
      character_timbre_details.savedVoiceFilename = response.saved_filename;
      trigger_project_state_disk_flush();
      populate_voice_matrix_configuration_cards();
      alert("Custom voice successfully saved to ComfyUI!\nFilename: " + response.saved_filename);
    } else {
      // WHAT: Re-enabling the save button if the API returned a failure.
      // WHY: Allows the user to try saving again after looking into the ComfyUI server logs.
      alert("Error saving custom voice: " + (response ? response.error : "Unknown error"));
      if (save_button_element) {
        save_button_element.disabled = false;
        save_button_element.textContent = "💾 Save to ComfyUI";
      }
    }
  } catch (comfyui_save_exception_object) {
    // WHAT: Handling unexpected errors from the IPC call itself.
    // WHY: Keeps the frontend UI stable and restores button interactive states on failure.
    console.error("Save to ComfyUI error:", comfyui_save_exception_object);
    alert("Failed to save custom voice.");
    if (save_button_element) {
      save_button_element.disabled = false;
      save_button_element.textContent = "💾 Save to ComfyUI";
    }
  }
}

// WHAT: Resets the character voice mapping to remove the saved Character Anchor.
// WHY: Allows the user to unbind a saved character voice.
function trigger_character_voice_mapping_reset(character_name_string) {
  if (confirm(`Are you sure you want to unbind the Character Anchor for "${character_name_string}"?`)) {
    if (active_loaded_project_state_object && active_loaded_project_state_object.voiceMapping[character_name_string]) {
      delete active_loaded_project_state_object.voiceMapping[character_name_string].savedVoiceFilename;
      trigger_project_state_disk_flush();
      populate_voice_matrix_configuration_cards();
    }
  }
}

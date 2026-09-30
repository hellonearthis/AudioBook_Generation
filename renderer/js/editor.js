// =========================================================================
// QUEUE STATUS REGISTRIES - SURVIVES DOM REBUILDS
// =========================================================================

// WHAT: In-memory registry tracking the real-time queue/processing status of each screenplay card.
// WHY: DOM rebuilds (populate_screenplay_cards_in_editor_view) destroy ephemeral status indicators.
//      This registry preserves queued/processing/failed states across rebuilds so cards don't revert
//      to idle when another card triggers a full re-render of the card list.
let renderer_card_queue_status_registry = {};

// WHAT: In-memory registry tracking the real-time queue/processing status of each directorial card.
// WHY: Same reasoning as above, but for the Column 3 directorial enriched screenplay cards.
let renderer_directorial_card_queue_status_registry = {};

// =========================================================================
// SCREENPLAY RENDERER - DOM CARD BUILDER
// =========================================================================

// WHAT: Populates the right script editor panel with interactive blocks representing each line.
// WHY: Renders a screenplay script containing speakers, editable texts, acting directions, and audio playback nodes.
function populate_screenplay_cards_in_editor_view() {
  if (!active_loaded_project_state_object && typeof window !== "undefined" && window.active_loaded_project_state_object) {
    active_loaded_project_state_object = window.active_loaded_project_state_object;
  }
  const screenplay_cards_wrapper_element = document.getElementById("screenplay_segment_cards_wrapper");
  if (!screenplay_cards_wrapper_element) {
    return;
  }
  screenplay_cards_wrapper_element.innerHTML = "";

  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments || active_loaded_project_state_object.scriptSegments.length === 0) {
    // WHAT: Displaying helpful action prompt.
    // WHY: Informs user they need to parse dialogue before editing is possible.
    screenplay_cards_wrapper_element.innerHTML = `
      <div class="empty_state_screen vh-50">
        <div class="empty_state_hex_glow text-purple">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        </div>
        <h4 class="empty_state_title">No Screenplay Segments Parsed</h4>
        <p class="empty_state_tagline">The raw text has not been attributed to speakers. Click "Automate Attribution" above to divide the book into character scripts.</p>
      </div>
    `;
    return;
  }

  // WHAT: Compiling list of discovered characters from voice mappings database.
  // WHY: We populate dropdown options so the editor can reassign speakers cleanly.
  const list_of_known_character_names = ["Narrator"];
  if (active_loaded_project_state_object.voiceMapping) {
    const keys_of_mapped_voices = Object.keys(active_loaded_project_state_object.voiceMapping);
    for (let index_counter = 0; index_counter < keys_of_mapped_voices.length; index_counter++) {
      const voice_key_name = keys_of_mapped_voices[index_counter];
      if (voice_key_name !== "Narrator") {
        list_of_known_character_names.push(voice_key_name);
      }
    }
  }

  // WHAT: Looping through segments.
  // WHY: Renders individual screenplay elements sequentially.
  // WHAT: Inspecting active script segments for unreviewed classifier proposed diffs.
  // WHY: Displays a bulk action bar at the top of Column 2 allowing 1-click batch acceptance or dismissal.
  const active_attribution_diffs_list = active_loaded_project_state_object.scriptSegments.filter(
    (single_segment) => single_segment && single_segment.proposed_diff
  );

  if (active_attribution_diffs_list.length > 0) {
    const bulk_diff_banner_element = document.createElement("div");
    bulk_diff_banner_element.className = "bulk_attribution_diff_banner";
    bulk_diff_banner_element.id = "bulk_attribution_diff_banner_node";
    bulk_diff_banner_element.innerHTML = `
      <div class="diff_banner_info_group">
        <span class="diff_banner_badge">⚡ ${active_attribution_diffs_list.length} Diffs Found</span>
        <span class="diff_banner_label">Classifier proposes alternative speaker attributions against reference baseline.</span>
      </div>
      <div class="diff_banner_actions_group">
        <button class="diff_banner_btn diff_banner_btn_accept" onclick="bulk_accept_all_attribution_diffs()" title="Accept all proposed speaker diffs">✓ Accept All Diffs</button>
        <button class="diff_banner_btn diff_banner_btn_dismiss" onclick="bulk_dismiss_all_attribution_diffs()" title="Keep current speaker assignments for all diffs">✕ Dismiss All</button>
      </div>
    `;
    screenplay_cards_wrapper_element.appendChild(bulk_diff_banner_element);
  }

  for (let segment_index_counter = 0; segment_index_counter < active_loaded_project_state_object.scriptSegments.length; segment_index_counter++) {
    const active_script_segment_item = active_loaded_project_state_object.scriptSegments[segment_index_counter];
    active_script_segment_item.index_position = segment_index_counter; // ensure strict mapping indexes

    const individual_script_segment_card_element = document.createElement("div");
    
    // WHAT: Binding visual style classes.
    // WHY: Colors dialogue segments separately from standard narrator prose.
    if (active_script_segment_item.type === "dialogue") {
      individual_script_segment_card_element.className = "screenplay_item_card dialogue_type_card";
    } else {
      individual_script_segment_card_element.className = "screenplay_item_card narrator_type_card";
    }

    individual_script_segment_card_element.id = `screenplay_card_node_${segment_index_counter}`;

    if (segment_index_counter === active_inspected_segment_index) {
      individual_script_segment_card_element.classList.add("active_inspected_card");
    }

    individual_script_segment_card_element.addEventListener("click", (click_evt) => {
      if (!click_evt.target.closest("button, select, textarea, span.inline_qwen_input")) {
        select_and_inspect_segment(segment_index_counter);
      }
    });

    // WHAT: Checking if this specific screenplay segment has custom workflow override properties active.
    // WHY: Provides instant visual cues to the user about which cards deviate from global cast configurations.
    //      We only check workflowType here so that auto-generated seeds during regeneration don't trigger the "Override Active" badge.
    const is_custom_override_enabled_on_card = active_script_segment_item.workflowOverride && 
      active_script_segment_item.workflowOverride.workflowType && 
      active_script_segment_item.workflowOverride.workflowType !== "inherit";

    const override_button_text = is_custom_override_enabled_on_card ? "⚙️ Override Active" : "⚙️ Override";
    const override_button_class = is_custom_override_enabled_on_card
      ? "btn-override-active"
      : "btn-override-default";

    // WHAT: Constructing character dropdown options dynamically.
    // WHY: Populates the speaker selector pill with list of all cast profiles.
    let character_select_options_html = "";
    for (let char_index = 0; char_index < list_of_known_character_names.length; char_index++) {
      const character_name_option = list_of_known_character_names[char_index];
      const selected_attribute_flag = (active_script_segment_item.speaker === character_name_option) ? "selected" : "";
      character_select_options_html += `<option value="${character_name_option}" ${selected_attribute_flag}>${character_name_option}</option>`;
    }

    // WHAT: Creating the pill-styled dropdown selector listing all synthesized takes.
    // WHY: Enables version control for each cell so users can preview and active-select different takes.
    let take_select_options_html = "";
    if (active_script_segment_item.audioVersions && active_script_segment_item.audioVersions.length > 0) {
      take_select_options_html += `<select class="take_select_pill" onchange="handle_card_take_change_event(${segment_index_counter}, this.value, false)" title="Switch active audio take">`;
      for (let version_counter = 0; version_counter < active_script_segment_item.audioVersions.length; version_counter++) {
        const take_version_item = active_script_segment_item.audioVersions[version_counter];
        const selected_attribute_flag = take_version_item.isActive ? "selected" : "";
        take_select_options_html += `<option value="${take_version_item.take}" ${selected_attribute_flag}>Take ${take_version_item.take}</option>`;
      }
      take_select_options_html += `</select>`;
    }

    // WHAT: Loading character profile mappings for default value fallbacks.
    // WHY: Provides age, gender, and voice texture attributes if local card properties are missing.
    const character_mapping_details_for_active_speaker = (active_loaded_project_state_object.voiceMapping && active_loaded_project_state_object.voiceMapping[active_script_segment_item.speaker]) || {};

    // WHAT: Instantiating the Qwen voice performance details structure.
    // WHY: Populates the text input fields with the active state or appropriate defaults so fields are never blank.
    const active_qwen_style_configuration_object = active_script_segment_item.qwen_style || {
      age_range: character_mapping_details_for_active_speaker.age || "Adult",
      gender: character_mapping_details_for_active_speaker.gender || "Unknown",
      pitch: "medium",
      vocal_texture: character_mapping_details_for_active_speaker.traits || "smooth and authoritative",
      pacing: "normal",
      cadence: "steady cadence",
      acting_persona: "natural narrator",
      vocal_technique: "steady rhythm",
      rich_emotion: active_script_segment_item.direction || "calm delivery"
    };

    // WHAT: Helper function to generate auto-sizing editable inputs
    // WHY: Provides a seamless Mad Libs style interface that accurately grows with content.
    const create_qwen_input = (value, placeholder, property_key) => {
      const safe_value = (value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<span class="inline_qwen_input" contenteditable="true" data-placeholder="${placeholder}" title="Edit ${placeholder}" oninput="handle_card_qwen_style_modification_event(${segment_index_counter}, '${property_key}', this.textContent)" onkeydown="if(event.key === 'Enter') { event.preventDefault(); this.blur(); }">${safe_value}</span>`;
    };

    // WHAT: Hide the type badge for Tech Books (Narrator only)
    const is_tech_book = active_loaded_project_state_object.voiceMapping && Object.keys(active_loaded_project_state_object.voiceMapping).length === 1 && active_loaded_project_state_object.voiceMapping["Narrator"];

    // WHAT: Injecting card layout structures.
    // WHY: Houses fields, indicators, and buttons for controlling each sentence.
    individual_script_segment_card_element.innerHTML = `
      <div class="screenplay_card_meta_header">
        <div class="d-flex align-items-center gap-8">
          <span class="text-11 text-muted font-mono" title="Line Number">Line ${segment_index_counter}</span>
          <select class="speaker_select_pill" onchange="handle_card_speaker_modification_event(${segment_index_counter}, this.value)" title="Assign character voice to this line">
            ${character_select_options_html}
          </select>
          <button class="focus_anchor_btn" title="Focus and sync raw text & columns" onclick="highlight_synchronize_active_segment(${segment_index_counter}, false)">
            <svg viewBox="0 0 24 24" width="10" height="10"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
            Focus
          </button>
          <button class="focus_anchor_btn ${override_button_class}" title="Configure Qwen workflow overrides" onclick="open_cell_workflow_config_modal(${segment_index_counter}, false)">
            ${override_button_text}
          </button>
        </div>
        <div class="d-flex align-items-center gap-6">
          ${active_script_segment_item.is_user_locked ? `
            <span class="user_locked_badge" title="Speaker assignment locked by user (Protected Ground Truth)">🔒 Locked</span>
          ` : ''}
          ${active_script_segment_item.unmarked ? `
            <span class="unmarked_span_badge" title="Extracted via Stage 2A Literary Boundary Detection (Unmarked Dialogue)">📖 Unmarked</span>
          ` : ''}
          ${(active_script_segment_item.engine === 'laya' || active_script_segment_item.engine === 'clm' || active_script_segment_item.engine === 'clm_cascade') && active_script_segment_item.confidence ? `
            <span class="laya_confidence_badge ${active_script_segment_item.is_ambiguous ? 'low_confidence' : ''}" title="${active_script_segment_item.engine === 'clm' ? 'CLM-8B' : (active_script_segment_item.engine === 'clm_cascade' ? 'Cascade (CLM-8B)' : 'Laya')} Decision Confidence: ${(active_script_segment_item.confidence * 100).toFixed(0)}%">
              ${active_script_segment_item.engine === 'clm' ? '🎯' : (active_script_segment_item.engine === 'clm_cascade' ? '⚡🎯' : '⚡')} ${(active_script_segment_item.confidence * 100).toFixed(0)}%
            </span>
          ` : ''}
          <span class="card_type_badge ${is_tech_book ? 'd-none' : ''}" title="Segment category: dialogue, narrative exposition, or parenthetical direction">${active_script_segment_item.type}</span>
        </div>
      </div>

      ${active_script_segment_item.proposed_diff ? `
        <div class="attribution_diff_pill" id="attribution_diff_pill_${segment_index_counter}">
          <span class="diff_pill_label">⚡ Diff: <span class="diff_speaker_old">${active_script_segment_item.proposed_diff.previous_speaker}</span> ➔ <span class="diff_speaker_new">${active_script_segment_item.proposed_diff.proposed_speaker}</span> <span class="diff_confidence_pct">(${Math.round((active_script_segment_item.proposed_diff.confidence || 0.85) * 100)}%)</span></span>
          <div class="diff_pill_buttons_group">
            <button class="diff_pill_btn diff_accept_btn" onclick="accept_attribution_diff(${segment_index_counter})" title="Accept proposed speaker (${active_script_segment_item.proposed_diff.proposed_speaker})">✓ Accept</button>
            <button class="diff_pill_btn diff_dismiss_btn" onclick="dismiss_attribution_diff(${segment_index_counter})" title="Keep current speaker (${active_script_segment_item.proposed_diff.previous_speaker})">✕ Keep ${active_script_segment_item.proposed_diff.previous_speaker}</button>
          </div>
        </div>
      ` : ''}

      <textarea class="screenplay_text_input" onchange="handle_card_text_modification_event(${segment_index_counter}, this.value)" rows="2">${active_script_segment_item.text}</textarea>

      <div class="performance_direction_row">
        <div class="qwen_section_row">
          <span class="qwen_label_prefix">[Voice Quality]:</span>
          <span>${create_qwen_input(active_qwen_style_configuration_object.age_range, 'Age Range', 'age_range')} ${create_qwen_input(active_qwen_style_configuration_object.gender, 'Gender', 'gender')} with a ${create_qwen_input(active_qwen_style_configuration_object.pitch, 'Pitch', 'pitch')} pitch and a ${create_qwen_input(active_qwen_style_configuration_object.vocal_texture, 'Texture', 'vocal_texture')} texture.</span>
        </div>
        <div class="qwen_section_row">
          <span class="qwen_label_prefix">[Prosody]:</span>
          <span>${create_qwen_input(active_qwen_style_configuration_object.pacing, 'Pacing', 'pacing')} delivery, featuring ${create_qwen_input(active_qwen_style_configuration_object.cadence, 'Cadence', 'cadence')} speech.</span>
        </div>
        <div class="qwen_section_row">
          <span class="qwen_label_prefix">[Style]:</span>
          <span>${create_qwen_input(active_qwen_style_configuration_object.acting_persona, 'Persona', 'acting_persona')}. Emphasize ${create_qwen_input(active_qwen_style_configuration_object.vocal_technique, 'Specific technique', 'vocal_technique')}.</span>
        </div>
        <div class="qwen_section_row">
          <span class="qwen_label_prefix">[Emotion]:</span>
          <span>${create_qwen_input(active_qwen_style_configuration_object.rich_emotion, 'Primary emotional state', 'rich_emotion')}.</span>
        </div>
      </div>

      <div class="screenplay_card_actions_bar">
        <div class="synthesis_status_indicator">
          <div class="status_dot" id="synthesis_light_dot_${segment_index_counter}"></div>
          <span id="synthesis_status_label_text_${segment_index_counter}" class="text-green font-semibold">Idle</span>
        </div>
        
        <div class="card_operational_buttons">
          ${take_select_options_html}
          ${active_script_segment_item.audioVersions && active_script_segment_item.audioVersions.length > 0 ? `
            <button class="card_operation_btn btn_edit_take text-purple border-purple-glow" title="AuK Audio Editing Suite (Whisper, Denoise, Pitch, Speed, Emotion)" onclick="open_auk_edit_tools_modal(${segment_index_counter}, false)">
              <span class="text-12">🪄</span>
            </button>
            <button class="card_operation_btn btn_delete_take text-coral border-coral-glow" title="Delete active take" onclick="trigger_delete_active_take(${segment_index_counter}, false)">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
          ` : ''}
          <button class="card_operation_btn btn_regenerate" title="Synthesize this line" onclick="trigger_single_line_speech_synthesis(${segment_index_counter})">
            <svg viewBox="0 0 24 24"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          </button>
          <button class="card_operation_btn btn_play_audio" title="Play synthesized audio clip" id="btn_play_clip_element_${segment_index_counter}" onclick="play_individual_line_clip(${segment_index_counter})">
            <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
        </div>
      </div>
    `;

    screenplay_cards_wrapper_element.appendChild(individual_script_segment_card_element);
    
    // WHAT: Checking the queue status registry for any surviving status from before this DOM rebuild.
    // WHY: If a card was set to "queued" or "processing" before another card triggered a full
    //      re-render, the registry preserves that status. Without this, cards revert to idle/completed.
    const registry_entry_for_current_card = renderer_card_queue_status_registry[segment_index_counter];
    if (registry_entry_for_current_card && registry_entry_for_current_card.status) {
      // WHAT: Applying the registry's cached status instead of the simple audioPath check.
      // WHY: The registry holds the authoritative real-time state for in-flight queue items.
      update_individual_card_synthesis_status_lights(
        segment_index_counter,
        registry_entry_for_current_card.status,
        registry_entry_for_current_card.message
      );
    } else {
      // WHAT: Falling back to the standard audioPath-based status check.
      // WHY: If no registry entry exists, the card hasn't been queued in this session.
      update_individual_card_synthesis_status_lights(segment_index_counter, active_script_segment_item.audioPath ? "completed" : "idle");
    }
  }

  // WHAT: Automatically refresh Line Studio Inspector (Column 3) for the currently active card.
  // WHY: Keeps inspector telemetry, waveforms, subtext, and pacing synced with active screenplay state.
  render_line_inspector_view(active_inspected_segment_index);
}

// =========================================================================
// INTERACTIVE EVENT HANDLERS - SCREENPLAY MODIFICATION
// =========================================================================

// WHAT: Handles the dropdown event when the user selects a different audio take.
// WHY: Swaps which take is marked as active in the project state database, updates the direct file link, and saves to disk.
function handle_card_take_change_event(index_position_of_card, selected_take_number_string, is_directorial_segment_flag) {
  // Convert selected_take_number to a primitive integer to match takes accurately.
  const target_take_number_integer = parseInt(selected_take_number_string, 10);

  if (active_loaded_project_state_object) {
    // Select the correct segment list based on whether it is directorial.
    const segments_array_list = is_directorial_segment_flag
      ? active_loaded_project_state_object.directorialSegments
      : active_loaded_project_state_object.scriptSegments;

    const targeted_segment_item = segments_array_list[index_position_of_card];

    if (targeted_segment_item && targeted_segment_item.audioVersions) {
      for (let version_counter = 0; version_counter < targeted_segment_item.audioVersions.length; version_counter++) {
        const take_version_item = targeted_segment_item.audioVersions[version_counter];
        if (take_version_item.take === target_take_number_integer) {
          take_version_item.isActive = true;
          // Synchronize the segment's main audioPath to this active take's filePath.
          targeted_segment_item.audioPath = take_version_item.filePath;
        } else {
          take_version_item.isActive = false;
        }
      }

      // Flush changes to project_state.json immediately to preserve them.
      trigger_project_state_disk_flush();

      // Refresh the specific view to show the new active selection.
      if (is_directorial_segment_flag) {
        populate_directorial_cards_in_editor_view();
      } else {
        populate_screenplay_cards_in_editor_view();
      }
    }
  }
}

// WHAT: Deletes the currently active audio take for a screenplay card from the state and the filesystem.
// WHY: Gives the user a way to clean up bad takes, freeing up storage space and resetting the segment's audio state.
async function trigger_delete_active_take(index_position_of_card, is_directorial_segment_flag) {
  if (!active_loaded_project_state_object) {
    return;
  }

  // WHAT: Selecting the correct segment array list based on directorial segment flag.
  // WHY: Dialogue and directorial tracks store audio versions independently.
  const segments_array_list = is_directorial_segment_flag
    ? active_loaded_project_state_object.directorialSegments
    : active_loaded_project_state_object.scriptSegments;

  const targeted_segment_item = segments_array_list[index_position_of_card];

  if (targeted_segment_item && targeted_segment_item.audioVersions && targeted_segment_item.audioVersions.length > 0) {
    // WHAT: Finding the active take version.
    // WHY: We want to delete the take that the user currently has selected as active.
    let active_take_index_position = -1;
    for (let version_counter = 0; version_counter < targeted_segment_item.audioVersions.length; version_counter++) {
      if (targeted_segment_item.audioVersions[version_counter].isActive) {
        active_take_index_position = version_counter;
        break;
      }
    }

    if (active_take_index_position === -1) {
      alert("No active take selected to delete.");
      return;
    }

    const active_take_item_descriptor = targeted_segment_item.audioVersions[active_take_index_position];
    const take_number_to_delete = active_take_item_descriptor.take;
    const take_file_path_string = active_take_item_descriptor.filePath;

    // WHAT: Confirming with the user before deleting the file.
    // WHY: Deletion is a destructive operation and cannot be undone easily.
    const user_confirmed_deletion_flag = confirm(`Are you sure you want to delete Take ${take_number_to_delete}? This will permanently remove the audio file from your computer.`);
    if (!user_confirmed_deletion_flag) {
      return;
    }

    // WHAT: Dispatched deletion call to the backend.
    // WHY: Secure preload bridge deletes files in the native Node environment.
    const resolved_file_extension = take_file_path_string.toLowerCase().endsWith(".wav") ? ".wav" : ".mp3";
    try {
      const filesystem_deletion_result = await window.audiobook_api.delete_take_file(
        active_selected_workspace_directory_path,
        active_loaded_project_state_object.projectName,
        is_directorial_segment_flag,
        index_position_of_card,
        take_number_to_delete,
        resolved_file_extension
      );

      if (filesystem_deletion_result && filesystem_deletion_result.success) {
        // WHAT: Removing the deleted take from the active versions list.
        // WHY: Clears the state reference to the deleted audio track.
        targeted_segment_item.audioVersions.splice(active_take_index_position, 1);

        // WHAT: Resetting the active take pointer if other takes exist.
        // WHY: Keeps the timeline active if there are alternative takes.
        if (targeted_segment_item.audioVersions.length > 0) {
          // Set the first remaining take as active
          targeted_segment_item.audioVersions[0].isActive = true;
          targeted_segment_item.audioPath = targeted_segment_item.audioVersions[0].filePath;
        } else {
          // No takes left, reset audio path
          targeted_segment_item.audioPath = "";
        }

        // WHAT: Saving updated project state to disk.
        // WHY: Serializes changes to project_state.json instantly.
        await trigger_project_state_disk_flush();

        // WHAT: Redrawing the view cards.
        // WHY: Animates status lights and updates the takes selector pills instantly.
        if (is_directorial_segment_flag) {
          populate_directorial_cards_in_editor_view();
        } else {
          populate_screenplay_cards_in_editor_view();
        }
      } else {
        alert(`Failed to delete take file: ${filesystem_deletion_result ? filesystem_deletion_result.error : "Unknown error"}`);
      }
    } catch (synthesis_deletion_exception) {
      console.error("Take deletion operation failed:", synthesis_deletion_exception);
      alert(`Deletion failed: ${synthesis_deletion_exception.message}`);
    }
  }
}

// WHAT: Permanently deletes all synthesized audio takes for a screenplay card from the state database and disk.
// WHY: Allows the user to clean up all generated versions of a specific dialogue line in one click, resetting its audio state.
async function trigger_delete_all_takes(index_position_of_card, is_directorial_segment_flag) {
  if (!active_loaded_project_state_object) {
    return;
  }

  // WHAT: Selecting the correct segment array list based on directorial segment flag.
  // WHY: Dialogue and directorial tracks store audio versions independently.
  const segments_array_list = is_directorial_segment_flag
    ? active_loaded_project_state_object.directorialSegments
    : active_loaded_project_state_object.scriptSegments;

  const targeted_segment_item = segments_array_list[index_position_of_card];

  if (targeted_segment_item && targeted_segment_item.audioVersions && targeted_segment_item.audioVersions.length > 0) {
    const total_takes_count = targeted_segment_item.audioVersions.length;

    // WHAT: Confirming with the user before deleting all files.
    // WHY: Bulk deletion is a highly destructive operation and cannot be easily recovered.
    const user_confirmed_deletion_flag = confirm(`Are you absolutely sure you want to delete ALL ${total_takes_count} takes for this card? This will permanently erase all audio files for this line from your disk.`);
    if (!user_confirmed_deletion_flag) {
      return;
    }

    try {
      // WHAT: Deleting each take's file from disk sequentially.
      // WHY: Keeps our filesystem clean by unlinking every physical file recorded for this cell.
      for (let version_counter = 0; version_counter < targeted_segment_item.audioVersions.length; version_counter++) {
        const take_version_item = targeted_segment_item.audioVersions[version_counter];
        const resolved_file_extension = take_version_item.filePath.toLowerCase().endsWith(".wav") ? ".wav" : ".mp3";

        await window.audiobook_api.delete_take_file(
          active_selected_workspace_directory_path,
          active_loaded_project_state_object.projectName,
          is_directorial_segment_flag,
          index_position_of_card,
          take_version_item.take,
          resolved_file_extension
        );
      }

      // WHAT: Resetting the segment's take arrays and active references.
      // WHY: Erases state memory of all takes and resets audio indicators.
      targeted_segment_item.audioVersions = [];
      targeted_segment_item.audioPath = "";

      // WHAT: Saving updated project state to disk.
      // WHY: Serializes changes to project_state.json instantly.
      await trigger_project_state_disk_flush();

      // WHAT: Redrawing the view cards.
      // WHY: Animates status lights to idle and clears takes selector pills instantly.
      if (is_directorial_segment_flag) {
        populate_directorial_cards_in_editor_view();
      } else {
        populate_screenplay_cards_in_editor_view();
      }

    } catch (synthesis_deletion_exception) {
      console.error("Bulk take deletion operation failed:", synthesis_deletion_exception);
      alert(`Deletion failed: ${synthesis_deletion_exception.message}`);
    }
  }
}

// WHAT: Hooking speaker change selections on individual screenplay cards.
// WHY: Updates the runtime state, flags the segment as protected user-locked ground truth, and triggers immediate disk serialization.
function handle_card_speaker_modification_event(index_position_of_card, newly_selected_speaker_name) {
  if (active_loaded_project_state_object && active_loaded_project_state_object.scriptSegments) {
    const target_screenplay_segment = active_loaded_project_state_object.scriptSegments[index_position_of_card];
    if (!target_screenplay_segment) {
      return;
    }

    const previous_speaker_name = target_screenplay_segment.speaker;
    target_screenplay_segment.speaker = newly_selected_speaker_name;
    // WHAT: Locking segment to user choice.
    // WHY: Manual user edits are protected ground truth and cannot be overwritten by automated attribution runs.
    target_screenplay_segment.is_user_locked = true;
    delete target_screenplay_segment.proposed_diff;

    // WHAT: Changing structural tag types.
    // WHY: If changed to Narrator, sets segment type back to narrator block structures.
    if (newly_selected_speaker_name === "Narrator") {
      target_screenplay_segment.type = "narrator";
    } else {
      target_screenplay_segment.type = "dialogue";
    }

    // WHAT: Flagging downstream Column 3 directorial cards if speaker assignment changed.
    // WHY: Informs the director that staging and emotional delivery may need re-synchronization.
    if (
      previous_speaker_name !== newly_selected_speaker_name &&
      active_loaded_project_state_object.directorialSegments &&
      active_loaded_project_state_object.directorialSegments[index_position_of_card]
    ) {
      const corresponding_directorial_segment = active_loaded_project_state_object.directorialSegments[index_position_of_card];
      corresponding_directorial_segment.speaker = newly_selected_speaker_name;
      corresponding_directorial_segment.needs_resync = true;
      populate_directorial_cards_in_editor_view();
    }

    // WHAT: Rerendering current cards structure.
    // WHY: Reflects color switches (purple for dialogue, blue for narrator) immediately.
    populate_screenplay_cards_in_editor_view();
    trigger_project_state_disk_flush();
  }
}

// WHAT: Accepting an AI proposed speaker diff on a specific screenplay card.
// WHY: Updates the active speaker to the proposed character while safely preserving previous audio takes in history.
function accept_attribution_diff(index_position_of_card) {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) {
    return;
  }
  const target_screenplay_segment = active_loaded_project_state_object.scriptSegments[index_position_of_card];
  if (!target_screenplay_segment || !target_screenplay_segment.proposed_diff) {
    return;
  }

  const proposed_new_speaker_name = target_screenplay_segment.proposed_diff.proposed_speaker;
  target_screenplay_segment.speaker = proposed_new_speaker_name;

  if (proposed_new_speaker_name === "Narrator") {
    target_screenplay_segment.type = "narrator";
  } else {
    target_screenplay_segment.type = "dialogue";
  }

  // WHAT: Downstream audio continuity protection (Option 1).
  // WHY: Previous synthesized takes remain safely preserved in audioVersions history (marked inactive, never deleted).
  if (Array.isArray(target_screenplay_segment.audioVersions)) {
    for (let version_counter = 0; version_counter < target_screenplay_segment.audioVersions.length; version_counter++) {
      target_screenplay_segment.audioVersions[version_counter].isActive = false;
    }
  }
  target_screenplay_segment.audioPath = null;

  // WHAT: Flagging corresponding Column 3 directorial segment for re-synchronization.
  // WHY: The acting intent and delivery instructions need to align with the new character identity.
  if (
    active_loaded_project_state_object.directorialSegments &&
    active_loaded_project_state_object.directorialSegments[index_position_of_card]
  ) {
    const corresponding_directorial_segment = active_loaded_project_state_object.directorialSegments[index_position_of_card];
    corresponding_directorial_segment.speaker = proposed_new_speaker_name;
    corresponding_directorial_segment.needs_resync = true;
    populate_directorial_cards_in_editor_view();
  }

  delete target_screenplay_segment.proposed_diff;

  trigger_project_state_disk_flush();
  populate_screenplay_cards_in_editor_view();
}

// WHAT: Dismissing an AI proposed speaker diff, keeping the current speaker baseline.
// WHY: Discards the classifier's suggestion and retains the existing reference character.
function dismiss_attribution_diff(index_position_of_card) {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) {
    return;
  }
  const target_screenplay_segment = active_loaded_project_state_object.scriptSegments[index_position_of_card];
  if (!target_screenplay_segment || !target_screenplay_segment.proposed_diff) {
    return;
  }

  delete target_screenplay_segment.proposed_diff;

  trigger_project_state_disk_flush();
  populate_screenplay_cards_in_editor_view();
}

// WHAT: Bulk accepting all outstanding proposed speaker diffs in one operation.
// WHY: Streamlines reviewing when an improved model pass has systematically corrected multiple lines.
function bulk_accept_all_attribution_diffs() {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) {
    return;
  }
  const total_script_segments_list = active_loaded_project_state_object.scriptSegments;
  for (let segment_counter = 0; segment_counter < total_script_segments_list.length; segment_counter++) {
    const single_segment_item = total_script_segments_list[segment_counter];
    if (single_segment_item && single_segment_item.proposed_diff) {
      accept_attribution_diff(segment_counter);
    }
  }
}

// WHAT: Bulk dismissing all outstanding proposed speaker diffs.
// WHY: Allows the user to reject all classifier modifications and stick with existing ground truth.
function bulk_dismiss_all_attribution_diffs() {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) {
    return;
  }
  const total_script_segments_list = active_loaded_project_state_object.scriptSegments;
  for (let segment_counter = 0; segment_counter < total_script_segments_list.length; segment_counter++) {
    const single_segment_item = total_script_segments_list[segment_counter];
    if (single_segment_item && single_segment_item.proposed_diff) {
      delete single_segment_item.proposed_diff;
    }
  }
  trigger_project_state_disk_flush();
  populate_screenplay_cards_in_editor_view();
}

// WHAT: Updating text changes dynamically.
// WHY: Stores direct screenplay line corrections in our active state database.
function handle_card_text_modification_event(index_position_of_card, updated_text_content) {
  if (active_loaded_project_state_object) {
    active_loaded_project_state_object.scriptSegments[index_position_of_card].text = updated_text_content;
    trigger_project_state_disk_flush();
  }
}

// WHAT: Updating emotional staging tags.
// WHY: Captures specific performance corrections entered manually by the user.
function handle_card_direction_modification_event(index_position_of_card, updated_direction_text) {
  if (active_loaded_project_state_object) {
    active_loaded_project_state_object.scriptSegments[index_position_of_card].direction = updated_direction_text;
    trigger_project_state_disk_flush();
  }
}

// WHAT: Handles inline Qwen performance parameters modification events.
// WHY: Captures edits on individual "Mad Libs" fields directly, updates the script segment's 
//      qwen_style configuration, keeps classic properties backward-compatible, and saves changes to disk.
function handle_card_qwen_style_modification_event(index_position_of_screenplay_card, target_qwen_style_property_key, updated_input_field_value_string) {
  if (active_loaded_project_state_object) {
    const active_script_segment_item = active_loaded_project_state_object.scriptSegments[index_position_of_screenplay_card];
    
    // WHAT: Creating the Qwen style data object if it doesn't already exist.
    // WHY: Lazy initialization ensures we don't have undefined reference crashes.
    if (!active_script_segment_item.qwen_style) {
      const character_mapping_details_for_active_speaker = (active_loaded_project_state_object.voiceMapping && active_loaded_project_state_object.voiceMapping[active_script_segment_item.speaker]) || {};
      
      active_script_segment_item.qwen_style = {
        age_range: character_mapping_details_for_active_speaker.age || "Adult",
        gender: character_mapping_details_for_active_speaker.gender || "Unknown",
        pitch: "medium",
        vocal_texture: character_mapping_details_for_active_speaker.traits || "smooth and authoritative",
        pacing: "normal",
        cadence: "steady cadence",
        acting_persona: "natural narrator",
        vocal_technique: "steady rhythm",
        rich_emotion: active_script_segment_item.direction || "calm delivery"
      };
    }
    
    // WHAT: Storing the edited attribute string under the correct configuration key.
    // WHY: Binds the user's modifications directly to the segment's dedicated styling model.
    active_script_segment_item.qwen_style[target_qwen_style_property_key] = updated_input_field_value_string;
    
    // WHAT: Keeping legacy attributes compatible if the emotion property is updated.
    // WHY: Ensures any secondary pipeline steps relying on `.direction` continue to execute flawlessly.
    if (target_qwen_style_property_key === "rich_emotion") {
      active_script_segment_item.direction = updated_input_field_value_string;
    }
    
    // WHAT: Flushing changes to project_state.json immediately.
    // WHY: Avoids data loss if the app windows are closed or reloaded.
    trigger_project_state_disk_flush();
  }
}



// WHAT: Serializes state changes and flushes JSON database to workspace.
// WHY: Ensures zero data loss when character allocations or text cues are modified.
async function trigger_project_state_disk_flush() {
  const current_workspace_path = typeof active_selected_workspace_directory_path !== "undefined" && active_selected_workspace_directory_path
    ? active_selected_workspace_directory_path
    : (typeof window !== "undefined" ? window.active_selected_workspace_directory_path : null);
  const current_project_state = typeof active_loaded_project_state_object !== "undefined" && active_loaded_project_state_object
    ? active_loaded_project_state_object
    : (typeof window !== "undefined" ? window.active_loaded_project_state_object : null);

  if (current_workspace_path && current_project_state && typeof window !== "undefined" && window.audiobook_api && window.audiobook_api.save_audiobook_project_state) {
    try {
      await window.audiobook_api.save_audiobook_project_state(
        current_workspace_path,
        current_project_state.projectName,
        current_project_state
      );
    } catch (save_exception) {
      console.error("Failed to persist project state to disk.", save_exception);
    }
  }
}

// =========================================================================
// PIPELINE WORKER - PASS 2 & 3 DISPATCHERS
// =========================================================================

// WHAT: Fast regex-based parser that bypasses the LLM to split technical books into narrator sentences.
// WHY: For single-narrator tech books, the LLM dialogue parsing pass is unnecessary and prone to failure on highly technical text.
async function run_tech_book_sentence_split() {
  if (!active_loaded_project_state_object || !active_selected_workspace_directory_path) {
    return;
  }

  // WHAT: Grabbing raw text and removing soft line-breaks (orphan newlines) from copy-pastes.
  // WHY: Fixes formatting issues where newlines break sentences mid-thought. We preserve double newlines as actual paragraph breaks.
  const raw_book_text_input = document.getElementById("raw_source_book_textarea_editor").value.trim()
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/(?<!\n)\n(?!\n)/g, ' ')
    .replace(/  +/g, ' ');
  if (!raw_book_text_input) {
    alert("The source text area is empty.");
    return;
  }

  // WHAT: Prompting the user to confirm overwriting the script.
  const user_explicit_confirmation_flag = confirm("Are you sure you want to run Tech Book Split? This will overwrite your existing screenplay segments with Narrator-only lines.");
  if (!user_explicit_confirmation_flag) {
    return;
  }

  if (!active_loaded_project_state_object.voiceMapping) {
    active_loaded_project_state_object.voiceMapping = {};
  }
  active_loaded_project_state_object.voiceMapping["Narrator"] = {
    workflowType: "design",
    designPrompt: "A professional male narrator with a deep, resonant, informative, and technical voice.",
    timbre_category_profile_string: "Default Resonant Narrator - Male",
    identity_background: "The disembodied voice of the book.",
    physical_appearance: "N/A",
    personality_traits: "Informative, technical, and objective.",
    seed: 12345
  };

  // WHAT: Splitting the text by punctuation followed by a space, attempting to match standard sentence boundaries.
  // WHY: A lookbehind for .?! (and optional quotes) followed by spaces prevents splitting inside decimal numbers or URLs.
  const regex_sentence_boundary_pattern = /(?<=[.?!]["']?)\s+(?=[A-Z0-9"'])/g;
  
  // WHAT: Hard split by paragraphs first to respect layout breaks.
  const raw_paragraphs_list = raw_book_text_input.split(/\n+/);
  const newly_generated_script_segments_list = [];

  for (let paragraph_index_counter = 0; paragraph_index_counter < raw_paragraphs_list.length; paragraph_index_counter++) {
    const paragraph_text_content = raw_paragraphs_list[paragraph_index_counter].trim();
    if (!paragraph_text_content) continue;

    const parsed_sentences_array = paragraph_text_content.split(regex_sentence_boundary_pattern);
    for (let sentence_index_counter = 0; sentence_index_counter < parsed_sentences_array.length; sentence_index_counter++) {
      const single_sentence_text = parsed_sentences_array[sentence_index_counter].trim();
      if (!single_sentence_text) continue;
      
      newly_generated_script_segments_list.push({
        index_position: newly_generated_script_segments_list.length,
        type: "narrator",
        speaker: "Narrator",
        text: single_sentence_text,
        direction: "informative and technical narrator, steady pace"
      });
    }
  }

  active_loaded_project_state_object.scriptSegments = newly_generated_script_segments_list;

  document.getElementById("screenplay_segment_cards_wrapper").innerHTML = "";
  populate_screenplay_cards_in_editor_view();
  trigger_project_state_disk_flush();
}

// =========================================================================
// REAL-TIME DIALOGUE ATTRIBUTION PROGRESS TRACKING STATE & UI
// =========================================================================

let active_attribution_status_state = {
  is_running: false,
  engine: "laya",
  is_unmarked: false,
  chunk_index: 0,
  total_chunks: 1,
  current_line: 0,
  total_lines: 0,
  current_paragraph: 0,
  total_paragraphs: 0,
  phase: "",
  snippet: "",
  speaker: "",
  emotion: "",
  energy: null,
  confidence: null
};

// WHAT: Receives real-time attribution progress events from main process IPC.
// WHY: Streams line-by-line attribution status, percentage, text snippets, and character assignments.
function handle_incoming_attribution_progress_update(payload) {
  if (!payload) return;

  if (typeof payload.current_line === "number") active_attribution_status_state.current_line = payload.current_line;
  if (typeof payload.total_lines === "number" && payload.total_lines > 0) active_attribution_status_state.total_lines = payload.total_lines;
  if (typeof payload.current_paragraph === "number") active_attribution_status_state.current_paragraph = payload.current_paragraph;
  if (typeof payload.total_paragraphs === "number" && payload.total_paragraphs > 0) active_attribution_status_state.total_paragraphs = payload.total_paragraphs;
  if (payload.phase) active_attribution_status_state.phase = payload.phase;
  if (payload.snippet) active_attribution_status_state.snippet = payload.snippet;
  if (payload.speaker) active_attribution_status_state.speaker = payload.speaker;
  if (payload.emotion) active_attribution_status_state.emotion = payload.emotion;
  if (typeof payload.energy === "number") active_attribution_status_state.energy = payload.energy;
  if (typeof payload.confidence === "number") active_attribution_status_state.confidence = payload.confidence;
  if (payload.engine) active_attribution_status_state.engine = payload.engine;

  render_or_update_attribution_progress_ui();
}

// WHAT: Renders or dynamically updates the attribution progress container with line counts, progress bar, and speaker tag.
// WHY: Gives the user immediate granular visibility into ongoing AI attribution passes (doing X of Y lines).
function render_or_update_attribution_progress_ui() {
  const screenplay_cards_wrapper_element = document.getElementById("screenplay_segment_cards_wrapper");
  if (!screenplay_cards_wrapper_element) return;

  const {
    engine,
    is_unmarked,
    chunk_index,
    total_chunks,
    current_line,
    total_lines,
    current_paragraph,
    total_paragraphs,
    phase,
    snippet,
    speaker,
    emotion,
    confidence
  } = active_attribution_status_state;

  // Compute progress percentage
  let progress_percent = 0;
  if (total_lines > 0) {
    const line_fraction = Math.min(1, current_line / total_lines);
    progress_percent = total_chunks > 1
      ? Math.round(((chunk_index + line_fraction) / total_chunks) * 100)
      : Math.round(line_fraction * 100);
  } else if (total_paragraphs > 0) {
    const para_fraction = Math.min(1, current_paragraph / total_paragraphs);
    progress_percent = total_chunks > 1
      ? Math.round(((chunk_index + para_fraction) / total_chunks) * 100)
      : Math.round(para_fraction * 100);
  } else {
    progress_percent = Math.round(((chunk_index + 0.5) / Math.max(1, total_chunks)) * 100);
  }
  progress_percent = Math.max(0, Math.min(100, progress_percent));

  // Determine Engine Badge Title
  let engine_badge_title = is_unmarked ? "📖 2-Stage Unmarked Attribution" : "⚡ Laya Fast Attribution";
  if (engine === "clm") {
    engine_badge_title = is_unmarked ? "📖 2-Stage Unmarked Attribution (CLM-8B)" : "🎯 CLM-8B System One Attribution";
  } else if (engine === "cascade" || engine === "clm_cascade") {
    engine_badge_title = is_unmarked ? "📖 2-Stage Unmarked Attribution (Cascade)" : "⚡🎯 Smart Cascade (Laya → CLM)";
  } else if (engine === "llm" || engine === "hybrid" || engine === "llm_qc") {
    engine_badge_title = "🧠 LLM Dialogue Attribution";
  } else if (engine === "joint_llm") {
    engine_badge_title = "📖 Joint LLM Unmarked Attribution";
  }

  // Format Line / Progress Counter Text
  let counter_label = "";
  if (total_lines > 0) {
    counter_label = `Doing line ${current_line} of ${total_lines} (${progress_percent}%)`;
  } else if (total_paragraphs > 0) {
    counter_label = `Paragraph ${current_paragraph} of ${total_paragraphs} (${progress_percent}%)`;
  } else {
    counter_label = `Pass ${chunk_index + 1} of ${total_chunks} (${progress_percent}%)`;
  }

  // Format Chunk / Details label
  let details_label = `Chunk ${chunk_index + 1}/${total_chunks}`;
  if (total_paragraphs > 0) {
    details_label += ` • Para ${current_paragraph || 1}/${total_paragraphs}`;
  }

  // Update Automate Attribution Button
  const automate_btn = document.getElementById("btn_automate_attribution");
  if (automate_btn && active_attribution_status_state.is_running) {
    automate_btn.disabled = true;
    if (total_lines > 0) {
      automate_btn.innerHTML = `<span class="status_dot state_processing d-inline-block mr-4"></span> Line ${current_line}/${total_lines}`;
    } else if (total_paragraphs > 0) {
      automate_btn.innerHTML = `<span class="status_dot state_processing d-inline-block mr-4"></span> Para ${current_paragraph}/${total_paragraphs}`;
    } else {
      automate_btn.innerHTML = `<span class="status_dot state_processing d-inline-block mr-4"></span> Attributing...`;
    }
  }

  // If progress container already exists in DOM, update properties directly for silky-smooth 60fps rendering
  const existing_box = document.getElementById("attribution_progress_box");
  if (existing_box) {
    const title_el = document.getElementById("attribution_progress_title");
    if (title_el) title_el.textContent = `${engine_badge_title} (Pass ${chunk_index + 1}/${total_chunks})...`;

    const phase_el = document.getElementById("attribution_progress_phase");
    if (phase_el && phase) phase_el.textContent = phase;

    const counter_el = document.getElementById("attribution_progress_counter");
    if (counter_el) counter_el.textContent = counter_label;

    const chunk_info_el = document.getElementById("attribution_progress_chunk_info");
    if (chunk_info_el) chunk_info_el.textContent = details_label;

    const fill_el = document.getElementById("attribution_progress_bar_fill");
    if (fill_el) fill_el.style.width = `${progress_percent}%`;

    const snippet_el = document.getElementById("attribution_progress_snippet");
    if (snippet_el) {
      snippet_el.textContent = snippet ? `“${snippet.replace(/^"|"$/g, '')}”` : "Analyzing dialogue line...";
    }

    const result_el = document.getElementById("attribution_progress_result");
    if (result_el) {
      if (speaker) {
        result_el.style.display = "flex";
        result_el.innerHTML = `
          <span class="badge radius-4 p-2-6" style="background: rgba(157, 78, 221, 0.25); color: #e9d5ff; border: 1px solid rgba(157, 78, 221, 0.5);">Speaker: ${speaker}</span>
          <span style="color: #9ca3af;">${emotion ? emotion + " • " : ""}${typeof confidence === "number" ? Math.round(confidence * 100) + "% conf" : ""}</span>
        `;
      } else {
        result_el.style.display = "none";
      }
    }
    return;
  }

  // Otherwise, render initial progress container
  screenplay_cards_wrapper_element.innerHTML = `
    <div class="empty_state_screen vh-50 d-flex flex-column align-items-center justify-content-center p-20">
      <div class="status_dot state_processing w-40px h-40px mb-15"></div>
      <h4 class="empty_state_title mb-8" id="attribution_progress_title">${engine_badge_title} (Pass ${chunk_index + 1}/${total_chunks})...</h4>
      <p class="empty_state_tagline mb-15" id="attribution_progress_phase" style="color: #d1d5db;">${phase || "Executing dialogue attribution and staging passes. Please stand by..."}</p>
      
      <div id="attribution_progress_box" class="w-100 max-w-500px p-16 radius-8" style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1);">
        <div class="d-flex justify-content-between align-items-center mb-8 text-12">
          <span class="font-weight-bold" id="attribution_progress_counter" style="color: #c084fc;">${counter_label}</span>
          <span class="text-11" id="attribution_progress_chunk_info" style="color: #9ca3af;">${details_label}</span>
        </div>
        
        <div class="progress_track_bar_bg w-100 h-8px radius-4 overflow-hidden mb-12" style="background: rgba(255, 255, 255, 0.08);">
          <div id="attribution_progress_bar_fill" class="progress_track_bar_fill h-100" style="width: ${progress_percent}%; background: linear-gradient(90deg, #9d4edd, #00f0ff); box-shadow: 0 0 10px rgba(0, 240, 255, 0.4); transition: width 0.2s ease;"></div>
        </div>
        
        <div class="d-flex flex-column gap-6 text-11">
          <div id="attribution_progress_snippet" class="font-italic text-truncate" style="color: #e5e7eb; max-width: 460px;">
            ${snippet ? `“${snippet.replace(/^"|"$/g, '')}”` : "Scanning manuscript paragraphs..."}
          </div>
          <div id="attribution_progress_result" class="align-items-center gap-8 text-10" style="display: ${speaker ? "flex" : "none"};">
            <span class="badge radius-4 p-2-6" style="background: rgba(157, 78, 221, 0.25); color: #e9d5ff; border: 1px solid rgba(157, 78, 221, 0.5);">Speaker: ${speaker}</span>
            <span style="color: #9ca3af;">${emotion ? emotion + " • " : ""}${typeof confidence === "number" ? Math.round(confidence * 100) + "% conf" : ""}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// =========================================================================

// WHAT: Automatically divides prose blocks into speaker segments and generates staging guides.
// WHY: Pass 2 and 3 convert unstructured txt paragraphs into dialogue screenplay records.
async function run_main_pipeline_pass_one_and_two() {
  if (!active_loaded_project_state_object && typeof window !== "undefined" && window.active_loaded_project_state_object) {
    active_loaded_project_state_object = window.active_loaded_project_state_object;
  }
  if (!active_selected_workspace_directory_path && typeof window !== "undefined" && window.active_selected_workspace_directory_path) {
    active_selected_workspace_directory_path = window.active_selected_workspace_directory_path;
  }
  if (!active_loaded_project_state_object || !active_selected_workspace_directory_path) {
    return;
  }

  // WHAT: Non-destructive dialogue attribution baseline.
  // WHY: Dialogue attribution preserves existing screenplay segments as reference ground truth,
  //      protecting user-locked lines and generating reviewable diffs for AI-modified lines.
  const existing_script_segments_list = (active_loaded_project_state_object && Array.isArray(active_loaded_project_state_object.scriptSegments))
    ? active_loaded_project_state_object.scriptSegments
    : [];

  // WHAT: Grabbing raw text and removing soft line-breaks (orphan newlines) from copy-pastes.
  // WHY: Fixes formatting issues where newlines break sentences mid-thought, which confuses the LLM parser.
  const raw_book_text_input = document.getElementById("raw_source_book_textarea_editor").value.trim()
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/(?<!\n)\n(?!\n)/g, ' ')
    .replace(/  +/g, ' ');
  if (!raw_book_text_input) {
    alert("The source text area is empty.");
    return;
  }

  // WHAT: Pre-flight check to ensure characters exist before running attribution.
  // WHY: Dialogue attribution depends entirely on pre-existing character definitions.
  //      If none exist, we automatically run the multi-pass cast discovery first.
  const existing_character_keys_for_pass_two = Object.keys(active_loaded_project_state_object.voiceMapping || {}).filter(character_identifier_key => character_identifier_key !== "Narrator");
  if (existing_character_keys_for_pass_two.length === 0) {
    if (typeof run_cast_discovery_pass_one === "function") {
      await run_cast_discovery_pass_one();
    }
  }

  const target_chunk_size = 7000;
  const total_attribution_chunks = Math.ceil(raw_book_text_input.length / target_chunk_size);
  const screenplay_cards_wrapper_element = document.getElementById("screenplay_segment_cards_wrapper");

  let list_of_new_segments = [];
  const discovered_characters_matrix = active_loaded_project_state_object.voiceMapping || {};

  const selected_attribution_engine = document.getElementById("attribution_engine_selector")?.value || (typeof configuration_attribution_engine !== "undefined" ? configuration_attribution_engine : "laya");
  const is_unmarked_dialogue = document.getElementById("unmarked_dialogue_toggle")?.checked || (typeof configuration_unmarked_dialogue !== "undefined" ? configuration_unmarked_dialogue : false);

  const automate_btn = document.getElementById("btn_automate_attribution");
  let original_btn_html = "";
  if (automate_btn) {
    original_btn_html = automate_btn.innerHTML;
    automate_btn.disabled = true;
    automate_btn.innerHTML = `<span class="status_dot state_processing d-inline-block mr-4"></span> Initializing...`;
  }

  active_attribution_status_state = {
    is_running: true,
    engine: selected_attribution_engine,
    is_unmarked: is_unmarked_dialogue,
    chunk_index: 0,
    total_chunks: total_attribution_chunks,
    current_line: 0,
    total_lines: 0,
    current_paragraph: 0,
    total_paragraphs: 0,
    phase: is_unmarked_dialogue ? "Detecting dialogue spans..." : "Scanning quotation lines...",
    snippet: "",
    speaker: "",
    emotion: "",
    energy: null,
    confidence: null
  };
  render_or_update_attribution_progress_ui();

  try {
    // WHAT: Iterating through the text in blocks.
    // WHY: Bypasses LLM context window limits.
    for (let current_chunk_index = 0; current_chunk_index < total_attribution_chunks; current_chunk_index++) {
      const chunk_start_index = current_chunk_index * target_chunk_size;
      const sample_text_window_block = raw_book_text_input.substring(chunk_start_index, chunk_start_index + target_chunk_size);

      active_attribution_status_state.chunk_index = current_chunk_index;
      active_attribution_status_state.phase = `Processing Chunk ${current_chunk_index + 1} of ${total_attribution_chunks}...`;
      render_or_update_attribution_progress_ui();

      let parsing_response_json = null;

      if (["laya", "clm", "cascade", "hybrid"].includes(selected_attribution_engine)) {
        try {
          parsing_response_json = await window.audiobook_api.trigger_laya_attribution({
            book_text_segment: sample_text_window_block,
            voice_mapping_context: active_loaded_project_state_object.voiceMapping || {},
            existing_script_segments: existing_script_segments_list,
            laya_endpoint_url: configuration_laya_api_url_address,
            clm_endpoint_url: (typeof configuration_clm_api_url_address !== "undefined") ? configuration_clm_api_url_address : "http://127.0.0.1:8700",
            attribution_engine: selected_attribution_engine,
            confidence_threshold: 0.55,
            unmarked_dialogue_mode: is_unmarked_dialogue,
            lm_studio_api_url_address: configuration_lm_studio_api_url_address
          });

          // In hybrid mode, if Laya was offline (returned fallback_reason), seamlessly fall back to llama.cpp
          if (selected_attribution_engine === "hybrid" && parsing_response_json && parsing_response_json.fallback_reason) {
            console.warn("Hybrid Mode: Laya offline or fallback triggered, routing to llama.cpp.", parsing_response_json.fallback_reason);
            active_attribution_status_state.engine = "hybrid";
            active_attribution_status_state.phase = "Hybrid Fallback: Querying local LLM engine...";
            render_or_update_attribution_progress_ui();

            parsing_response_json = await window.audiobook_api.trigger_dialogue_attribution(
              sample_text_window_block,
              configuration_lm_studio_api_url_address
            );
          }
        } catch (laya_err) {
          console.warn("Laya invocation error:", laya_err);
          if (selected_attribution_engine === "hybrid") {
            active_attribution_status_state.engine = "hybrid";
            active_attribution_status_state.phase = "Hybrid Fallback: Querying local LLM engine...";
            render_or_update_attribution_progress_ui();

            parsing_response_json = await window.audiobook_api.trigger_dialogue_attribution(
              sample_text_window_block,
              configuration_lm_studio_api_url_address
            );
          } else {
            throw laya_err;
          }
        }
      } else {
        // LLM Mode
        active_attribution_status_state.engine = "llm";
        active_attribution_status_state.phase = "Querying local LLM engine...";
        render_or_update_attribution_progress_ui();

        parsing_response_json = await window.audiobook_api.trigger_dialogue_attribution(
          sample_text_window_block,
          configuration_lm_studio_api_url_address
        );
      }

      if (parsing_response_json && parsing_response_json.script_segments) {
        for (let segment_counter = 0; segment_counter < parsing_response_json.script_segments.length; segment_counter++) {
          const parsed_item = parsing_response_json.script_segments[segment_counter];
          let resolved_speaker_name = parsed_item.speaker || "Narrator";

          // WHAT: Resolving short names (e.g. "Miranda") to their full names (e.g. "Miranda Stewart") if they already exist in the matrix.
          // WHY: Pass 1 Cast Discovery creates full names, but Pass 2 Dialogue Attribution often returns just first names, leading to duplicates.
          if (resolved_speaker_name !== "Narrator" && resolved_speaker_name !== "Unknown") {
            const existing_cast_keys = Object.keys(discovered_characters_matrix);
            for (let existing_cast_key_index = 0; existing_cast_key_index < existing_cast_keys.length; existing_cast_key_index++) {
              const existing_name = existing_cast_keys[existing_cast_key_index];
              
              // Ignore common titles to prevent false positive matches (e.g. "The Doctor" matching "The Deliveryman")
              const ignored_words = ["the", "a", "an", "mr", "mrs", "ms", "miss", "dr", "sir", "madam", "uncle", "aunt"];
              const existing_words = existing_name.toLowerCase().split(/[\s-]+/).filter(single_word_token => !ignored_words.includes(single_word_token));
              const resolved_words = resolved_speaker_name.toLowerCase().split(/[\s-]+/).filter(single_word_token => !ignored_words.includes(single_word_token));
              
              const has_word_match = existing_words.some(word => resolved_words.includes(word));
              
              if (has_word_match) {
                resolved_speaker_name = existing_name;
                break;
              }
            }
          }

          // WHAT: Non-destructive correlation with prior screenplay segment.
          // WHY: Preserves user-locked ground truth, maintains audio take histories, and generates reviewable diffs.
          const matched_existing_segment = existing_script_segments_list.find((candidate_segment) => {
            if (candidate_segment.id && parsed_item.id && candidate_segment.id === parsed_item.id) {
              return true;
            }
            if (candidate_segment.text && parsed_item.text) {
              return candidate_segment.text.trim() === parsed_item.text.trim();
            }
            return false;
          }) || existing_script_segments_list[list_of_new_segments.length];

          let segment_proposed_diff = parsed_item.proposed_diff || null;
          let final_assigned_speaker = resolved_speaker_name;
          const is_segment_locked = !!(parsed_item.is_user_locked || (matched_existing_segment && matched_existing_segment.is_user_locked));

          if (is_segment_locked && matched_existing_segment && matched_existing_segment.speaker) {
            // User-locked lines are protected ground truth and cannot be overwritten
            final_assigned_speaker = matched_existing_segment.speaker;
            segment_proposed_diff = null;
          } else if (
            matched_existing_segment &&
            matched_existing_segment.speaker &&
            matched_existing_segment.speaker !== "Unknown" &&
            matched_existing_segment.speaker !== resolved_speaker_name
          ) {
            // Classifier proposes a different speaker from existing baseline: generate reviewable diff
            segment_proposed_diff = {
              previous_speaker: matched_existing_segment.speaker,
              proposed_speaker: resolved_speaker_name,
              confidence: typeof parsed_item.confidence === "number" ? parsed_item.confidence : 0.85,
              engine: parsed_item.engine || selected_attribution_engine
            };
            final_assigned_speaker = matched_existing_segment.speaker;
          }
          
          // WHAT: Building structural segment descriptors with engine performance metadata and audio version preservation.
          // WHY: Attaches indexes, confidence, emotions, and keeps existing audio take history safely intact.
          const segment_descriptor = {
            index_position: list_of_new_segments.length,
            type: (final_assigned_speaker === "Narrator") ? "narrator" : (parsed_item.type || "dialogue"),
            speaker: final_assigned_speaker,
            text: parsed_item.text,
            direction: parsed_item.direction || (matched_existing_segment && matched_existing_segment.direction) || "calm delivery",
            confidence: is_segment_locked ? 1.0 : (typeof parsed_item.confidence === "number" ? parsed_item.confidence : null),
            emotion: parsed_item.emotion || (matched_existing_segment && matched_existing_segment.emotion) || null,
            energy: typeof parsed_item.energy === "number" ? parsed_item.energy : (matched_existing_segment && matched_existing_segment.energy) || null,
            is_ambiguous: is_segment_locked ? false : (!!parsed_item.is_ambiguous || !!segment_proposed_diff),
            unmarked: !!parsed_item.unmarked,
            engine: parsed_item.engine || (selected_attribution_engine === "llm" ? "llm" : (selected_attribution_engine === "clm" ? "clm" : "laya")),
            audioPath: matched_existing_segment ? (matched_existing_segment.audioPath || null) : null,
            audioVersions: (matched_existing_segment && Array.isArray(matched_existing_segment.audioVersions)) ? matched_existing_segment.audioVersions : [],
            workflowOverride: matched_existing_segment ? (matched_existing_segment.workflowOverride || null) : null,
            qwen_style: matched_existing_segment ? (matched_existing_segment.qwen_style || null) : null,
            is_user_locked: is_segment_locked,
            proposed_diff: segment_proposed_diff
          };

          list_of_new_segments.push(segment_descriptor);

          // WHAT: Assigning unrecognized speakers to the Unknown fallback profile.
          // WHY: We no longer implicitly create blank character profiles during script attribution.
          //      If the character is missing from the global voice matrix, they default to Unknown.
          if (segment_descriptor.speaker && segment_descriptor.speaker !== "Narrator") {
            if (!discovered_characters_matrix[segment_descriptor.speaker]) {
              segment_descriptor.speaker = "Unknown";
            }
          }
        }
      }
    } // End chunk loop

  // WHAT: Binding results back to active states.
  // WHY: Keeps UI synced and updates persistent databases on disk.
  active_loaded_project_state_object.scriptSegments = list_of_new_segments;
  active_loaded_project_state_object.voiceMapping = discovered_characters_matrix;

  // WHAT: Pass 2.5 Relationship State Engine pass.
  // WHY: Carries relationship state forward across the attributed segments, detecting any dynamic shifts.
  if (window.audiobook_api && typeof window.audiobook_api.run_relationship_delta_pass === "function") {
    try {
      const active_cast_members = Object.keys(discovered_characters_matrix)
        .filter((character_name) => character_name !== "Narrator")
        .map((character_name) => ({ id: character_name, name: character_name }));

      if (active_cast_members.length >= 2) {
        const delta_response = await window.audiobook_api.run_relationship_delta_pass(
          list_of_new_segments,
          active_loaded_project_state_object.relationships || [],
          active_cast_members,
          configuration_lm_studio_api_url_address
        );

        if (delta_response && Array.isArray(delta_response.updated_relationships)) {
          active_loaded_project_state_object.relationships = delta_response.updated_relationships;
        }
      }
    } catch (delta_error) {
      console.warn("Pass 2.5 Relationship Delta pass non-fatal warning:", delta_error.message);
    }
  }

  // WHAT: Pass 2.6 Directorial Staging and Speech Tag Harvester pass.
  // WHY: Brings directorial intelligence directly into the Screenplay Script Editor, extracting
  //      acoustic descriptors (e.g. "her voice was flat, clipped by the environmental seal of her collar")
  //      and synthesizing [Voice Quality], [Prosody], [Style], and [Emotion] onto screenplay cards.
  if (window.audiobook_api && typeof window.audiobook_api.enrich_directorial_staging === "function") {
    try {
      active_attribution_status_state.phase = "Directorial Staging: Extracting prosody, style, and vocal cues...";
      render_or_update_attribution_progress_ui();

      const enriched_segments = await window.audiobook_api.enrich_directorial_staging(
        list_of_new_segments,
        discovered_characters_matrix,
        active_loaded_project_state_object.relationships || []
      );

      if (Array.isArray(enriched_segments) && enriched_segments.length > 0) {
        list_of_new_segments = enriched_segments;
        active_loaded_project_state_object.scriptSegments = list_of_new_segments;
      }
    } catch (staging_error) {
      console.warn("Pass 2.6 Directorial Staging non-fatal warning:", staging_error.message);
    }
  } else if (typeof enrich_script_segments_with_directorial_staging === "function" || (typeof window !== "undefined" && typeof window.enrich_script_segments_with_directorial_staging === "function")) {
    try {
      active_attribution_status_state.phase = "Directorial Staging: Extracting prosody, style, and vocal cues...";
      render_or_update_attribution_progress_ui();

      const staging_fn = typeof enrich_script_segments_with_directorial_staging === "function"
        ? enrich_script_segments_with_directorial_staging
        : window.enrich_script_segments_with_directorial_staging;

      const enriched_segments = staging_fn(
        list_of_new_segments,
        discovered_characters_matrix,
        active_loaded_project_state_object.relationships || []
      );

      if (Array.isArray(enriched_segments) && enriched_segments.length > 0) {
        list_of_new_segments = enriched_segments;
        active_loaded_project_state_object.scriptSegments = list_of_new_segments;
      }
    } catch (direct_staging_err) {
      console.warn("Directorial Staging direct fallback error:", direct_staging_err.message);
    }
  }

  if (typeof window !== "undefined") {
    window.active_loaded_project_state_object = active_loaded_project_state_object;
  }

  await trigger_project_state_disk_flush();

  // WHAT: Refreshing dependent UI panels.
  // WHY: Cards list and Casting blocks are rebuilt from updated structures.
  populate_screenplay_cards_in_editor_view();
  populate_voice_matrix_configuration_cards();
  refresh_synthesis_progress_tracking_meters();
  } catch (pipeline_execution_error) {
    console.error("Master parsing pipeline failed.", pipeline_execution_error);
    alert(`Dialogue attribution pipeline failed: ${pipeline_execution_error.message}`);
    populate_screenplay_cards_in_editor_view();
  } finally {
    active_attribution_status_state.is_running = false;
    const automate_btn = document.getElementById("btn_automate_attribution");
    if (automate_btn) {
      automate_btn.disabled = false;
      if (original_btn_html) {
        automate_btn.innerHTML = original_btn_html;
      }
    }
  }
}

// WHAT: Cleans up messy PDF line breaks while preserving actual paragraph breaks.
// WHY: Some raw text sources contain hard line breaks mid-sentence. This function removes single CRLF/LF characters, 
//      replacing them with spaces, but preserves double CRLF/LF characters as paragraph breaks.
function trigger_raw_text_cleanup() {
  const raw_source_textarea_element = document.getElementById("raw_source_book_textarea_editor");
  if (!raw_source_textarea_element) return;
  
  let raw_text_content_string = raw_source_textarea_element.value;
  
  // Standardize all newlines to \n to simplify regex
  raw_text_content_string = raw_text_content_string.replace(/\r\n/g, '\n');
  raw_text_content_string = raw_text_content_string.replace(/\r/g, '\n');
  
  // Replace double newlines with a temporary unique token
  raw_text_content_string = raw_text_content_string.replace(/\n\n+/g, '___DOUBLE_NEWLINE_TOKEN___');
  
  // Replace remaining single newlines with a space
  raw_text_content_string = raw_text_content_string.replace(/\n/g, ' ');
  
  // Restore double newlines
  raw_text_content_string = raw_text_content_string.replace(/___DOUBLE_NEWLINE_TOKEN___/g, '\n\n');
  
  raw_source_textarea_element.value = raw_text_content_string;
  
  // Assuming there is a save trigger. We can call trigger_raw_text_reparse() to save and update the right panes.
  trigger_raw_text_reparse();
}

// WHAT: Explicitly reading the book text and triggering the NLP segmentation pipeline.
// WHY: When the user manually edits or cleans the raw book manuscript in the left panel,
//      we immediately synchronize the active project state and trigger both NLP attribution passes
//      so all screenplay and directorial cards reflect the fresh manuscript content.
async function trigger_raw_text_reparse() {
  if (active_loaded_project_state_object) {
    const raw_book_text_input = document.getElementById("raw_source_book_textarea_editor").value;
    active_loaded_project_state_object.rawBookText = raw_book_text_input;
    await trigger_project_state_disk_flush();
    run_main_pipeline_pass_one_and_two();
  }
}

// WHAT: Saving modified project metadata properties, specifically the book author and extra notes.
// WHY: We want to capture changes to the author or project notes whenever the user types in the left panel.
//      By updating the active state object and flushing it to disk, these details won't be lost.
//      Think of this as an auto-save feature specifically for the book's descriptive attributes.
async function trigger_project_about_details_save() {
  if (active_loaded_project_state_object) {
    const newly_entered_book_author_string = document.getElementById("project_author_input_editor").value;
    const newly_entered_book_notes_string = document.getElementById("project_notes_textarea_editor").value;
    
    active_loaded_project_state_object.author = newly_entered_book_author_string;
    active_loaded_project_state_object.notes = newly_entered_book_notes_string;
    
    await trigger_project_state_disk_flush();
  }
}

// =========================================================================
// SYNTHESIS PIPELINE CONTROL - PASS 4 QUEUE
// =========================================================================

// WHAT: Enqueues single selected card row down the ComfyUI synthesis queue.
// WHY: Triggers targeted audio creation for individual line corrections.
async function trigger_single_line_speech_synthesis(index_position_of_card) {
  if (!active_loaded_project_state_object || !active_selected_workspace_directory_path) {
    return;
  }

  const script_segment_data_reference = active_loaded_project_state_object.scriptSegments[index_position_of_card];
  const voice_configuration_mapping = active_loaded_project_state_object.voiceMapping || {};

  // WHAT: Ensuring the assigned character has been locked in before allowing synthesis.
  // WHY: The user explicitly requested that all voices used on the script editor page MUST be locked in.
  const assigned_character_profile = voice_configuration_mapping[script_segment_data_reference.speaker] || {};
  const is_cell_overridden_to_design = script_segment_data_reference.workflowOverride && script_segment_data_reference.workflowOverride.workflowType === "design";
  
  if (!assigned_character_profile.savedVoiceFilename && !is_cell_overridden_to_design) {
    alert(`Synthesis Blocked: Character "${script_segment_data_reference.speaker}" has not been locked in.\n\nPlease go to the Characters tab, generate a test phrase, and click "⭐ Lock in character" before synthesizing script lines.`);
    return;
  }

  // WHAT: Ensuring the audioVersions list history array is initialized.
  // WHY: Needed to compute next take counts sequentially.
  if (!script_segment_data_reference.audioVersions) {
    script_segment_data_reference.audioVersions = [];
  }
  const next_take_number = script_segment_data_reference.audioVersions.length + 1;

  // WHAT: We previously randomized the seed here, but now we respect the user's explicit Voice Matrix seed.
  // WHY: Users want consistent character voices across regenerations rather than random variations.
  
  // WHAT: Registering this card's status in the queue registry BEFORE the DOM rebuild.
  // WHY: populate_screenplay_cards_in_editor_view() destroys all DOM elements and recreates them.
  //      By writing to the registry first, the rebuild will pick up the queued status instead
  //      of resetting this card to idle. This also preserves statuses of OTHER cards that
  //      were already queued from previous clicks.
  renderer_card_queue_status_registry[index_position_of_card] = {
    status: "processing",
    message: "Queueing..."
  };

  // WHAT: Flashing the updated project state to the disk file system.
  // WHY: Ensures the new seed override persists if the app restarts or reloads.
  await trigger_project_state_disk_flush();
  
  // WHAT: Refreshing screenplay card list display.
  // WHY: Renders the updated override stats and seed text values in the editor panel dynamically.
  //      The registry ensures previously queued cards retain their status through this rebuild.
  populate_screenplay_cards_in_editor_view();

  try {
    await window.audiobook_api.enqueue_speech_generation_task(
      active_selected_workspace_directory_path,
      active_loaded_project_state_object.projectName,
      script_segment_data_reference,
      voice_configuration_mapping,
      configuration_comfyui_api_url_address,
      next_take_number
    );
  } catch (queue_failure_exception) {
    console.error("Failed to enqueue line synthesis task.", queue_failure_exception);
    update_individual_card_synthesis_status_lights(index_position_of_card, "failed", "Failed to enqueue");
  }
}

// WHAT: Enqueues every line card consecutively to synthesize a full audiobook.
// WHY: Pass 4 orchestration compiles complete vocal sets in the background.
async function trigger_queue_synthesis_all_lines() {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments || active_loaded_project_state_object.scriptSegments.length === 0) {
    alert("There are no parsed script segments to synthesize.");
    return;
  }

  const script_segments_count = active_loaded_project_state_object.scriptSegments.length;
  const voice_configuration_mapping = active_loaded_project_state_object.voiceMapping || {};

  // WHAT: Pre-validating that ALL characters in the script have been locked in before starting the batch.
  // WHY: Prevents the queue from starting and then failing halfway through because a character was missed.
  const unlocked_characters_found = new Set();
  for (let segment_counter = 0; segment_counter < script_segments_count; segment_counter++) {
    const segment_item = active_loaded_project_state_object.scriptSegments[segment_counter];
    const character_profile = voice_configuration_mapping[segment_item.speaker] || {};
    const is_cell_overridden_to_design = segment_item.workflowOverride && segment_item.workflowOverride.workflowType === "design";
    
    if (!character_profile.savedVoiceFilename && !is_cell_overridden_to_design) {
      unlocked_characters_found.add(segment_item.speaker);
    }
  }

  if (unlocked_characters_found.size > 0) {
    const missing_names = Array.from(unlocked_characters_found).join(", ");
    alert(`Batch Synthesis Blocked: The following characters have not been locked in yet:\n\n${missing_names}\n\nPlease go to the Characters tab and lock in their voices before generating the full audiobook.`);
    return;
  }

  // WHAT: Force the backend queue to reset.
  // WHY: We are starting a fresh batch generation; any old pending tasks should be aborted.
  await window.audiobook_api.reset_stuck_queue();

  // WHAT: Clear out the active audioPath so the stitching progress panel starts at 0%.
  // WHY: We are generating new compiled takes. Old takes remain safe in audioVersions, but they are no longer active.
  for (let segment_counter = 0; segment_counter < script_segments_count; segment_counter++) {
    const segment_item = active_loaded_project_state_object.scriptSegments[segment_counter];
    segment_item.audioPath = null;
    if (segment_item.audioVersions) {
      for (let version_counter = 0; version_counter < segment_item.audioVersions.length; version_counter++) {
        segment_item.audioVersions[version_counter].isActive = false;
      }
    }
  }

  await trigger_project_state_disk_flush();
  populate_screenplay_cards_in_editor_view();
  
  // WHAT: Registering all segments in the queue registry BEFORE dispatching.
  // WHY: If the UI refreshes (e.g. when the first item starts), we don't want the rest of the
  //      items to revert to "idle". They must retain their "processing" visual state.
  for (let segment_counter = 0; segment_counter < script_segments_count; segment_counter++) {
    renderer_card_queue_status_registry[segment_counter] = {
      status: "processing",
      message: "Queueing..."
    };
    update_individual_card_synthesis_status_lights(segment_counter, "processing", "Queueing...");
  }
  
  // WHAT: Looping segments and sending to backend workers.
  // WHY: Sequential main process loop maintains stability.
  for (let segment_counter = 0; segment_counter < script_segments_count; segment_counter++) {
    const segment_item = active_loaded_project_state_object.scriptSegments[segment_counter];
    if (!segment_item.audioVersions) {
      segment_item.audioVersions = [];
    }
    const next_take_number = segment_item.audioVersions.length + 1;

    await window.audiobook_api.enqueue_speech_generation_task(
      active_selected_workspace_directory_path,
      active_loaded_project_state_object.projectName,
      segment_item,
      active_loaded_project_state_object.voiceMapping || {},
      configuration_comfyui_api_url_address,
      next_take_number
    );
  }

  // WHAT: Auto redirect to stitching panel.
  // WHY: Allows the user to view progress bars instantly.
  switch_active_navigation_tab("stitch");
}

// =========================================================================
// LAYOUT TOGGLES
// =========================================================================

let show_editor_col_1 = true;
let show_editor_col_2 = true;
let show_editor_col_3 = true;

// WHAT: Toggles the visibility of specific columns in the editor storyboard.
// WHY: Allows the user to focus on specific panes and expands remaining panes to fill the space.
function toggle_editor_column(column_index) {
  if (column_index === 1) show_editor_col_1 = !show_editor_col_1;
  if (column_index === 2) show_editor_col_2 = !show_editor_col_2;
  if (column_index === 3) show_editor_col_3 = !show_editor_col_3;

  const layout = document.getElementById("editor_main_layout_split");
  
  // Calculate grid template
  const visible_frs = [];
  if (show_editor_col_1) visible_frs.push("0.85fr");
  if (show_editor_col_2) visible_frs.push("1.05fr");
  if (show_editor_col_3) visible_frs.push("1.25fr");
  
  layout.style.gridTemplateColumns = visible_frs.length > 0 ? visible_frs.join(" ") : "1fr";

  // Hide/Show elements and update button styles
  const raw_column_toggle_button = document.getElementById("toggle_col_raw");
  const raw_column_pane = document.getElementById("editor_pane_raw");
  if (raw_column_toggle_button && raw_column_pane) {
    raw_column_pane.style.display = show_editor_col_1 ? "flex" : "none";
    raw_column_toggle_button.style.opacity = show_editor_col_1 ? "1" : "0.5";
  }

  const screenplay_column_toggle_button = document.getElementById("toggle_col_screenplay");
  const screenplay_column_pane = document.getElementById("editor_pane_screenplay");
  if (screenplay_column_toggle_button && screenplay_column_pane) {
    screenplay_column_pane.style.display = show_editor_col_2 ? "flex" : "none";
    screenplay_column_toggle_button.style.opacity = show_editor_col_2 ? "1" : "0.5";
  }

  const directorial_column_toggle_button = document.getElementById("toggle_col_directorial");
  const directorial_column_pane = document.getElementById("editor_pane_directorial");
  if (directorial_column_toggle_button && directorial_column_pane) {
    directorial_column_pane.style.display = show_editor_col_3 ? "flex" : "none";
    directorial_column_toggle_button.style.opacity = show_editor_col_3 ? "1" : "0.5";
  }
}

// =========================================================================
// SYNTHESIS STATE UPDATES & UTILITIES
// =========================================================================

// WHAT: Updating card status bulbs and operational links.
// WHY: Highlights completed synthesis runs in real-time.
function update_individual_card_synthesis_status_lights(index_position, status_string, custom_message_text) {
  const dot_light_element = document.getElementById(`synthesis_light_dot_${index_position}`);
  const status_label_element = document.getElementById(`synthesis_status_label_text_${index_position}`);
  const play_clip_button_element = document.getElementById(`btn_play_clip_element_${index_position}`);

  if (!dot_light_element || !status_label_element) {
    return;
  }

  dot_light_element.className = "status_dot";
  play_clip_button_element.style.display = "none";

  if (status_string === "completed") {
    dot_light_element.classList.add("state_completed");
    status_label_element.textContent = "Synthesized";
    status_label_element.style.color = "#4ade80";
    status_label_element.style.fontWeight = "600";
    play_clip_button_element.style.display = "flex";
  } else if (status_string === "processing") {
    dot_light_element.classList.add("state_processing");
    status_label_element.textContent = custom_message_text || "Synthesizing...";
    status_label_element.style.color = "var(--accent-cyber-gold)";
  } else if (status_string === "failed") {
    dot_light_element.classList.add("state_failed");
    status_label_element.textContent = custom_message_text || "Failed";
    status_label_element.style.color = "var(--accent-coral-red)";
  } else {
    status_label_element.textContent = "Idle";
    status_label_element.style.color = "#E0EFF1";
    status_label_element.style.fontWeight = "500";
  }
}

// WHAT: Receives real-time IPC synthesis completion update dispatches from main.js.
// WHY: Links visual status highlights to actual file creation completions automatically.
//      Also maintains the queue status registry so DOM rebuilds preserve correct states.
function handle_incoming_synthesis_progress_updates(progress_update_payload) {
  const { index_position, status, filePath, is_directorial, take_number, message } = progress_update_payload;
  
  // WHAT: Updating the queue status registry with the incoming status.
  // WHY: The registry is the authoritative source of truth for card statuses. When a card
  //      transitions to "processing", "completed", or "failed", we record it here so that
  //      any DOM rebuild (triggered by populate_*_cards) will show the correct status.
  if (is_directorial) {
    if (status === "completed" || status === "failed") {
      // WHAT: Clearing the registry entry on terminal states.
      // WHY: Once a card completes or fails, its status should be determined by audioPath
      //      on future rebuilds, not by a stale registry entry.
      delete renderer_directorial_card_queue_status_registry[index_position];
    } else {
      renderer_directorial_card_queue_status_registry[index_position] = {
        status: status,
        message: message
      };
    }
  } else {
    if (status === "completed" || status === "failed") {
      delete renderer_card_queue_status_registry[index_position];
    } else {
      renderer_card_queue_status_registry[index_position] = {
        status: status,
        message: message
      };
    }
  }

  // WHAT: Save file path info to runtime states.
  // WHY: Prevents reparsing paths. Keeps cache up to date.
  if (active_loaded_project_state_object) {
    if (is_directorial) {
      if (active_loaded_project_state_object.directorialSegments[index_position]) {
        if (status === "completed") {
          const targeted_segment = active_loaded_project_state_object.directorialSegments[index_position];
          targeted_segment.audioPath = filePath;

          // WHAT: Initialize the versions list array if it does not exist yet.
          // WHY: Prevents undefined errors when accessing properties.
          if (!targeted_segment.audioVersions) {
            targeted_segment.audioVersions = [];
          }

          // WHAT: Set all existing takes to inactive.
          // WHY: Ensures the newly synthesized take becomes the active, preferred performance.
          for (let version_counter = 0; version_counter < targeted_segment.audioVersions.length; version_counter++) {
            targeted_segment.audioVersions[version_counter].isActive = false;
          }

          // WHAT: Creating the new take item descriptor.
          // WHY: Incorporates the newly rendered take into our version control list.
          const new_take_item_descriptor = {
            take: take_number || (targeted_segment.audioVersions.length + 1),
            filePath: filePath,
            timestamp: Date.now(),
            isActive: true
          };
          targeted_segment.audioVersions.push(new_take_item_descriptor);

          trigger_project_state_disk_flush();
          populate_directorial_cards_in_editor_view();
        }
      }
      // WHAT: Updating status lights on the directorial cards panel.
      // WHY: Gives real-time visual feedback for Triple-Input synthesis tasks.
      update_individual_directorial_card_synthesis_status_lights(index_position, status, message);
    } else {
      if (active_loaded_project_state_object.scriptSegments[index_position]) {
        if (status === "completed") {
          const targeted_segment = active_loaded_project_state_object.scriptSegments[index_position];
          targeted_segment.audioPath = filePath;

          // WHAT: Initialize the versions list array if it does not exist yet.
          // WHY: Prevents undefined errors when accessing properties.
          if (!targeted_segment.audioVersions) {
            targeted_segment.audioVersions = [];
          }

          // WHAT: Set all existing takes to inactive.
          // WHY: Ensures the newly synthesized take becomes the active, preferred performance.
          for (let version_counter = 0; version_counter < targeted_segment.audioVersions.length; version_counter++) {
            targeted_segment.audioVersions[version_counter].isActive = false;
          }

          // WHAT: Creating the new take item descriptor.
          // WHY: Incorporates the newly rendered take into our version control list.
          const new_take_item_descriptor = {
            take: take_number || (targeted_segment.audioVersions.length + 1),
            filePath: filePath,
            timestamp: Date.now(),
            isActive: true
          };
          targeted_segment.audioVersions.push(new_take_item_descriptor);

          trigger_project_state_disk_flush();
          populate_screenplay_cards_in_editor_view();
        }
      }
      // WHAT: Updating status lights on active classic screenplay panels.
      // WHY: Real-time visual feedback for classic synthesis.
      update_individual_card_synthesis_status_lights(index_position, status, message);
    }
  }

  // WHAT: Recomputing global progress values in the Stitch tab.
  // WHY: Advances progress ratios and gauge levels in the production console.
  refresh_synthesis_progress_tracking_meters();
}

// WHAT: Escapes special regular expression characters in a string.
// WHY: Ensures characters like dots, brackets, and question marks are treated as literal characters rather than regex operators during text searching.
// STYLE: Here is a friendly tutorial on how this function works:
//        We receive a source string, and we need to locate its exact literal matches in a larger text body.
//        If the source string contains regular expression operators (like '.', '*', or '+'), the regex engine
//        would interpret them as wildcards or quantifiers. By escaping each of them with a backslash,
//        we convert them back into literal search constraints.
function escape_regex_characters_for_literal_match(source_string_to_escape) {
  // WHAT: Replacing special characters with escaped backslash alternatives.
  // WHY: We use a comprehensive character class containing all standard regular expression operators
  //      to safely prefix them with a backslash. This guarantees full stability on punctuation.
  return source_string_to_escape.replace(/[\-\/\\\^\$\*\+\?\.\(\)\|\[\]\{\}]/g, "\\$&");
}

// WHAT: Binding our regex escaping utility explicitly to the global window namespace.
// WHY: In complex Electron and renderer context loading stages, top-level scope definitions
//      can occasionally be delayed or isolated. By explicitly attaching this function to 'window',
//      we ensure it is instantly and universally accessible from any callback or nested execution block,
//      completely eliminating ReferenceErrors.
window.escape_regex_characters_for_literal_match = escape_regex_characters_for_literal_match;

// WHAT: Resolves the character indices of segments in a target list inside the raw book text, ignoring spacing differences.
// WHY: Generalizes spacing-resilient regex-based searching so we can map both classic screenplay lists and directorial intent lists to the raw manuscript.
function locate_generic_segment_ranges_in_raw_text(segments_array_list) {
  const raw_source_text_content = document.getElementById("raw_source_book_textarea_editor").value;
  
  let current_search_index_pointer = 0;
  const segment_character_ranges_array = [];

  // WHAT: Iterating through each segment chronologically.
  // WHY: Sequential lookup maps occurrences accurately inside the raw paragraph blocks.
  for (let segment_counter = 0; segment_counter < segments_array_list.length; segment_counter++) {
    const segment_item_data = segments_array_list[segment_counter];
    const segment_text_string = segment_item_data.text.trim();

    if (!segment_text_string) {
      segment_character_ranges_array.push({ start: -1, end: -1 });
      continue;
    }

    // WHAT: Escaping punctuation and converting spaces to regex wildcards.
    // WHY: Escaping isolates literal words, and replacing spacing blocks with \s+ allows
    //      matching the segment even if raw text contains spacing gaps like double-newlines (\n\n).
    //      We call this through the window object to guarantee absolute scope accessibility.
    const escaped_segment_text = window.escape_regex_characters_for_literal_match(segment_text_string);
    const whitespace_resilient_pattern = escaped_segment_text.replace(/\s+/g, "\\s+");
    
    // WHAT: Constructing dynamic regular expressions.
    // WHY: Native regex engine matches formatting-insensitive blocks at maximum performance speeds.
    const search_regex = new RegExp(whitespace_resilient_pattern);
    const search_haystack = raw_source_text_content.substring(current_search_index_pointer);
    
    const matched_regex_result = search_regex.exec(search_haystack);
    
    let absolute_start_index = -1;
    let absolute_end_index = -1;

    if (matched_regex_result) {
      // WHAT: Calculate index offsets relative to the search pointer.
      // WHY: Maps search results back to original absolute coordinates in the textarea.
      absolute_start_index = current_search_index_pointer + matched_regex_result.index;
      absolute_end_index = absolute_start_index + matched_regex_result[0].length;
      
      // Move search pointer forward.
      current_search_index_pointer = absolute_end_index;
    } else {
      // WHAT: Fallback global search starting from index 0.
      // WHY: Gracefully maps indices if text blocks were manually edited out of chronological order.
      const fallback_regex = new RegExp(whitespace_resilient_pattern);
      const fallback_match = fallback_regex.exec(raw_source_text_content);
      if (fallback_match) {
        absolute_start_index = fallback_match.index;
        absolute_end_index = absolute_start_index + fallback_match[0].length;
      }
    }

    segment_character_ranges_array.push({
      start: absolute_start_index,
      end: absolute_end_index
    });
  }

  return segment_character_ranges_array;
}

// WHAT: Finds the index of the segment in the target array that has the maximum overlap with the source range.
// WHY: Solves the different indexing systems between Column 2 and Column 3 by aligning them based on their character positions in the raw book text.
function find_best_overlapping_segment_index(source_start_character, source_end_character, target_ranges_list) {
  let best_matching_index = -1;
  let maximum_overlap_characters = 0;

  // WHAT: Iterating through target segments to find overlap ranges.
  // WHY: Card that shares the most characters with our selection range represents the best match.
  for (let segment_counter = 0; segment_counter < target_ranges_list.length; segment_counter++) {
    const target_range_item = target_ranges_list[segment_counter];
    if (target_range_item.start === -1) {
      continue;
    }

    // WHAT: Calculate overlap segment size.
    // WHY: Math.max and Math.min determine the intersections of character coordinates.
    const overlap_start_bound = Math.max(source_start_character, target_range_item.start);
    const overlap_end_bound = Math.min(source_end_character, target_range_item.end);
    const overlap_characters_length = overlap_end_bound - overlap_start_bound;

    if (overlap_characters_length > maximum_overlap_characters) {
      maximum_overlap_characters = overlap_characters_length;
      best_matching_index = segment_counter;
    }
  }

  // WHAT: Distance-based fallback if no direct character overlaps exist.
  // WHY: Returns the closest physical segment to keep scroll linked.
  if (best_matching_index === -1 && target_ranges_list.length > 0) {
    let minimum_distance_characters = Infinity;
    for (let segment_counter = 0; segment_counter < target_ranges_list.length; segment_counter++) {
      const target_range_item = target_ranges_list[segment_counter];
      if (target_range_item.start === -1) {
        continue;
      }
      const distance_characters = Math.abs(target_range_item.start - source_start_character);
      if (distance_characters < minimum_distance_characters) {
        minimum_distance_characters = distance_characters;
        best_matching_index = segment_counter;
      }
    }
  }

  return best_matching_index;
}

// WHAT: Highlights related cards in Column 2 & 3 and selects/scrolls text in Column 1, linking them by character overlap.
// WHY: Resolves different indexing systems by matching the clicked card's text position inside the raw source text to the closest overlapping card in the other panel.
function highlight_synchronize_active_segment(segment_index_position, is_triggered_from_directorial) {
  // WHAT: Retrieve the scrollable containers for screenplay and directorial cards.
  // WHY: Needed to calculate programmatic scroll center offsets for side-by-side cell alignments.
  const classic_cards_scroll_wrapper = document.getElementById("screenplay_segment_cards_wrapper");
  const directorial_cards_scroll_wrapper = document.getElementById("directorial_segment_cards_wrapper");
  const raw_source_textarea_element = document.getElementById("raw_source_book_textarea_editor");

  if (!active_loaded_project_state_object) {
    return;
  }

  // WHAT: Clear previous active highlights.
  // WHY: Ensures only the currently focused elements are visual highlights.
  const classic_screenplay_cards_list = document.querySelectorAll(".screenplay_item_card");
  const directorial_screenplay_cards_list = document.querySelectorAll(".directorial_item_card");

  classic_screenplay_cards_list.forEach((card_node_element) => {
    card_node_element.classList.remove("active_highlight_card");
  });
  directorial_screenplay_cards_list.forEach((card_node_element) => {
    card_node_element.classList.remove("active_highlight_card");
  });

  // WHAT: Locate all segment character ranges for both screenplay and directorial systems.
  // WHY: Overlap math matches cells dynamically without needing them to share identical sentence counts.
  const classic_segments = active_loaded_project_state_object.scriptSegments || [];
  const directorial_segments = active_loaded_project_state_object.directorialSegments || [];

  const classic_character_ranges = locate_generic_segment_ranges_in_raw_text(classic_segments);
  const directorial_character_ranges = locate_generic_segment_ranges_in_raw_text(directorial_segments);

  let classic_active_index = -1;
  let directorial_active_index = -1;
  let selected_start_character = -1;
  let selected_end_character = -1;

  if (is_triggered_from_directorial) {
    directorial_active_index = segment_index_position;
    const target_range_item = directorial_character_ranges[directorial_active_index];
    if (target_range_item) {
      selected_start_character = target_range_item.start;
      selected_end_character = target_range_item.end;
      classic_active_index = find_best_overlapping_segment_index(selected_start_character, selected_end_character, classic_character_ranges);
    }
  } else {
    classic_active_index = segment_index_position;
    const target_range_item = classic_character_ranges[classic_active_index];
    if (target_range_item) {
      selected_start_character = target_range_item.start;
      selected_end_character = target_range_item.end;
      directorial_active_index = find_best_overlapping_segment_index(selected_start_character, selected_end_character, directorial_character_ranges);
    }
  }

  // WHAT: Highlight and programmatically center the classic card in Column 2.
  // WHY: Bypasses standard browser scrolling jitter to align the matched screenplay card side-by-side.
  if (classic_active_index !== -1) {
    select_and_inspect_segment(classic_active_index);
    const targeted_classic_card_element = document.getElementById(`screenplay_card_node_${classic_active_index}`);
    if (targeted_classic_card_element && classic_cards_scroll_wrapper) {
      targeted_classic_card_element.classList.add("active_highlight_card");
      classic_cards_scroll_wrapper.scrollTo({
        top: targeted_classic_card_element.offsetTop - (classic_cards_scroll_wrapper.clientHeight / 2) + (targeted_classic_card_element.clientHeight / 2),
        behavior: "smooth"
      });
    }
  }

  // WHAT: Highlight and programmatically center the directorial card in Column 3.
  // WHY: Align the matching intent-enriched cell side-by-side level with its counterpart.
  if (directorial_active_index !== -1) {
    const targeted_directorial_card_element = document.getElementById(`directorial_card_node_${directorial_active_index}`);
    if (targeted_directorial_card_element && directorial_cards_scroll_wrapper) {
      targeted_directorial_card_element.classList.add("active_highlight_card");
      directorial_cards_scroll_wrapper.scrollTo({
        top: targeted_directorial_card_element.offsetTop - (directorial_cards_scroll_wrapper.clientHeight / 2) + (targeted_directorial_card_element.clientHeight / 2),
        behavior: "smooth"
      });
    }
  }

  // WHAT: Highlight, focus, and scroll the corresponding text block inside the Column 1 Raw Manuscript Editor.
  // WHY: In modern Chromium-based environments (including Electron), text selection ranges within a standard
  //      textarea element are kept visually transparent or completely hidden by the browser engine unless the
  //      element itself currently holds the document's active keyboard focus. By programmatically triggering
  //      focus() on the manuscript textarea immediately before selecting the target character boundaries,
  //      we force Chromium to draw the high-contrast selection highlight background. This makes the selected
  //      line instantly and vividly visible to the user without interrupting their workspace.
  if (raw_source_textarea_element && selected_start_character !== -1) {
    // WHAT: Shift interface keyboard focus to the manuscript panel.
    // WHY: Activating focus makes selection highlight bounds visually apparent to the user's eye.
    raw_source_textarea_element.focus();

    // WHAT: Setting character select boundaries from start to end indices.
    // WHY: Isolates the specific sentence segment matched by our spacing-resilient regex engine.
    raw_source_textarea_element.setSelectionRange(selected_start_character, selected_end_character);

    // WHAT: Calculating exact scroll offsets to vertical-center the selected text range.
    // WHY: We extract everything before the selected text, determine how many lines deep the match is,
    //      multiply by the line-height, and adjust scroll top positions to center it relative to the viewport.
    const text_before_selection_content = raw_source_textarea_element.value.substring(0, selected_start_character);
    const lines_count_before_selection = text_before_selection_content.split("\n").length;
    const line_height_in_pixels = 25.5; // based on the precise line-height in the CSS file
    raw_source_textarea_element.scrollTop = (lines_count_before_selection * line_height_in_pixels) - (raw_source_textarea_element.clientHeight / 2);
  }
}

// WHAT: Plays synthesized speech clips in the editor page using local browser audio elements.
// WHY: Allows the user to check character voice outputs immediately.
// STYLE: instructional friendly tutorial.
function play_individual_line_clip(index_position_of_card) {
  // WHAT: Verifying system workspace state parameters.
  // WHY: Ensures paths can be resolved before loading audio files from local disk.
  if (!active_loaded_project_state_object || !active_selected_workspace_directory_path) {
    return;
  }

  // WHAT: Loading script segment details.
  // WHY: Used to check version lists and active audio take markers.
  const targeted_segment_item = active_loaded_project_state_object.scriptSegments[index_position_of_card];
  
  let absolute_audio_path_to_play = null;

  // WHAT: Resolving the target file path dynamically.
  // WHY: We attempt to load the path directly from the selected active version take's absolute path
  //      to support legacy layouts and new structured subfolders seamlessly.
  if (targeted_segment_item.audioVersions && targeted_segment_item.audioVersions.length > 0) {
    for (let version_counter = 0; version_counter < targeted_segment_item.audioVersions.length; version_counter++) {
      const take_version_item = targeted_segment_item.audioVersions[version_counter];
      if (take_version_item.isActive && take_version_item.filePath) {
        absolute_audio_path_to_play = take_version_item.filePath;
        break;
      }
    }
  }

  // WHAT: Fallback to segment's main audioPath.
  // WHY: Serves as backup if versions list mapping was delayed or empty.
  if (!absolute_audio_path_to_play && targeted_segment_item.audioPath) {
    absolute_audio_path_to_play = targeted_segment_item.audioPath;
  }

  // WHAT: Constructing fallback default absolute path (backward-compatibility).
  // WHY: If no paths exist, compiles typical classic take folder structures.
  if (!absolute_audio_path_to_play) {
    const default_filename = `line_${index_position_of_card}.wav`;
    absolute_audio_path_to_play = `${active_selected_workspace_directory_path}/${active_loaded_project_state_object.projectName}/audio/${default_filename}`;
  }

  // WHAT: Expand relative paths to absolute paths.
  // WHY: Binds relative properties to active workspace directories.
  if (absolute_audio_path_to_play && !absolute_audio_path_to_play.includes(":") && !absolute_audio_path_to_play.startsWith("/") && !absolute_audio_path_to_play.startsWith("\\")) {
    absolute_audio_path_to_play = `${active_selected_workspace_directory_path}/${active_loaded_project_state_object.projectName}/${absolute_audio_path_to_play}`;
  }

  // WHAT: Convert the absolute path to a safe, normalized file:/// URL.
  // WHY: Electron requires safe file protocol prefixes to stream local media cleanly.
  const normalized_absolute_path = absolute_audio_path_to_play.replace(/\\/g, "/").replace(/^\/+/, "");
  const source_audio_file_path = `file:///${normalized_absolute_path}?t=${Date.now()}`;
  
  // WHAT: Fetching or creating html5 audio player elements.
  // WHY: Standard browser plays standard wav/mp3 clips easily without visual overlays.
  let clip_player_node = document.getElementById("html5_segment_audio_player");
  if (!clip_player_node) {
    clip_player_node = document.createElement("audio");
    clip_player_node.id = "html5_segment_audio_player";
    clip_player_node.style.display = "none";
    document.body.appendChild(clip_player_node);
  }

  // WHAT: Checking if the user clicked play on the card that is already currently playing.
  // WHY: If they click the same button while it's playing, it should act as a "Stop" button.
  if (clip_player_node.dataset.currentCardIndex === String(index_position_of_card) && !clip_player_node.paused) {
    clip_player_node.pause();
    clip_player_node.currentTime = 0;
    clip_player_node.dataset.currentCardIndex = ""; // Clear it so clicking again restarts it
    return; // Exit early, we only wanted to stop the audio
  }

  // WHAT: Dispatching local play request for the new or restarted card.
  // WHY: Loads audio stream and fires playback event, throwing clean catch blocks if missing.
  clip_player_node.dataset.currentCardIndex = String(index_position_of_card);
  clip_player_node.src = source_audio_file_path;
  clip_player_node.play().catch((audio_failure_exception) => {
    console.error("Failed to play segment audio clip file.", audio_failure_exception);
    alert("Audio clip file not accessible. Please ensure it was synthesized correctly.");
    clip_player_node.dataset.currentCardIndex = "";
  });
}

// =========================================================================
// LINE STUDIO INSPECTOR - COLUMN 3 CONTROLLER & DOM BUILDER
// =========================================================================

let active_inspected_segment_index = 0;

function escape_html_entities(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function select_and_inspect_segment(index) {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) return;
  const segments = active_loaded_project_state_object.scriptSegments;
  if (index < 0 || index >= segments.length) return;

  active_inspected_segment_index = index;

  // Update visual outline on screenplay cards in Column 2
  document.querySelectorAll(".screenplay_item_card").forEach((card, idx) => {
    if (idx === index) {
      card.classList.add("active_inspected_card");
    } else {
      card.classList.remove("active_inspected_card");
    }
  });

  // Update header badge
  const line_badge = document.getElementById("inspector_active_line_badge");
  if (line_badge) {
    const target_seg = segments[index];
    line_badge.textContent = `Line ${index} • ${target_seg.speaker || 'Narrator'}`;
  }

  render_line_inspector_view(index);
}

function generate_simulated_waveform_html(take_number, energy) {
  const bars_count = 28;
  let bars_html = "";
  for (let b = 0; b < bars_count; b++) {
    const pseudo_random = Math.sin((b + 1) * 0.7 * (take_number || 1)) * 0.5 + 0.5;
    const height_pct = Math.max(15, Math.min(100, Math.round(pseudo_random * 80 * (energy || 1.0))));
    bars_html += `<div class="waveform_bar_sim" style="height: ${height_pct}%;"></div>`;
  }
  return bars_html;
}

function render_line_inspector_view(line_index) {
  const inspector_container = document.getElementById("line_inspector_content_container");
  if (!inspector_container) return;

  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments || active_loaded_project_state_object.scriptSegments.length === 0) {
    inspector_container.innerHTML = `
      <div class="empty_state_screen vh-50">
        <div class="empty_state_hex_glow text-purple">
          <svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>
        </div>
        <h4 class="empty_state_title">No Script Segments Loaded</h4>
        <p class="empty_state_tagline">Load a project and run Automate Attribution to inspect line-level telemetry.</p>
      </div>`;
    return;
  }

  const segments = active_loaded_project_state_object.scriptSegments;
  const valid_index = Math.max(0, Math.min(segments.length - 1, line_index !== undefined ? line_index : 0));
  active_inspected_segment_index = valid_index;
  const segment = segments[valid_index];

  // Update header badge
  const line_badge = document.getElementById("inspector_active_line_badge");
  if (line_badge) {
    line_badge.textContent = `Line ${valid_index} • ${segment.speaker || 'Narrator'}`;
  }

  // Section 1: Narrative State & Subtext
  const active_relationships = active_loaded_project_state_object.relationships || [];
  const relevant_rel = active_relationships.find(r => r.source_character === segment.speaker || r.target_character === segment.speaker);
  let relationship_badge_html = "";
  if (relevant_rel) {
    const partner = relevant_rel.source_character === segment.speaker ? relevant_rel.target_character : relevant_rel.source_character;
    relationship_badge_html = `
      <div class="d-flex align-items-center justify-content-between p-6-10 radius-6 text-11" style="background: rgba(157, 78, 221, 0.12); border: 1px solid rgba(157, 78, 221, 0.35); color: #e9d5ff;">
        <span>👥 <strong>${segment.speaker}</strong> ➔ <strong>${partner}</strong></span>
        <span style="color: #c084fc;">[${relevant_rel.relation_tone || 'Guarded'} • ${relevant_rel.relation_type || 'Formal'}]</span>
        ${relevant_rel.status ? `<span class="badge radius-3 p-1-4 text-10" style="background: rgba(0,240,255,0.15); color: #38bdf8;">${relevant_rel.status}</span>` : ''}
      </div>`;
  } else {
    relationship_badge_html = `
      <div class="p-6-10 radius-6 text-11" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); color: #94a3b8;">
        <span>${segment.speaker === 'Narrator' ? '📖 Narrative Exposition: Omniscient storyteller voice' : '👤 Character Dynamic: Solo delivery / Baseline stance'}</span>
      </div>`;
  }

  const current_intent = segment.intent || (segment.qwen_style && segment.qwen_style.rich_emotion) || "Direct spoken dialogue.";
  const detected_emotion = segment.emotion || "calm";
  const energy_level = typeof segment.energy === "number" ? segment.energy : 1.0;
  const energy_pct = Math.min(100, Math.round((energy_level / 3.0) * 100));

  // Section 2: Pronunciation & Phonetic Overrides
  segment.phonetic_overrides = segment.phonetic_overrides || {};
  const override_keys = Object.keys(segment.phonetic_overrides);
  let chips_html = "";
  if (override_keys.length > 0) {
    chips_html = `<div class="phonetic_chip_list">` + override_keys.map(term => `
      <span class="phonetic_chip">
        <strong>${term}</strong> ➔ <em>${segment.phonetic_overrides[term]}</em>
        <span class="phonetic_chip_remove" onclick="handle_inspector_remove_phonetic_override(${valid_index}, '${term.replace(/'/g, "\\'")}')" title="Remove override">✕</span>
      </span>
    `).join('') + `</div>`;
  } else {
    chips_html = `<div class="text-11 text-muted font-italic">No phonetic overrides active for this line.</div>`;
  }

  // Section 3: Take A/B Testing & Waveform Telemetry
  const audio_takes = Array.isArray(segment.audioVersions) ? segment.audioVersions : [];
  let takes_list_html = "";
  if (audio_takes.length > 0) {
    takes_list_html = audio_takes.map(take => {
      const is_master = !!take.isActive;
      const take_energy = typeof take.energy === "number" ? take.energy : 1.0;
      return `
        <div class="take_comparison_item ${is_master ? 'take_active_master' : ''}">
          <div class="d-flex justify-content-between align-items-center">
            <span class="font-weight-bold text-11 d-flex align-items-center gap-6">
              ${is_master ? '<span class="text-green font-bold">★ Take ' + take.take + ' (Master)</span>' : 'Take ' + take.take}
            </span>
            <span class="text-10 text-muted">${take.duration ? Number(take.duration).toFixed(1) + 's' : ''} • Energy: ${Math.round(take_energy * 100)}%</span>
          </div>
          <div class="mini_waveform_track">
            ${generate_simulated_waveform_html(take.take, take_energy)}
          </div>
          <div class="d-flex justify-content-end gap-6 text-10">
            <button class="cyber_btn btn_secondary p-2-6 text-10" onclick="play_specific_card_take(${valid_index}, ${take.take})" title="Audition this take">▶ Audition</button>
            ${!is_master ? `<button class="cyber_btn p-2-6 text-10 text-green" onclick="handle_card_take_change_event(${valid_index}, ${take.take}, false)" title="Set as master audio take">★ Set Master</button>` : ''}
            <button class="cyber_btn btn_secondary p-2-6 text-10 text-purple" onclick="open_auk_edit_tools_modal(${valid_index}, false)" title="AuK Audio Editing Suite">🪄 Edit</button>
            <button class="cyber_btn btn_secondary p-2-6 text-10 text-coral" onclick="trigger_delete_specific_take(${valid_index}, ${take.take})" title="Delete take">🗑</button>
          </div>
        </div>`;
    }).join('');
  } else {
    takes_list_html = `
      <div class="text-11 text-muted font-italic p-10 text-center radius-6" style="background: rgba(0,0,0,0.25); border: 1px dashed rgba(255,255,255,0.1);">
        No synthesized takes recorded yet. Click "⚡ Synthesize Line" above.
      </div>`;
  }

  // Section 4: Micro-Pacing & Breath Controls
  const pre_pause = segment.pre_pause_ms !== undefined ? segment.pre_pause_ms : 150;
  const post_pause = segment.post_pause_ms !== undefined ? segment.post_pause_ms : 300;
  const inject_breath = segment.inject_breath !== undefined ? segment.inject_breath : true;

  // Section 5: AI Confidence & Shadow QC Insights
  const engine_name = segment.engine === 'clm' ? 'CLM-8B' : (segment.engine === 'clm_cascade' ? 'Cascade (CLM-8B)' : (segment.engine === 'llm' ? 'llama.cpp' : 'Laya Fast'));
  const conf_score = typeof segment.confidence === "number" ? segment.confidence : (segment.is_user_locked ? 1.0 : 0.85);
  const conf_pct = Math.round(conf_score * 100);
  let conf_color = "#10b981";
  let conf_gradient = "linear-gradient(90deg, #10b981, #059669)";
  let conf_label = "High Confidence";
  if (conf_pct < 60) {
    conf_color = "#ef4444";
    conf_gradient = "linear-gradient(90deg, #ef4444, #dc2626)";
    conf_label = "Low (Ambiguous)";
  } else if (conf_pct < 85) {
    conf_color = "#f59e0b";
    conf_gradient = "linear-gradient(90deg, #f59e0b, #d97706)";
    conf_label = "Moderate Confidence";
  }

  inspector_container.innerHTML = `
    <!-- MODULE 1: Narrative State & Subtext -->
    <div class="inspector_section_card">
      <div class="inspector_section_header">
        <span class="inspector_section_title">🎭 1. Narrative State & Subtext</span>
        <span class="badge radius-4 p-2-6 text-10 font-mono" style="background: rgba(0,240,255,0.15); color: #38bdf8;">${segment.speaker || 'Narrator'}</span>
      </div>
      ${relationship_badge_html}
      <div>
        <div class="inspector_field_label">Subtext & Dramatic Intent:</div>
        <textarea class="inspector_input_area" rows="2" placeholder="Subtext or emotional motivation (e.g. Sarcastic, hiding grief)" onchange="handle_inspector_subtext_change(${valid_index}, this.value)">${escape_html_entities(current_intent)}</textarea>
      </div>
      <div class="d-flex justify-content-between align-items-center text-11">
        <span class="text-muted">Emotion: <strong class="text-white">${detected_emotion}</strong></span>
        <div class="d-flex align-items-center gap-6">
          <span class="text-muted">Energy:</span>
          <div style="width: 70px; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
            <div style="width: ${energy_pct}%; height: 100%; background: linear-gradient(90deg, #38bdf8, #9d4edd);"></div>
          </div>
          <span class="text-muted font-mono text-10">${energy_level.toFixed(1)}</span>
        </div>
      </div>
    </div>

    <!-- MODULE 2: Pronunciation & Phonetic Overrides -->
    <div class="inspector_section_card">
      <div class="inspector_section_header">
        <span class="inspector_section_title">🗣 2. Pronunciation & Phonetics</span>
        <span class="text-10 text-muted">${override_keys.length} overrides</span>
      </div>
      ${chips_html}
      <div class="d-flex flex-column gap-6 mt-6">
        <div class="d-flex gap-6">
          <input type="text" id="inspector_phonetic_term_input" class="form_text_field p-4-8 text-11 flex-grow-1" placeholder="Term (e.g. cupola)">
          <input type="text" id="inspector_phonetic_val_input" class="form_text_field p-4-8 text-11 flex-grow-1" placeholder="Phonetic (e.g. KOO-puh-luh)">
          <button class="cyber_btn p-4-8 text-11" onclick="handle_inspector_add_phonetic_override(${valid_index})">+ Add</button>
        </div>
      </div>
    </div>

    <!-- MODULE 3: Take A/B Testing & Waveform Telemetry -->
    <div class="inspector_section_card">
      <div class="inspector_section_header">
        <span class="inspector_section_title">📊 3. Take A/B Auditioning</span>
        <span class="text-10 text-muted">${audio_takes.length} takes available</span>
      </div>
      <div class="d-flex flex-column gap-8">
        ${takes_list_html}
      </div>
    </div>

    <!-- MODULE 4: Micro-Pacing & Breath Controls -->
    <div class="inspector_section_card">
      <div class="inspector_section_header">
        <span class="inspector_section_title">⏱ 4. Micro-Pacing & Breath</span>
      </div>
      <div class="d-flex flex-column gap-8">
        <div>
          <div class="d-flex justify-content-between text-11 mb-2">
            <span class="inspector_field_label mb-0">Pre-Line Silence:</span>
            <span class="pacing_slider_badge" id="val_pre_pause_${valid_index}">${pre_pause} ms</span>
          </div>
          <div class="pacing_slider_row">
            <input type="range" class="pacing_slider_input" min="0" max="2000" step="25" value="${pre_pause}" oninput="handle_inspector_pause_change(${valid_index}, 'pre_pause_ms', this.value)">
          </div>
        </div>
        <div>
          <div class="d-flex justify-content-between text-11 mb-2">
            <span class="inspector_field_label mb-0">Post-Line Silence:</span>
            <span class="pacing_slider_badge" id="val_post_pause_${valid_index}">${post_pause} ms</span>
          </div>
          <div class="pacing_slider_row">
            <input type="range" class="pacing_slider_input" min="0" max="2000" step="25" value="${post_pause}" oninput="handle_inspector_pause_change(${valid_index}, 'post_pause_ms', this.value)">
          </div>
        </div>
        <label class="d-flex align-items-center gap-8 text-11 cursor-pointer mt-4" style="color: #cbd5e1;">
          <input type="checkbox" ${inject_breath ? 'checked' : ''} onchange="handle_inspector_breath_toggle(${valid_index}, this.checked)">
          <span>Insert natural breath sound before spoken line</span>
        </label>
      </div>
    </div>

    <!-- MODULE 5: AI Confidence & Shadow QC Insights -->
    <div class="inspector_section_card">
      <div class="inspector_section_header">
        <span class="inspector_section_title">🛡 5. Confidence & Shadow QC</span>
        <span class="badge radius-4 p-2-6 text-10 font-mono" style="background: rgba(255,255,255,0.06); color: #cbd5e1;">${engine_name}</span>
      </div>
      <div>
        <div class="d-flex justify-content-between align-items-center text-11 mb-4">
          <span class="font-weight-bold">Attribution Confidence</span>
          <span style="color: ${conf_color}; font-weight: 600;">${conf_pct}% • ${conf_label}</span>
        </div>
        <div class="qc_confidence_track_bg">
          <div class="qc_confidence_fill" style="width: ${conf_pct}%; background: ${conf_gradient};"></div>
        </div>
      </div>
      <div class="d-flex justify-content-between align-items-center mt-6">
        <button class="cyber_btn ${segment.is_user_locked ? 'text-green border-green-glow' : 'btn_secondary'} p-4-10 text-11 radius-4" onclick="handle_inspector_lock_toggle(${valid_index})" title="Protect this line attribution as ground truth">
          ${segment.is_user_locked ? '🔒 Locked Ground Truth' : '🔓 Lock as Ground Truth'}
        </button>
        <button class="cyber_btn btn_secondary p-4-10 text-11 radius-4" onclick="handle_inspector_reattribute_line(${valid_index})" title="Re-run attribution classifier on this segment">
          ⚡ Re-attribute Line
        </button>
      </div>
    </div>
  `;
}

function play_inspector_active_take() {
  play_individual_line_clip(active_inspected_segment_index);
}

function trigger_inspector_line_synthesis() {
  trigger_single_line_speech_synthesis(active_inspected_segment_index);
}

function play_specific_card_take(card_index, take_number) {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) return;
  const segment = active_loaded_project_state_object.scriptSegments[card_index];
  if (!segment || !segment.audioVersions) return;

  const target_take = segment.audioVersions.find(t => t.take === take_number);
  if (target_take && target_take.audioPath) {
    const clip_player_node = document.getElementById("individual_clip_audio_player");
    if (clip_player_node) {
      clip_player_node.dataset.currentCardIndex = String(card_index);
      clip_player_node.src = target_take.audioPath;
      clip_player_node.play().catch(e => console.error("Audition playback failed:", e));
    }
  } else {
    alert("Audio take file not available on disk.");
  }
}

async function trigger_delete_specific_take(card_index, take_number) {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) return;
  const segment = active_loaded_project_state_object.scriptSegments[card_index];
  if (!segment || !segment.audioVersions) return;

  segment.audioVersions = segment.audioVersions.filter(t => t.take !== take_number);
  if (segment.audioVersions.length > 0) {
    const has_active = segment.audioVersions.some(t => t.isActive);
    if (!has_active) {
      segment.audioVersions[0].isActive = true;
      segment.audioPath = segment.audioVersions[0].audioPath;
    }
  } else {
    segment.audioPath = null;
  }

  await trigger_project_state_disk_flush();
  populate_screenplay_cards_in_editor_view();
  render_line_inspector_view(card_index);
}

async function handle_inspector_subtext_change(index, new_intent) {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) return;
  const segment = active_loaded_project_state_object.scriptSegments[index];
  if (segment) {
    segment.intent = new_intent;
    await trigger_project_state_disk_flush();
  }
}

async function handle_inspector_add_phonetic_override(index) {
  const term_input = document.getElementById("inspector_phonetic_term_input");
  const val_input = document.getElementById("inspector_phonetic_val_input");
  if (!term_input || !val_input) return;

  const term = term_input.value.trim();
  const phonetic = val_input.value.trim();
  if (!term || !phonetic) return;

  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) return;
  const segment = active_loaded_project_state_object.scriptSegments[index];
  if (segment) {
    segment.phonetic_overrides = segment.phonetic_overrides || {};
    segment.phonetic_overrides[term] = phonetic;

    active_loaded_project_state_object.pronunciationDictionary = active_loaded_project_state_object.pronunciationDictionary || {};
    active_loaded_project_state_object.pronunciationDictionary[term] = phonetic;

    await trigger_project_state_disk_flush();
    render_line_inspector_view(index);
  }
}

async function handle_inspector_remove_phonetic_override(index, term) {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) return;
  const segment = active_loaded_project_state_object.scriptSegments[index];
  if (segment && segment.phonetic_overrides) {
    delete segment.phonetic_overrides[term];
    await trigger_project_state_disk_flush();
    render_line_inspector_view(index);
  }
}

async function handle_inspector_pause_change(index, key, value) {
  const int_val = parseInt(value, 10);
  const badge = document.getElementById(key === 'pre_pause_ms' ? `val_pre_pause_${index}` : `val_post_pause_${index}`);
  if (badge) badge.textContent = `${int_val} ms`;

  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) return;
  const segment = active_loaded_project_state_object.scriptSegments[index];
  if (segment) {
    segment[key] = int_val;
    await trigger_project_state_disk_flush();
  }
}

async function handle_inspector_breath_toggle(index, is_checked) {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) return;
  const segment = active_loaded_project_state_object.scriptSegments[index];
  if (segment) {
    segment.inject_breath = is_checked;
    await trigger_project_state_disk_flush();
  }
}

async function handle_inspector_lock_toggle(index) {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) return;
  const segment = active_loaded_project_state_object.scriptSegments[index];
  if (segment) {
    segment.is_user_locked = !segment.is_user_locked;
    await trigger_project_state_disk_flush();
    populate_screenplay_cards_in_editor_view();
    render_line_inspector_view(index);
  }
}

async function handle_inspector_reattribute_line(index) {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.scriptSegments) return;
  const segment = active_loaded_project_state_object.scriptSegments[index];
  if (!segment) return;

  if (window.audiobook_api && typeof window.audiobook_api.trigger_laya_attribution === "function") {
    try {
      const result = await window.audiobook_api.trigger_laya_attribution({
        book_text_segment: segment.text,
        voice_mapping_context: active_loaded_project_state_object.voiceMapping || {},
        existing_script_segments: [segment],
        laya_endpoint_url: configuration_laya_api_url_address,
        clm_endpoint_url: (typeof configuration_clm_api_url_address !== "undefined") ? configuration_clm_api_url_address : "http://127.0.0.1:8700",
        attribution_engine: "laya",
        confidence_threshold: 0.55
      });
      if (result && result.script_segments && result.script_segments.length > 0) {
        const reattributed = result.script_segments[0];
        segment.speaker = reattributed.speaker || segment.speaker;
        segment.confidence = reattributed.confidence || segment.confidence;
        segment.emotion = reattributed.emotion || segment.emotion;
        segment.engine = reattributed.engine || segment.engine;
        await trigger_project_state_disk_flush();
        populate_screenplay_cards_in_editor_view();
        render_line_inspector_view(index);
      }
    } catch (err) {
      console.warn("Re-attribution error:", err);
    }
  }
}

// WHAT: Populates the rightmost directorial orchestration panel (Column 3) with interactive cards.
// WHY: Renders a highly detailed directorial screenplay detailing intents, delivery options, and Zonos emotion sliders.
function populate_directorial_cards_in_editor_view() {
  render_line_inspector_view(active_inspected_segment_index);

  const directorial_cards_wrapper_element = document.getElementById("directorial_segment_cards_wrapper");
  if (!directorial_cards_wrapper_element) {
    return;
  }
  directorial_cards_wrapper_element.innerHTML = "";

  if (!active_loaded_project_state_object || !active_loaded_project_state_object.directorialSegments || active_loaded_project_state_object.directorialSegments.length === 0) {
    // WHAT: Displaying empty placeholder overlay.
    // WHY: Informs user that they need to run the Directorial Script Doctor first to populate cards.
    directorial_cards_wrapper_element.innerHTML = `
      <div class="empty_state_screen vh-50">
        <div class="empty_state_hex_glow text-gold">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        </div>
        <h4 class="empty_state_title">No Directorial Script Enriched</h4>
        <p class="empty_state_tagline">Click "Director Script Doctor" above to run the Triple-Input metadata and vector emotion extraction.</p>
      </div>
    `;
    return;
  }

  // WHAT: Fetching character names from global cast list.
  // WHY: Needed to populate speaker reassignment selectors in the card's dropdown list.
  const list_of_known_character_names = ["Narrator"];
  if (active_loaded_project_state_object.voiceMapping) {
    const keys_of_mapped_voices = Object.keys(active_loaded_project_state_object.voiceMapping);
    for (let index_counter = 0; index_counter < keys_of_mapped_voices.length; index_counter++) {
      const voice_key_name = keys_of_mapped_voices[index_counter];
      if (voice_key_name !== "Narrator") {
        list_of_known_character_names.push(voice_key_name);
      }
    }
  }

  for (let segment_index_counter = 0; segment_index_counter < active_loaded_project_state_object.directorialSegments.length; segment_index_counter++) {
    const active_script_segment_item = active_loaded_project_state_object.directorialSegments[segment_index_counter];
    active_script_segment_item.index_position = segment_index_counter;

    const individual_directorial_card_element = document.createElement("div");
    individual_directorial_card_element.className = "directorial_item_card";
    individual_directorial_card_element.id = `directorial_card_node_${segment_index_counter}`;

    // WHAT: Constructing character select options dynamically.
    // WHY: Populates speaker pills so directors can reassign speaking roles.
    let character_select_options_html = "";
    for (let char_index = 0; char_index < list_of_known_character_names.length; char_index++) {
      const character_name_option = list_of_known_character_names[char_index];
      const selected_attribute_flag = (active_script_segment_item.speaker === character_name_option) ? "selected" : "";
      character_select_options_html += `<option value="${character_name_option}" ${selected_attribute_flag}>${character_name_option}</option>`;
    }

    const delivery_parameters = active_script_segment_item.delivery || { pitch: "medium", pacing: "normal", volume: "normal", style_label: "neutral" };

    // WHAT: Checking if this directorial segment has active Qwen workflow override settings enabled.
    // WHY: Gives visual indications so the user can easily see card-level adjustments in Column 3.
    //      We only check workflowType here so that auto-generated seeds during regeneration don't trigger the "Override Active" badge.
    const is_custom_directorial_override_active = active_script_segment_item.workflowOverride && 
      active_script_segment_item.workflowOverride.workflowType && 
      active_script_segment_item.workflowOverride.workflowType !== "inherit";

    const directorial_override_button_text = is_custom_directorial_override_active ? "⚙️ Override Active" : "⚙️ Override";
    const directorial_override_button_class = is_custom_directorial_override_active
      ? "btn-directorial-override-active"
      : "btn-directorial-override-default";

    // WHAT: Creating the pill-styled dropdown selector listing all synthesized takes for directorial segments.
    // WHY: Enables version control for Column 3 cards so directors can select and compile their favorite takes.
    let take_select_options_html = "";
    if (active_script_segment_item.audioVersions && active_script_segment_item.audioVersions.length > 0) {
      take_select_options_html += `<select class="take_select_pill" onchange="handle_card_take_change_event(${segment_index_counter}, this.value, true)" title="Switch active audio take">`;
      for (let version_counter = 0; version_counter < active_script_segment_item.audioVersions.length; version_counter++) {
        const take_version_item = active_script_segment_item.audioVersions[version_counter];
        const selected_attribute_flag = take_version_item.isActive ? "selected" : "";
        take_select_options_html += `<option value="${take_version_item.take}" ${selected_attribute_flag}>Take ${take_version_item.take}</option>`;
      }
      take_select_options_html += `</select>`;
    }

    individual_directorial_card_element.innerHTML = `
      <div class="screenplay_card_meta_header">
        <div class="d-flex align-items-center gap-8">
          <span class="text-11 text-muted font-mono opacity-80" title="Line Number">#${segment_index_counter}</span>
          <select class="speaker_select_pill" onchange="handle_directorial_speaker_modification_event(${segment_index_counter}, this.value)" title="Assign character voice to this line">
            ${character_select_options_html}
          </select>
          <button class="focus_anchor_btn" title="Focus and sync raw text & columns" onclick="highlight_synchronize_active_segment(${segment_index_counter}, true)">
            <svg viewBox="0 0 24 24" width="10" height="10"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
            Focus
          </button>
          <button class="focus_anchor_btn ${directorial_override_button_class}" title="Configure Qwen workflow overrides" onclick="open_cell_workflow_config_modal(${segment_index_counter}, true)">
            ${directorial_override_button_text}
          </button>
        </div>
        <div class="d-flex align-items-center gap-6">
          ${active_script_segment_item.needs_resync ? `
            <span class="directorial_resync_badge" title="Speaker attribution was modified in Script Editor. Run Script Doctor or update direction to re-sync.">⚠️ Needs Re-sync</span>
          ` : ''}
          <span class="card_type_badge text-gold bg-gold-glow" title="Segment category: dialogue, narrative exposition, or parenthetical direction">${active_script_segment_item.type}</span>
        </div>
      </div>

      <textarea class="screenplay_text_input" onchange="handle_directorial_text_modification_event(${segment_index_counter}, this.value)" rows="2">${active_script_segment_item.text}</textarea>

      <!-- Directorial badges for Triple-Input delivery parameters -->
      <div class="directorial_meta_badges_row">
        <span class="directorial_badge badge_intent" title="Subtext: ${active_script_segment_item.intent || 'Story context'}">Intent Subtext 🎭</span>
        <span class="directorial_badge badge_pitch" title="Vocal pitch adjustment calculated from dramatic intensity">Pitch: ${delivery_parameters.pitch}</span>
        <span class="directorial_badge badge_pacing" title="Speaking cadence and tempo delivery">Pacing: ${delivery_parameters.pacing}</span>
        <span class="directorial_badge badge_volume" title="Dynamic vocal projection and decibel gain">Volume: ${delivery_parameters.volume}</span>
        <span class="directorial_badge text-purple border-purple-glow" title="Dramatic emotional state calculated for this scene">Emotion: ${active_script_segment_item.active_emotion_state || 'neutral'}</span>
        <span class="directorial_badge text-gold border-gold-glow" title="Acting delivery style and vocal characterization">Style: ${delivery_parameters.style_label}</span>
      </div>

      <!-- Advanced Directorial Tuning Panel -->
      <details class="directorial_vector_sliders_panel border-purple-glow">
        <summary class="text-purple">QWEN VOICE STYLE DETAILS</summary>
        <div class="directorial_vector_sliders_inner d-flex flex-column gap-6">
          <div class="vector_slider_row d-flex align-items-start gap-8">
            <span class="vector_slider_label min-w-110 text-purple">Vocal Texture</span>
            <span class="text-silver text-78rem">${delivery_parameters.qwen_style?.vocal_texture || 'N/A'}</span>
          </div>
          <div class="vector_slider_row d-flex align-items-start gap-8">
            <span class="vector_slider_label min-w-110 text-purple">Acting Persona</span>
            <span class="text-silver text-78rem">${delivery_parameters.qwen_style?.acting_persona || 'N/A'}</span>
          </div>
          <div class="vector_slider_row d-flex align-items-start gap-8">
            <span class="vector_slider_label min-w-110 text-purple">Vocal Technique</span>
            <span class="text-silver text-78rem">${delivery_parameters.qwen_style?.vocal_technique || 'N/A'}</span>
          </div>
          <div class="vector_slider_row d-flex align-items-start gap-8">
            <span class="vector_slider_label min-w-110 text-purple">Rich Emotion</span>
            <span class="text-silver text-78rem">${delivery_parameters.qwen_style?.rich_emotion || 'N/A'}</span>
          </div>
        </div>
      </details>

      <div class="screenplay_card_actions_bar">
        <div class="synthesis_status_indicator">
          <div class="status_dot" id="directorial_synthesis_light_dot_${segment_index_counter}"></div>
          <span id="directorial_synthesis_status_label_text_${segment_index_counter}" class="text-green font-semibold">Idle</span>
        </div>
        
        <div class="card_operational_buttons">
          ${take_select_options_html}
          ${active_script_segment_item.audioVersions && active_script_segment_item.audioVersions.length > 0 ? `
            <button class="card_operation_btn btn_edit_take text-purple border-purple-glow" title="AuK Audio Editing Suite (Whisper, Denoise, Pitch, Speed, Emotion)" onclick="open_auk_edit_tools_modal(${segment_index_counter}, true)">
              <span class="text-12">🪄</span>
            </button>
            <button class="card_operation_btn btn_delete_take text-coral border-coral-glow" title="Delete active take" onclick="trigger_delete_active_take(${segment_index_counter}, true)">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
          ` : ''}
          <button class="card_operation_btn btn_regenerate" title="Synthesize directorial line" onclick="trigger_single_directorial_line_speech_synthesis(${segment_index_counter})">
            <svg viewBox="0 0 24 24"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          </button>
          <button class="card_operation_btn btn_play_audio" title="Play synthesized clip" id="btn_play_directorial_clip_${segment_index_counter}" onclick="play_individual_directorial_line_clip(${segment_index_counter})">
            <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
        </div>
      </div>
    `;

    directorial_cards_wrapper_element.appendChild(individual_directorial_card_element);

    // WHAT: Checking the directorial queue status registry for any surviving status from before this DOM rebuild.
    // WHY: If a directorial card was set to "queued" or "processing" before another card triggered a full
    //      re-render, the registry preserves that status. Without this, cards revert to idle/completed.
    const directorial_registry_entry_for_current_card = renderer_directorial_card_queue_status_registry[segment_index_counter];
    if (directorial_registry_entry_for_current_card && directorial_registry_entry_for_current_card.status) {
      update_individual_directorial_card_synthesis_status_lights(
        segment_index_counter,
        directorial_registry_entry_for_current_card.status,
        directorial_registry_entry_for_current_card.message
      );
    } else {
      update_individual_directorial_card_synthesis_status_lights(segment_index_counter, active_script_segment_item.audioPath ? "completed" : "idle");
    }
  }
}

// =========================================================================
// INTERACTIVE EVENT HANDLERS - DIRECTORIAL screenplay CARD MODIFICATION
// =========================================================================

// WHAT: Hooking speaker change selections on directorial screenplay cards.
// WHY: Updates the directorial state, dynamically regenerates the performance style for the newly selected speaker in the background, and triggers disk serialization.
async function handle_directorial_speaker_modification_event(index_position_of_card, newly_selected_speaker_name) {
  if (active_loaded_project_state_object) {
    // WHAT: Update the speaker name on the targeted script segment.
    // WHY: Rebinds the dialogue block to the new character identity.
    active_loaded_project_state_object.directorialSegments[index_position_of_card].speaker = newly_selected_speaker_name;
    if (newly_selected_speaker_name === "Narrator") {
      active_loaded_project_state_object.directorialSegments[index_position_of_card].type = "narrator";
    } else {
      active_loaded_project_state_object.directorialSegments[index_position_of_card].type = "dialogue";
    }

    // WHAT: Setting card status to regenerating style in our UI queue registry.
    // WHY: Shows progress indicators to the user so they know a background LLM style call is active.
    renderer_directorial_card_queue_status_registry[index_position_of_card] = {
      status: "processing",
      message: "Regenerating style..."
    };
    populate_directorial_cards_in_editor_view();

    try {
      const active_script_segment_item = active_loaded_project_state_object.directorialSegments[index_position_of_card];
      
      // WHAT: Grabbing sliding window context (Tactical Fix).
      // WHY: Gives the LLM immediate local context to figure out the transient emotion of the segment.
      const sliding_window_context_list = [];
      const start_index = Math.max(0, index_position_of_card - 3);
      const end_index = Math.min(active_loaded_project_state_object.directorialSegments.length - 1, index_position_of_card + 3);
      for (let context_index = start_index; context_index <= end_index; context_index++) {
         const ctx_seg = active_loaded_project_state_object.directorialSegments[context_index];
         if (context_index === index_position_of_card) {
            sliding_window_context_list.push(`[TARGET SEGMENT: ${ctx_seg.text}]`);
         } else {
            sliding_window_context_list.push(`${ctx_seg.speaker}: ${ctx_seg.text}`);
         }
      }
      const sliding_window_context = sliding_window_context_list.join("\n");

      // WHAT: Querying the Director AI via LLM to regenerate style details for this single line.
      // WHY: Dynamically updates the intent analysis, technical voice delivery parameters, Qwen performance cues,
      //      and Zonos emotion weights specifically for the newly assigned speaker.
      const single_line_style_response_json = await window.audiobook_api.trigger_directorial_script_generation(
        active_script_segment_item.text,
        configuration_lm_studio_api_url_address,
        active_selected_workspace_directory_path,
        active_loaded_project_state_object.projectName,
        active_loaded_project_state_object.voiceMapping || {},
        newly_selected_speaker_name,
        sliding_window_context,
        active_loaded_project_state_object.relationships || []
      );

      if (single_line_style_response_json && single_line_style_response_json.script_segments && single_line_style_response_json.script_segments.length > 0) {
        const regenerated_script_segment = single_line_style_response_json.script_segments[0];
        
        // WHAT: Merging new directorial cues into our active segment memory.
        // WHY: Overwrites old delivery prompts, intents, and vectors with the freshly generated ones.
        active_script_segment_item.intent = regenerated_script_segment.intent || active_script_segment_item.intent;
        active_script_segment_item.delivery = regenerated_script_segment.delivery || active_script_segment_item.delivery;
      }
      
      // WHAT: Clearing status registry entry.
      // WHY: Returns the card visual state back to standard idle.
      delete renderer_directorial_card_queue_status_registry[index_position_of_card];
    } catch (regeneration_failure_exception) {
      console.error("Failed to dynamically update style for new speaker.", regeneration_failure_exception);
      alert(`Style regeneration warning: ${regeneration_failure_exception.message}`);
      delete renderer_directorial_card_queue_status_registry[index_position_of_card];
    }

    populate_directorial_cards_in_editor_view();
    trigger_project_state_disk_flush();
  }
}

// WHAT: Updating text changes dynamically in directorial segments.
// WHY: Stores direct directorial corrections in our active state database.
function handle_directorial_text_modification_event(index_position_of_card, updated_text_content) {
  if (active_loaded_project_state_object) {
    active_loaded_project_state_object.directorialSegments[index_position_of_card].text = updated_text_content;
    trigger_project_state_disk_flush();
  }
}

// =========================================================================
// PIPELINE WORKER - DIRECTORIAL ORCHESTRATION EXTRACTION DISPATCHER
// =========================================================================

// WHAT: Runs the master Directorial Script Doctor extraction pipeline (Pass 2 & 3 merger).
// WHY: Converts raw book excerpts into directorial script segments containing subtext intents and emotion vectors.
async function run_directorial_orchestration_extraction_pipeline() {
  if (!active_loaded_project_state_object || !active_selected_workspace_directory_path) {
    return;
  }

  const raw_book_text_input = document.getElementById("raw_source_book_textarea_editor").value.trim();
  if (!raw_book_text_input) {
    alert("The source text area is empty.");
    return;
  }

  // WHAT: Pre-flight check to ensure characters exist before running directorial extraction.
  // WHY: Directorial alignment depends entirely on pre-existing character definitions.
  //      If none exist, we automatically run the multi-pass cast discovery first.
  const existing_character_keys_for_pass_three = Object.keys(active_loaded_project_state_object.voiceMapping || {}).filter(character_identifier_key => character_identifier_key !== "Narrator");
  if (existing_character_keys_for_pass_three.length === 0) {
    if (typeof run_cast_discovery_pass_one === "function") {
      await run_cast_discovery_pass_one();
    }
  }

  const target_chunk_size = 3500;
  const total_directorial_chunks = Math.ceil(raw_book_text_input.length / target_chunk_size);
  const directorial_cards_wrapper_element = document.getElementById("directorial_segment_cards_wrapper");

  const list_of_new_directorial_segments = [];
  const discovered_characters_matrix = active_loaded_project_state_object.voiceMapping || {};

  try {
    for (let current_chunk_index = 0; current_chunk_index < total_directorial_chunks; current_chunk_index++) {
      const chunk_start_index = current_chunk_index * target_chunk_size;
      const sample_text_window_block = raw_book_text_input.substring(chunk_start_index, chunk_start_index + target_chunk_size);

      directorial_cards_wrapper_element.innerHTML = `
        <div class="empty_state_screen vh-50">
          <div class="status_dot state_processing w-40px h-40px"></div>
          <h4 class="empty_state_title">Orchestrating Directorial Alignment (Pass ${current_chunk_index + 1}/${total_directorial_chunks})...</h4>
          <p class="empty_state_tagline">Parsing raw segments using local Director AI. Injecting Intent analysis and Zonos emotion vectors. Please stand by...</p>
        </div>
      `;

      const directorial_response_json = await window.audiobook_api.trigger_directorial_script_generation(
        sample_text_window_block,
        configuration_lm_studio_api_url_address,
        active_selected_workspace_directory_path,
        active_loaded_project_state_object.projectName,
        discovered_characters_matrix,
        null,
        null,
        active_loaded_project_state_object.relationships || []
      );

      if (directorial_response_json && directorial_response_json.script_segments) {
        for (let segment_counter = 0; segment_counter < directorial_response_json.script_segments.length; segment_counter++) {
          const parsed_item = directorial_response_json.script_segments[segment_counter];
        
        // WHAT: Building structural segment descriptors for directorial script.
        // WHY: Holds all Triple-Input layers (semantic, intent, delivery) including the emotion vectors.
        const segment_descriptor = {
          index_position: list_of_new_directorial_segments.length,
          type: parsed_item.type,
          speaker: parsed_item.speaker || "Narrator",
          text: parsed_item.text,
          intent: parsed_item.intent || "Story context and subtext.",
          active_emotion_state: parsed_item.active_emotion_state || "neutral and observant.",
          delivery: parsed_item.delivery || {
            pitch: "medium",
            pacing: "normal",
            volume: "normal",
            style_label: "neutral",
            emotion_vector: { happiness: 0.0, sadness: 0.0, anger: 0.0, fear: 0.0, surprise: 0.0, disgust: 0.0, neutral: 1.0, other: 0.0 }
          },
          audioPath: null,
          audioVersions: []
        };

        list_of_new_directorial_segments.push(segment_descriptor);

        // WHAT: Assigning unrecognized speakers to the Unknown fallback profile.
        // WHY: We no longer implicitly create blank character profiles during directorial alignment.
        //      If the character is missing from the global voice matrix, they default to Unknown.
        if (segment_descriptor.speaker && segment_descriptor.speaker !== "Narrator") {
          if (!discovered_characters_matrix[segment_descriptor.speaker]) {
            segment_descriptor.speaker = "Unknown";
          }
        }
      }
    }
  } // End chunk loop

  active_loaded_project_state_object.directorialSegments = list_of_new_directorial_segments;
  // WHAT: Preventing AI overrides of the core voice map.
  // WHY: The AI might attempt to mutate existing profiles or return its own mapping. We discard this to strictly preserve the User's definitions.
  active_loaded_project_state_object.voiceMapping = discovered_characters_matrix;

  await trigger_project_state_disk_flush();

  populate_directorial_cards_in_editor_view();
  populate_voice_matrix_configuration_cards();
  refresh_synthesis_progress_tracking_meters();
  } catch (pipeline_execution_error) {
    console.error("Directorial alignment pipeline failed.", pipeline_execution_error);
    alert(`Directorial pipeline failed: ${pipeline_execution_error.message}`);
    populate_directorial_cards_in_editor_view();
  }
}

// =========================================================================
// SYNTHESIS PIPELINE CONTROL - DIRECTORIAL PIPELINE (COLUMN 3)
// =========================================================================

// WHAT: Enqueues single selected directorial card row down the ComfyUI synthesis queue.
// WHY: Triggers targeted audio creation for individual directorial line corrections.
async function trigger_single_directorial_line_speech_synthesis(index_position_of_card) {
  if (!active_loaded_project_state_object || !active_selected_workspace_directory_path) {
    return;
  }

  const script_segment_data_reference = active_loaded_project_state_object.directorialSegments[index_position_of_card];
  const voice_configuration_mapping = active_loaded_project_state_object.voiceMapping || {};

  // WHAT: Ensuring the audioVersions list history array is initialized.
  // WHY: Needed to compute next take counts sequentially.
  if (!script_segment_data_reference.audioVersions) {
    script_segment_data_reference.audioVersions = [];
  }
  const next_take_number = script_segment_data_reference.audioVersions.length + 1;

  // WHAT: We previously randomized the seed here, but now we respect the user's explicit Voice Matrix seed.
  // WHY: Users want consistent character voices across regenerations rather than random variations.
  
  // WHAT: Registering this directorial card's status in the queue registry BEFORE the DOM rebuild.
  // WHY: populate_directorial_cards_in_editor_view() destroys all DOM elements and recreates them.
  //      By writing to the registry first, the rebuild will pick up the queued status instead
  //      of resetting this card to idle. This also preserves statuses of OTHER directorial cards
  //      that were already queued from previous clicks.
  renderer_directorial_card_queue_status_registry[index_position_of_card] = {
    status: "processing",
    message: "Queueing..."
  };

  // WHAT: Flashing updated state and updating UI panels.
  // WHY: Persists changes and keeps the user aligned.
  //      The registry ensures previously queued cards retain their status through this rebuild.
  await trigger_project_state_disk_flush();
  populate_directorial_cards_in_editor_view();

  try {
    await window.audiobook_api.enqueue_directorial_speech_generation_task(
      active_selected_workspace_directory_path,
      active_loaded_project_state_object.projectName,
      script_segment_data_reference,
      voice_configuration_mapping,
      configuration_comfyui_api_url_address,
      next_take_number
    );
  } catch (queue_failure_exception) {
    console.error("Failed to enqueue directorial line synthesis task.", queue_failure_exception);
    update_individual_directorial_card_synthesis_status_lights(index_position_of_card, "failed", "Failed to enqueue");
  }
}

// WHAT: Enqueues every directorial line card consecutively to synthesize a full book.
// WHY: Runs the batch sequential synthesis down our backend queue for all Column 3 lines.
async function trigger_directorial_synthesis_all_lines() {
  if (!active_loaded_project_state_object || !active_loaded_project_state_object.directorialSegments || active_loaded_project_state_object.directorialSegments.length === 0) {
    alert("There are no parsed directorial segments to synthesize.");
    return;
  }

  const script_segments_count = active_loaded_project_state_object.directorialSegments.length;

  // WHAT: Force the backend queue to reset.
  // WHY: We are starting a fresh batch generation; any old pending tasks should be aborted.
  await window.audiobook_api.reset_stuck_queue();

  // WHAT: Clear out the active audioPath so the stitching progress panel starts at 0%.
  // WHY: We are generating new compiled takes. Old takes remain safe in audioVersions, but they are no longer active.
  for (let segment_counter = 0; segment_counter < script_segments_count; segment_counter++) {
    const segment_item = active_loaded_project_state_object.directorialSegments[segment_counter];
    segment_item.audioPath = null;
    if (segment_item.audioVersions) {
      for (let version_counter = 0; version_counter < segment_item.audioVersions.length; version_counter++) {
        segment_item.audioVersions[version_counter].isActive = false;
      }
    }
  }

  await trigger_project_state_disk_flush();
  populate_directorial_cards_in_editor_view();
  
  // WHAT: Registering all segments in the queue registry BEFORE dispatching.
  // WHY: Preserves the "processing" visual state during UI refreshes.
  for (let segment_counter = 0; segment_counter < script_segments_count; segment_counter++) {
    renderer_directorial_card_queue_status_registry[segment_counter] = {
      status: "processing",
      message: "Queueing..."
    };
    update_individual_directorial_card_synthesis_status_lights(segment_counter, "processing", "Queueing...");
  }
  
  for (let segment_counter = 0; segment_counter < script_segments_count; segment_counter++) {
    const segment_item = active_loaded_project_state_object.directorialSegments[segment_counter];
    if (!segment_item.audioVersions) {
      segment_item.audioVersions = [];
    }
    const next_take_number = segment_item.audioVersions.length + 1;

    await window.audiobook_api.enqueue_directorial_speech_generation_task(
      active_selected_workspace_directory_path,
      active_loaded_project_state_object.projectName,
      segment_item,
      active_loaded_project_state_object.voiceMapping || {},
      configuration_comfyui_api_url_address,
      next_take_number
    );
  }

  switch_active_navigation_tab("stitch");
}

// =========================================================================
// DIRECTORIAL STATE UPDATES & UTILITIES
// =========================================================================

// WHAT: Updating directorial card status indicators.
// WHY: Highlights completed synthesis runs in real-time in the new column panel.
function update_individual_directorial_card_synthesis_status_lights(index_position, status_string, custom_message_text) {
  const dot_light_element = document.getElementById(`directorial_synthesis_light_dot_${index_position}`);
  const status_label_element = document.getElementById(`directorial_synthesis_status_label_text_${index_position}`);
  const play_clip_button_element = document.getElementById(`btn_play_directorial_clip_${index_position}`);

  if (!dot_light_element || !status_label_element) {
    return;
  }

  dot_light_element.className = "status_dot";
  play_clip_button_element.style.display = "none";

  if (status_string === "completed") {
    dot_light_element.classList.add("state_completed");
    status_label_element.textContent = "Synthesized";
    status_label_element.style.color = "#4ade80";
    status_label_element.style.fontWeight = "600";
    play_clip_button_element.style.display = "flex";
  } else if (status_string === "processing") {
    dot_light_element.classList.add("state_processing");
    status_label_element.textContent = custom_message_text || "Synthesizing...";
    status_label_element.style.color = "var(--accent-cyber-gold)";
  } else if (status_string === "failed") {
    dot_light_element.classList.add("state_failed");
    status_label_element.textContent = custom_message_text || "Failed";
    status_label_element.style.color = "var(--accent-coral-red)";
  } else {
    status_label_element.textContent = "Idle";
    status_label_element.style.color = "#E0EFF1";
    status_label_element.style.fontWeight = "500";
  }
}

// WHAT: Manually resets all queue statuses across both screenplay and directorial cards, and clears the backend queue.
// WHY: Acts as the "manual boop" recovery tool. If ComfyUI disconnects, the app restarts, or statuses
//      become stuck on "processing" or "queued" forever, the user can press a button to force-clear
//      all in-flight tracking and rebuild every card's status from the ground truth (audioPath on disk).
// STYLE: Here is a friendly tutorial on how this function works:
//        We call the backend IPC handler to flush the Main Process's in-memory task queue and reset
//        its processing flag. Then we wipe both renderer-side status registries clean. Finally, we
//        trigger full DOM rebuilds of both card panels, which will now use only audioPath checks
//        (since the registries are empty) to determine completed vs idle status.
async function trigger_manual_queue_status_reset() {
  try {
    // WHAT: Calling the backend to clear the Main Process queue and reset its processing flag.
    // WHY: Ensures no orphaned tasks continue to run in the background after the reset.
    await window.audiobook_api.reset_stuck_queue();
  } catch (backend_reset_exception) {
    console.error("Failed to reset backend queue.", backend_reset_exception);
  }

  // WHAT: Wiping both renderer-side status registries completely.
  // WHY: Removes all cached "processing" / "queued" entries so the next DOM rebuild
  //      falls through to the clean audioPath-based status check for every card.
  renderer_card_queue_status_registry = {};
  renderer_directorial_card_queue_status_registry = {};

  // WHAT: Rebuilding both card panels from scratch with clean status states.
  // WHY: Since the registries are now empty, every card will show "completed" (if audioPath exists)
  //      or "idle" (if no audio has been generated yet). No stuck indicators will survive.
  if (active_loaded_project_state_object) {
    populate_screenplay_cards_in_editor_view();
    populate_directorial_cards_in_editor_view();
    refresh_synthesis_progress_tracking_meters();
  }

  console.log("[Queue Reset] All queue statuses have been manually reset.");
}

// WHAT: Plays synthesized speech clips in the editor page using local browser audio elements.
// WHY: Allows the user to check character voice outputs immediately.
// STYLE: instructional friendly tutorial.
function play_individual_directorial_line_clip(index_position_of_card) {
  // WHAT: Verifying system workspace state parameters.
  // WHY: Ensures paths can be resolved before loading audio files from local disk.
  if (!active_loaded_project_state_object || !active_selected_workspace_directory_path) {
    return;
  }

  // WHAT: Loading script segment details.
  // WHY: Used to check version lists and active audio take markers.
  const targeted_segment_item = active_loaded_project_state_object.directorialSegments[index_position_of_card];
  
  let absolute_audio_path_to_play = null;

  // WHAT: Resolving the target file path dynamically.
  // WHY: We attempt to load the path directly from the selected active version take's absolute path
  //      to support legacy layouts and new structured subfolders seamlessly.
  if (targeted_segment_item.audioVersions && targeted_segment_item.audioVersions.length > 0) {
    for (let version_counter = 0; version_counter < targeted_segment_item.audioVersions.length; version_counter++) {
      const take_version_item = targeted_segment_item.audioVersions[version_counter];
      if (take_version_item.isActive && take_version_item.filePath) {
        absolute_audio_path_to_play = take_version_item.filePath;
        break;
      }
    }
  }

  // WHAT: Fallback to segment's main audioPath.
  // WHY: Serves as backup if versions list mapping was delayed or empty.
  if (!absolute_audio_path_to_play && targeted_segment_item.audioPath) {
    absolute_audio_path_to_play = targeted_segment_item.audioPath;
  }

  // WHAT: Constructing fallback default absolute path (backward-compatibility).
  // WHY: If no paths exist, compiles typical directorial take folder structures.
  if (!absolute_audio_path_to_play) {
    const default_filename = `line_directorial_${index_position_of_card}.wav`;
    absolute_audio_path_to_play = `${active_selected_workspace_directory_path}/${active_loaded_project_state_object.projectName}/audio/${default_filename}`;
  }

  // WHAT: Expand relative paths to absolute paths.
  // WHY: Binds relative properties to active workspace directories.
  if (absolute_audio_path_to_play && !absolute_audio_path_to_play.includes(":") && !absolute_audio_path_to_play.startsWith("/") && !absolute_audio_path_to_play.startsWith("\\")) {
    absolute_audio_path_to_play = `${active_selected_workspace_directory_path}/${active_loaded_project_state_object.projectName}/${absolute_audio_path_to_play}`;
  }

  // WHAT: Convert the absolute path to a safe, normalized file:/// URL.
  // WHY: Electron requires safe file protocol prefixes to stream local media cleanly.
  const normalized_absolute_path = absolute_audio_path_to_play.replace(/\\/g, "/").replace(/^\/+/, "");
  const source_audio_file_path = `file:///${normalized_absolute_path}?t=${Date.now()}`;
  
  // WHAT: Fetching or creating html5 audio player elements.
  // WHY: Standard browser plays standard wav/mp3 clips easily without visual overlays.
  let clip_player_node = document.getElementById("html5_segment_audio_player");
  if (!clip_player_node) {
    clip_player_node = document.createElement("audio");
    clip_player_node.id = "html5_segment_audio_player";
    clip_player_node.style.display = "none";
    document.body.appendChild(clip_player_node);
  }

  // WHAT: Dispatching local play request.
  // WHY: Loads audio stream and fires playback event, throwing clean catch blocks if missing.
  clip_player_node.src = source_audio_file_path;
  clip_player_node.play().catch((audio_failure_exception) => {
    console.error("Failed to play directorial segment audio clip file.", audio_failure_exception);
    alert("Audio clip file not accessible. Please ensure it was synthesized correctly.");
  });
}

// =========================================================================
// CUSTOM CONTEXT MENU FOR CELLS (COMBINE / INSERT)
// =========================================================================

let active_context_menu_target_index = null;
let active_context_menu_is_directorial = false;

// WHAT: Global right-click event listener to hijack default context menus on cell cards.
// WHY: Displays our custom contextual actions for cell manipulation using the native OS popup menu.
document.addEventListener("contextmenu", async function (mouse_event) {
  const clicked_card_node = mouse_event.target.closest(".screenplay_item_card, .directorial_item_card");
  
  if (clicked_card_node) {
    mouse_event.preventDefault();

    // Determine the cell properties based on ID
    const card_id_string = clicked_card_node.id;
    if (card_id_string.startsWith("directorial_card_node_")) {
      active_context_menu_is_directorial = true;
      active_context_menu_target_index = parseInt(card_id_string.replace("directorial_card_node_", ""), 10);
    } else if (card_id_string.startsWith("screenplay_card_node_")) {
      active_context_menu_is_directorial = false;
      active_context_menu_target_index = parseInt(card_id_string.replace("screenplay_card_node_", ""), 10);
    }

    // Trigger native OS popup menu and wait for selection
    const action_result = await window.audiobook_api.show_native_context_menu();
    
    if (action_result) {
      if (action_result === 'above' || action_result === 'below') {
        execute_cell_combine_action(action_result);
      } else if (action_result === 'insert_above' || action_result === 'insert_below') {
        execute_cell_insert_action(action_result.replace('insert_', ''));
      } else if (action_result === 'split_at_quote') {
        execute_cell_split_at_quote_action();
      } else if (action_result === 'ai_split') {
        execute_cell_ai_split_action();
      }
    }
  }
});

// =========================================================================
// SPLIT CELL AT QUOTE - DIALOGUE / NARRATOR SEPARATOR
// =========================================================================

// WHAT: Splits a single mixed cell into two separate cells at a quotation mark boundary.
// WHY: When the LLM returns a line like "Oh no," said Kin as a single block,
//      the user can right-click and cleanly separate it into:
//        - Cell 1 (dialogue): Oh no,
//        - Cell 2 (narrator): said Kin
//      without manually duplicating text or losing content.
async function execute_cell_split_at_quote_action() {
  if (active_context_menu_target_index === null || !active_loaded_project_state_object) return;

  const segment_list = active_context_menu_is_directorial
    ? active_loaded_project_state_object.directorialSegments
    : active_loaded_project_state_object.scriptSegments;

  const current_index = active_context_menu_target_index;
  const source_segment = segment_list[current_index];

  if (!source_segment) return;
  // WHAT: Normalizing smart quotes to standard straight quotes before splitting.
  // WHY: Books commonly use typographic curly quotes which would prevent the regex from matching.
  const normalized_source_text = (source_segment.text || "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  // WHAT: Deterministically splitting the cell by all quotation mark boundaries.
  // WHY: Instantly separates complex multi-quote lines (e.g., Narrator -> Quote -> Narrator -> Quote) into distinct cards without relying on AI.
  const quote_delimited_parts = normalized_source_text.split(/("[^"]*")/g).filter(p => p.trim() !== "");

  if (quote_delimited_parts.length <= 1) {
    // WHAT: Alerting the user if no distinct split boundaries were found.
    alert('Quick Split failed.\n\nNo quotation boundaries were found. Ensure your dialogue is wrapped in quotes.');
    return;
  }

  // WHAT: Creating a new list of segmented cards.
  const new_split_cards = [];

  for (let quote_delimited_part_index = 0; quote_delimited_part_index < quote_delimited_parts.length; quote_delimited_part_index++) {
    const raw_text_part = quote_delimited_parts[quote_delimited_part_index].trim();
    if (!raw_text_part) continue;

    // Detect if this specific part is wrapped in quotes
    const is_dialogue_block = raw_text_part.startsWith('"') && raw_text_part.endsWith('"');
    
    // Construct the new card structure
    new_split_cards.push({
      index_position: 0, // Re-mapped during rendering
      type: is_dialogue_block ? "dialogue" : "narrator",
      speaker: is_dialogue_block ? (source_segment.speaker || "Unknown") : "Narrator",
      text: is_dialogue_block ? raw_text_part.replace(/^"|"$/g, '').trim() : raw_text_part,
      direction: source_segment.direction || (is_dialogue_block ? "steady delivery" : "neutral attribution tone"),
      audioPath: null,
      audioVersions: []
    });
  }

  // WHAT: Replacing the original source segment with the new array of split cards.
  // WHY: splice(index, 1, ...items) removes the original cell and injects all the new pieces sequentially in its place.
  segment_list.splice(current_index, 1, ...new_split_cards);

  await trigger_project_state_disk_flush();

  if (active_context_menu_is_directorial) {
    populate_directorial_cards_in_editor_view();
  } else {
    populate_screenplay_cards_in_editor_view();
  }
}

// WHAT: Merges the current cell's text into an adjacent cell, then deletes the current cell.
// WHY: Lets users quickly fix segmentation errors (e.g. narrator lines that should be grouped).
async function execute_cell_combine_action(direction_string) {
  if (active_context_menu_target_index === null || !active_loaded_project_state_object) return;

  const segment_list = active_context_menu_is_directorial 
    ? active_loaded_project_state_object.directorialSegments 
    : active_loaded_project_state_object.scriptSegments;

  const current_index = active_context_menu_target_index;
  let target_index = null;

  if (direction_string === 'above' && current_index > 0) {
    target_index = current_index - 1;
  } else if (direction_string === 'below' && current_index < segment_list.length - 1) {
    target_index = current_index + 1;
  }

  if (target_index !== null) {
    const cell1_index = direction_string === 'above' ? target_index : current_index;
    const cell2_index = direction_string === 'above' ? current_index : target_index;
    const cell1 = segment_list[cell1_index];
    const cell2 = segment_list[cell2_index];

    // WHAT: If both cells contain Qwen style objects, we offer the user an AI Smart Merge.
    // WHY: Smooths out narrative transitions using LLM instead of abruptly cutting styles.
    if (cell1.qwen_style && cell2.qwen_style) {
      const transition_instructions = prompt(
        "AI Smart Style Merge\n\nProvide transition instructions for LLM to blend the performance styles:\n(Leave blank to skip AI and merge text only)",
        "Smoothly blend the emotion and narrative flow."
      );

      if (transition_instructions) {
        try {
          document.body.style.cursor = 'wait';
          const merged_style = await window.audiobook_api.trigger_style_merge_via_llm(
            cell1.text, cell1.qwen_style,
            cell2.text, cell2.qwen_style,
            transition_instructions,
            configuration_lm_studio_api_url_address
          );

          if (merged_style) {
            cell1.qwen_style = merged_style;
          }
        } catch (error) {
          alert(`Smart Style Merge failed: ${error.message}\nFalling back to text-only merge.`);
        } finally {
          document.body.style.cursor = 'default';
        }
      }
    }

    // Append the text based on direction
    if (direction_string === 'above') {
      segment_list[target_index].text = segment_list[target_index].text.trim() + " " + segment_list[current_index].text.trim();
      segment_list.splice(current_index, 1);
    } else {
      segment_list[current_index].text = segment_list[current_index].text.trim() + " " + segment_list[target_index].text.trim();
      segment_list.splice(target_index, 1);
    }

    await trigger_project_state_disk_flush();

    if (active_context_menu_is_directorial) {
      populate_directorial_cards_in_editor_view();
    } else {
      populate_screenplay_cards_in_editor_view();
    }
  }
}

// WHAT: Injects a brand new, empty cell before or after the target row.
// WHY: Lets users manually append forgotten lines or inject fresh dialogue breaks locally.
async function execute_cell_insert_action(direction_string) {
  if (active_context_menu_target_index === null || !active_loaded_project_state_object) return;

  const segment_list = active_context_menu_is_directorial 
    ? active_loaded_project_state_object.directorialSegments 
    : active_loaded_project_state_object.scriptSegments;

  const current_index = active_context_menu_target_index;
  const insertion_index = direction_string === 'above' ? current_index : current_index + 1;

  // Clone a default segment blueprint
  const new_segment_blueprint = {
    index_position: 0, // Gets re-mapped on render
    type: "narrator",
    speaker: "Narrator",
    text: "",
    direction: "default delivery",
    audioPath: null,
    audioVersions: []
  };

  // If directorial, add the extra triple-input delivery traits
  if (active_context_menu_is_directorial) {
    new_segment_blueprint.intent = "Default subtext";
    new_segment_blueprint.delivery = {
      pitch: "medium", pacing: "normal", volume: "normal", style_label: "neutral",
      emotion_vector: { happiness: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0, neutral: 1, other: 0 }
    };
  }

  segment_list.splice(insertion_index, 0, new_segment_blueprint);

  await trigger_project_state_disk_flush();

  if (active_context_menu_is_directorial) {
    populate_directorial_cards_in_editor_view();
  } else {
    populate_screenplay_cards_in_editor_view();
  }
}

// =========================================================================
// AUK AUDIO EDITING SUITE CONTROLLER
// =========================================================================

// WHAT: Global context holding reference to the active script card being edited with AuK tools.
// WHY: We need to know which line, which take, and whether it's directorial when applying the audio transform.
let active_auk_editing_target_context = null;

// WHAT: Opens the AuK Audio Editing Suite modal for a specific take on a card.
// WHY: Gives the user access to whisper conversion, pitch shift, speed adjust, denoise, and emotion morphing.
function open_auk_edit_tools_modal(segment_index_position, is_directorial_flag) {
  const segment_collection = is_directorial_flag
    ? active_loaded_project_state_object.directorialSegments
    : active_loaded_project_state_object.scriptSegments;

  const target_script_segment = segment_collection[segment_index_position];
  if (!target_script_segment || !target_script_segment.audioVersions || target_script_segment.audioVersions.length === 0) {
    alert("No generated audio take exists for this line yet. Please synthesize the line first.");
    return;
  }

  const active_take_number = target_script_segment.activeTake || 1;
  const active_take_file_path = target_script_segment.audioVersions[active_take_number - 1] || target_script_segment.audioVersions[0];

  active_auk_editing_target_context = {
    segment_index_position: segment_index_position,
    is_directorial_flag: is_directorial_flag,
    source_take_file_path: active_take_file_path,
    active_take_number: active_take_number,
    speaker_name: target_script_segment.speaker,
    segment_text: target_script_segment.text
  };

  const subtitle_element = document.getElementById("modal_auk_edit_subtitle");
  if (subtitle_element) {
    subtitle_element.textContent = `Line #${segment_index_position + 1} (${target_script_segment.speaker}) - Editing Take ${active_take_number}`;
  }

  const status_message_element = document.getElementById("modal_auk_edit_status_message");
  if (status_message_element) {
    status_message_element.textContent = "";
  }

  const execute_button = document.getElementById("btn_execute_auk_edit");
  if (execute_button) {
    execute_button.disabled = false;
    execute_button.textContent = "Apply Transformation";
  }

  // Pre-fill speech content original text
  const original_phrase_input = document.getElementById("input_auk_speech_content_original");
  if (original_phrase_input) {
    original_phrase_input.value = target_script_segment.text;
  }

  // Set default selection to whisper
  const task_dropdown = document.getElementById("modal_auk_edit_task_dropdown");
  if (task_dropdown) {
    task_dropdown.value = "whisper";
    handle_auk_edit_task_selection_change("whisper");
  }

  const modal_overlay = document.getElementById("auk_edit_tools_modal");
  if (modal_overlay) {
    modal_overlay.classList.remove("d-none");
  }
}

// WHAT: Closes the AuK Audio Editing Suite modal and cleans up target context.
// WHY: Resets state and returns focus to the screenplay storyboard.
function close_auk_edit_tools_modal() {
  const modal_overlay = document.getElementById("auk_edit_tools_modal");
  if (modal_overlay) {
    modal_overlay.classList.add("d-none");
  }
  active_auk_editing_target_context = null;
}

// WHAT: Dynamically reveals parameter controls corresponding to the chosen AuK edit task.
// WHY: Pitch needs semitone sliders, Speed needs tempo multipliers, Emotion needs emotion select, etc.
function handle_auk_edit_task_selection_change(selected_task_identifier) {
  const list_of_control_containers = [
    "auk_control_pitch",
    "auk_control_speed",
    "auk_control_volume",
    "auk_control_emotion",
    "auk_control_speech_content"
  ];

  for (let control_index = 0; control_index < list_of_control_containers.length; control_index++) {
    const container_element = document.getElementById(list_of_control_containers[control_index]);
    if (container_element) {
      container_element.classList.add("d-none");
    }
  }

  switch (selected_task_identifier) {
    case "pitch":
      document.getElementById("auk_control_pitch")?.classList.remove("d-none");
      break;
    case "speed":
      document.getElementById("auk_control_speed")?.classList.remove("d-none");
      break;
    case "volume":
      document.getElementById("auk_control_volume")?.classList.remove("d-none");
      break;
    case "emotion":
      document.getElementById("auk_control_emotion")?.classList.remove("d-none");
      break;
    case "speech_content":
      document.getElementById("auk_control_speech_content")?.classList.remove("d-none");
      break;
    default:
      // Presets like whisper, enhance, deaccent don't require manual sliders
      break;
  }
}

// WHAT: Executes the active AuK audio editing task via IPC and updates the project state with a new take.
// WHY: Coordinates backend ComfyUI processing, creates an incremental take file, and auto-selects it in the UI.
async function execute_active_auk_edit_task() {
  if (!active_auk_editing_target_context) {
    return;
  }

  const task_dropdown = document.getElementById("modal_auk_edit_task_dropdown");
  const selected_task_identifier = task_dropdown ? task_dropdown.value : "whisper";

  let resolved_parameter_value = "";
  let resolved_secondary_value = "";

  switch (selected_task_identifier) {
    case "pitch": {
      const semitones_value = document.getElementById("input_auk_pitch_semitones")?.value || "2";
      resolved_parameter_value = (Number(semitones_value) > 0 ? "+" : "") + semitones_value;
      break;
    }
    case "speed": {
      resolved_parameter_value = document.getElementById("input_auk_speed_multiplier")?.value || "1.15";
      break;
    }
    case "volume": {
      const volume_db_value = document.getElementById("input_auk_volume_decibels")?.value || "3";
      resolved_parameter_value = (Number(volume_db_value) > 0 ? "+" : "") + volume_db_value;
      break;
    }
    case "emotion": {
      resolved_parameter_value = document.getElementById("select_auk_target_emotion")?.value || "sad";
      break;
    }
    case "speech_content": {
      resolved_parameter_value = document.getElementById("input_auk_speech_content_instruction")?.value || "";
      resolved_secondary_value = document.getElementById("input_auk_speech_content_original")?.value || "";
      break;
    }
    default:
      resolved_parameter_value = "";
      break;
  }

  const execute_button = document.getElementById("btn_execute_auk_edit");
  const status_message_element = document.getElementById("modal_auk_edit_status_message");

  if (execute_button) {
    execute_button.disabled = true;
    execute_button.textContent = "Processing with AuK...";
  }
  if (status_message_element) {
    status_message_element.textContent = "Sending workflow to ComfyUI...";
  }

  try {
    const edit_request_payload = {
      workspace_directory_path: active_selected_workspace_directory_path,
      project_name: active_loaded_project_state_object.projectName,
      is_directorial: active_auk_editing_target_context.is_directorial_flag,
      index_position: active_auk_editing_target_context.segment_index_position,
      source_take_file_path: active_auk_editing_target_context.source_take_file_path,
      edit_task_identifier: selected_task_identifier,
      edit_parameter_value: resolved_parameter_value,
      secondary_parameter_value: resolved_secondary_value,
      comfyui_api_url_address: configuration_comfyui_api_url_address
    };

    const edit_response_result = await window.audiobook_api.apply_auk_audio_edit(edit_request_payload);

    if (edit_response_result && edit_response_result.success) {
      // WHAT: Append new take file to the script segment's audioVersions list.
      // WHY: Preserves all previous takes and makes the new edited take immediately available.
      const segment_collection = active_auk_editing_target_context.is_directorial_flag
        ? active_loaded_project_state_object.directorialSegments
        : active_loaded_project_state_object.scriptSegments;

      const target_segment = segment_collection[active_auk_editing_target_context.segment_index_position];
      if (target_segment) {
        if (!target_segment.audioVersions) {
          target_segment.audioVersions = [];
        }
        target_segment.audioVersions.push(edit_response_result.filePath);
        target_segment.activeTake = edit_response_result.newTakeNumber;
        target_segment.audioPath = edit_response_result.filePath;
      }

      // WHAT: Persist project state to local disk.
      await trigger_project_state_disk_flush();

      // WHAT: Re-render card storyboards so take pill dropdowns and play buttons reflect the new take.
      if (active_auk_editing_target_context.is_directorial_flag) {
        populate_directorial_cards_in_editor_view();
      } else {
        populate_screenplay_cards_in_editor_view();
      }

      close_auk_edit_tools_modal();

      // Automatically play the freshly edited take
      const audio_element = document.getElementById("master_hidden_audio_player");
      if (audio_element) {
        const audio_playback_promise = audio_element.play();
        if (audio_playback_promise && typeof audio_playback_promise.catch === "function") {
          audio_playback_promise.catch(() => {});
        }
      }
    } else {
      if (status_message_element) {
        status_message_element.textContent = `Edit failed: ${edit_response_result.error || "Unknown error"}`;
      }
      if (execute_button) {
        execute_button.disabled = false;
        execute_button.textContent = "Apply Transformation";
      }
    }
  } catch (execution_error) {
    console.error("Failed to execute AuK edit:", execution_error);
    if (status_message_element) {
      status_message_element.textContent = `Error: ${execution_error.message}`;
    }
    if (execute_button) {
      execute_button.disabled = false;
      execute_button.textContent = "Apply Transformation";
    }
  }
}

// =========================================================================
// CELL WORKFLOW OVERRIDE MODAL CONTROLLER
// =========================================================================

// WHAT: Global context tracking which script cell is being configured for workflow overrides.
let active_cell_workflow_override_context = null;

// WHAT: Opens the workflow configuration modal for a specific line card.
// WHY: Allows the user to override synthesis engine (e.g. AuK Voice Clone, Qwen Design, Qwen Custom) on a per-cell basis.
function open_cell_workflow_config_modal(segment_index_position, is_directorial_flag) {
  const segment_collection = is_directorial_flag
    ? active_loaded_project_state_object.directorialSegments
    : active_loaded_project_state_object.scriptSegments;

  const target_segment = segment_collection[segment_index_position];
  if (!target_segment) {
    return;
  }

  active_cell_workflow_override_context = {
    segment_index_position: segment_index_position,
    is_directorial_flag: is_directorial_flag
  };

  const modal_title_element = document.getElementById("modal_config_title");
  if (modal_title_element) {
    modal_title_element.textContent = `Workflow Config: Line #${segment_index_position + 1}`;
  }

  const modal_subtitle_element = document.getElementById("modal_config_subtitle");
  if (modal_subtitle_element) {
    modal_subtitle_element.textContent = `Configure active synthesis engine for ${target_segment.speaker}`;
  }

  const existing_override = target_segment.workflowOverride || {};
  const workflow_dropdown = document.getElementById("modal_workflow_type_dropdown");
  if (workflow_dropdown) {
    workflow_dropdown.value = existing_override.workflowType || "inherit";
    handle_modal_workflow_type_change(workflow_dropdown.value);
  }

  const seed_input = document.getElementById("modal_synthesis_seed_field");
  if (seed_input) {
    seed_input.value = existing_override.seed || "";
  }

  const modal_overlay = document.getElementById("workflow_settings_modal");
  if (modal_overlay) {
    modal_overlay.classList.remove("d-none");
  }
}

// WHAT: Closes the workflow configuration modal and saves the override settings.
// WHY: Persists changes to project_state.json and refreshes card badges.
async function close_workflow_settings_modal() {
  if (active_cell_workflow_override_context && active_loaded_project_state_object) {
    const segment_collection = active_cell_workflow_override_context.is_directorial_flag
      ? active_loaded_project_state_object.directorialSegments
      : active_loaded_project_state_object.scriptSegments;

    const target_segment = segment_collection[active_cell_workflow_override_context.segment_index_position];
    if (target_segment) {
      const workflow_dropdown = document.getElementById("modal_workflow_type_dropdown");
      const seed_input = document.getElementById("modal_synthesis_seed_field");

      const selected_workflow = workflow_dropdown ? workflow_dropdown.value : "inherit";
      const selected_seed = seed_input && seed_input.value ? Number(seed_input.value) : null;

      if (!target_segment.workflowOverride) {
        target_segment.workflowOverride = {};
      }
      target_segment.workflowOverride.workflowType = selected_workflow;
      if (selected_seed !== null) {
        target_segment.workflowOverride.seed = selected_seed;
      }

      await trigger_project_state_disk_flush();

      if (active_cell_workflow_override_context.is_directorial_flag) {
        populate_directorial_cards_in_editor_view();
      } else {
        populate_screenplay_cards_in_editor_view();
      }
    }
  }

  const modal_overlay = document.getElementById("workflow_settings_modal");
  if (modal_overlay) {
    modal_overlay.classList.add("d-none");
  }
  active_cell_workflow_override_context = null;
}

// WHAT: Responds to changing the workflow dropdown in the modal.
// WHY: Reveals or hides workflow-specific override sections (Design prompt, clone emotion target).
function handle_modal_workflow_type_change(selected_workflow_type) {
  const design_section = document.getElementById("modal_qwen_design_override_section");
  const clone_section = document.getElementById("modal_qwen_clone_override_section");

  if (design_section) {
    design_section.classList.toggle("d-none", selected_workflow_type !== "design");
  }
  if (clone_section) {
    clone_section.classList.toggle("d-none", selected_workflow_type !== "clone");
  }
}

// WHAT: Randomizes the seed value in the workflow modal.
// WHY: Quick shortcut for creators auditioning different acoustic variations.
function randomize_modal_synthesis_seed() {
  const seed_input = document.getElementById("modal_synthesis_seed_field");
  if (seed_input) {
    seed_input.value = Math.floor(Math.random() * 9000000000) + 100000;
  }
}

// WHAT: Switches between Workflow and Emotion Library tabs in the workflow modal.
// WHY: Organizes settings logically without UI clutter.
function switch_modal_tab(target_tab_identifier) {
  const workflow_tab_btn = document.getElementById("tab_btn_workflow");
  const references_tab_btn = document.getElementById("tab_btn_references");
  const workflow_content = document.getElementById("modal_content_workflow");
  const references_content = document.getElementById("modal_content_references");

  if (target_tab_identifier === "workflow") {
    workflow_tab_btn?.classList.add("active_tab");
    references_tab_btn?.classList.remove("active_tab");
    workflow_content?.classList.add("active_content");
    workflow_content?.classList.remove("d-none");
    references_content?.classList.remove("active_content");
    references_content?.classList.add("d-none");
  } else {
    references_tab_btn?.classList.add("active_tab");
    workflow_tab_btn?.classList.remove("active_tab");
    references_content?.classList.add("active_content");
    references_content?.classList.remove("d-none");
    workflow_content?.classList.remove("active_content");
    workflow_content?.classList.add("d-none");
  }
}

// WHAT: Registers real-time attribution progress listener when renderer loads.
// WHY: Ensures progress events from Laya/CLM/LLM immediately update the UI.
if (typeof window !== "undefined") {
  const register_attribution_listener = () => {
    if (window.audiobook_api && typeof window.audiobook_api.subscribe_to_attribution_progress === "function") {
      window.audiobook_api.subscribe_to_attribution_progress((progress_payload) => {
        handle_incoming_attribution_progress_update(progress_payload);
      });
    }
  };
  if (typeof document !== "undefined" && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", register_attribution_listener);
  } else {
    register_attribution_listener();
  }
}

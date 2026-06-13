// =========================================================================
// GLOBAL CORE APPLICATION STATES
// =========================================================================

// WHAT: Storing absolute path to workspace directory selected by user.
// WHY: We need to know where the parent projects folder is located to query and build project state JSONs.
let active_selected_workspace_directory_path = null;

// WHAT: Storing the active, currently loaded project's JSON state data.
// WHY: Contains character maps, voice parameters, raw text blocks, and parsed segments for editing and synthesis.
let active_loaded_project_state_object = null;

// WHAT: Storing standard API access routes.
// WHY: We deliberately use 127.0.0.1 instead of "localhost" here.
//      Node.js v17+ resolves "localhost" as IPv6 (::1) by default, but LM Studio
//      and ComfyUI listen on IPv4 (0.0.0.0 / 127.0.0.1). Using the literal IP
//      guarantees the TCP handshake always hits the correct network stack.
let configuration_lm_studio_api_url_address = "http://127.0.0.1:1234/v1/chat/completions";
let configuration_comfyui_api_url_address = "http://127.0.0.1:8188";

// =========================================================================
// NAVIGATIONAL SYSTEM - TAB SWITCHING
// =========================================================================

// WHAT: Transitioning visual viewports based on tab selections.
// WHY: Gives the user access to distinct phases (editing, casting, stitching) in a single-page view layout.
function switch_active_navigation_tab(target_viewport_identifier_name) {
  // WHAT: Gathering all view panels.
  // WHY: We iterate to hide inactive panels and reveal the target one.
  const list_of_content_viewport_panes = document.querySelectorAll(".content_view_pane");
  for (let index_counter = 0; index_counter < list_of_content_viewport_panes.length; index_counter++) {
    const viewport_element = list_of_content_viewport_panes[index_counter];
    viewport_element.classList.remove("active_view");
  }

  // WHAT: Hiding all sidebar highlights.
  // WHY: Resets navigation tabs styles.
  const list_of_navigation_sidebar_links = document.querySelectorAll(".navigation_link_item");
  for (let index_counter = 0; index_counter < list_of_navigation_sidebar_links.length; index_counter++) {
    const sidebar_link_element = list_of_navigation_sidebar_links[index_counter];
    sidebar_link_element.classList.remove("active_nav_tab");
  }

  // WHAT: Activating the selected content pane viewport.
  // WHY: Reveals the active page visually.
  const target_viewport_pane_element = document.getElementById(`viewport_${target_viewport_identifier_name}`);
  if (target_viewport_pane_element) {
    target_viewport_pane_element.classList.add("active_view");
  }

  // WHAT: Activating the selected sidebar link highlight.
  // WHY: Highlights the active page tab in the sidebar navigation UI.
  const target_sidebar_link_item_element = document.getElementById(`nav_link_${target_viewport_identifier_name}`);
  if (target_sidebar_link_item_element) {
    target_sidebar_link_item_element.classList.add("active_nav_tab");
  }

  // WHAT: Changing the view title banner dynamically.
  // WHY: Reflects the active tab phase in the top navigation panel.
  const top_navbar_header_title_element = document.getElementById("active_page_navbar_title");
  if (top_navbar_header_title_element) {
    const formatted_title_string = target_viewport_identifier_name.charAt(0).toUpperCase() + target_viewport_identifier_name.slice(1);
    top_navbar_header_title_element.textContent = `${formatted_title_string} Panel`;
  }

  // WHAT: Toggling editor-specific layout controls.
  // WHY: Ensures column visibility toggles are only present when the script storyboard is active.
  const editor_layout_toggles = document.getElementById("editor_layout_toggles");
  const btn_reset_queue = document.getElementById("btn_reset_queue");
  if (editor_layout_toggles) {
    editor_layout_toggles.style.display = (target_viewport_identifier_name === "editor") ? "flex" : "none";
  }
  if (btn_reset_queue) {
    btn_reset_queue.style.display = (target_viewport_identifier_name === "editor") ? "flex" : "none";
  }
}

// =========================================================================
// SYSTEM BOOT & PERSISTENT CONFIGURATION LOADER
// =========================================================================

// WHAT: Run initial bootstrap settings loading on page startup.
// WHY: Ensures user defaults (API paths, mock selections) carry over consistently upon launch.
window.addEventListener("DOMContentLoaded", () => {
  // WHAT: Reading stored settings from browser localStorage database.
  // WHY: Allows preserving paths across sessions without maintaining external files.
  let cached_lm_studio_endpoint = localStorage.getItem("setting_lm_studio_url");
  let cached_comfyui_endpoint = localStorage.getItem("setting_comfyui_url");
  const cached_workspace_path = localStorage.getItem("setting_active_workspace_path");

  // WHAT: Normalizing any stale "localhost" strings from cached localStorage entries.
  // WHY: The user may have saved settings in a previous session that used "localhost".
  //      We rewrite those to "127.0.0.1" immediately so the save_global_configurations
  //      call below builds correct IPv4-safe URLs from the first millisecond of boot.
  if (cached_lm_studio_endpoint) {
    cached_lm_studio_endpoint = cached_lm_studio_endpoint.replace(/^(https?:\/\/)localhost/i, "$1127.0.0.1");
  }
  if (cached_comfyui_endpoint) {
    cached_comfyui_endpoint = cached_comfyui_endpoint.replace(/^(https?:\/\/)localhost/i, "$1127.0.0.1");
  }

  if (cached_lm_studio_endpoint) {
    document.getElementById("settings_lm_studio_endpoint_input").value = cached_lm_studio_endpoint;
  }
  if (cached_comfyui_endpoint) {
    document.getElementById("settings_comfyui_endpoint_input").value = cached_comfyui_endpoint;
  }

  // WHAT: Calling settings parsing immediately.
  // WHY: Syncs javascript variables with visual defaults on DOM setup.
  save_global_configurations();

  // WHAT: Auto-loading the last used workspace folder if stored in local database.
  // WHY: Saves the user from manually re-selecting their workspace directory on every app boot.
  if (cached_workspace_path) {
    active_selected_workspace_directory_path = cached_workspace_path;
    document.getElementById("active_workspace_directory_display_label").textContent = cached_workspace_path;
    document.getElementById("sidebar_active_workspace_name").textContent = cached_workspace_path.split(/[\\/]/).pop();
    
    // WHAT: Scanning the recovered workspace folder for projects.
    // WHY: Populates the dashboard project grid automatically on launch.
    refresh_existing_projects_grid_list();
  }

  // WHAT: Subscribing to main queue updates via the preload bridge listener.
  // WHY: Listens for background WAV synthesizers and updates card indicators dynamically.
  window.audiobook_api.subscribe_to_generation_status_updates((synthesis_progress_update_payload) => {
    handle_incoming_synthesis_progress_updates(synthesis_progress_update_payload);
  });

  // WHAT: Subscribing to LM Studio warnings.
  // WHY: Surfaces API context warnings or model fallbacks directly into the sidebar UI.
  window.audiobook_api.subscribe_to_lm_studio_warnings((warning_message_string) => {
    const warning_container = document.getElementById("sidebar_lm_warning_container");
    const warning_text = document.getElementById("sidebar_lm_warning_text");
    if (warning_container && warning_text) {
      warning_text.textContent = warning_message_string;
      warning_container.style.display = "flex";
      
      // Auto-hide the warning after 15 seconds to keep the UI clean
      setTimeout(() => {
        warning_container.style.display = "none";
      }, 15000);
    }
  });
});

// WHAT: Parsing and persisting changes to system inputs (ports, modes).
// WHY: Instantly binds variable flags whenever user alters visual inputs.
function save_global_configurations() {
  const lm_studio_raw_address_value = document.getElementById("settings_lm_studio_endpoint_input").value.trim();
  const comfyui_raw_address_value = document.getElementById("settings_comfyui_endpoint_input").value.trim();

  // WHAT: Normalizing "localhost" to the literal IPv4 loopback address "127.0.0.1".
  // WHY: Node.js v17+ changed DNS resolution so that "localhost" resolves to the
  //      IPv6 address ::1 first. LM Studio and ComfyUI only bind to IPv4, so the
  //      connection is refused unless we use the literal 127.0.0.1 string instead.
  const normalized_lm_studio_address = lm_studio_raw_address_value.replace(
    /^(https?:\/\/)localhost/i,
    "$1127.0.0.1"
  );
  const normalized_comfyui_address = comfyui_raw_address_value.replace(
    /^(https?:\/\/)localhost/i,
    "$1127.0.0.1"
  );

  // WHAT: Transforming raw inputs to clean endpoints.
  // WHY: Standardizes URL paths for our node HTTP requests.
  configuration_lm_studio_api_url_address = `${normalized_lm_studio_address}/chat/completions`;
  configuration_comfyui_api_url_address = normalized_comfyui_address;

  // WHAT: Backing up configuration parameters to browser memory blocks.
  // WHY: Preserves selections next time application boots.
  localStorage.setItem("setting_lm_studio_url", normalized_lm_studio_address);
  localStorage.setItem("setting_comfyui_url", normalized_comfyui_address);
}

// =========================================================================
// PROJECT METRIC MANAGERS - DISK BRIDGE
// =========================================================================

// WHAT: Launches the native operating system file dialogue to pick projects workspace.
// WHY: Native folders maintain user files safely and let the user access raw book files easily.
async function trigger_native_folder_picker() {
  try {
    const selected_folder_directory_path = await window.audiobook_api.select_workspace_directory();
    
    if (selected_folder_directory_path) {
      active_selected_workspace_directory_path = selected_folder_directory_path;
      
      // WHAT: Modifying visual directory indicators.
      // WHY: Displays absolute paths to chosen project areas in the dashboard.
      document.getElementById("active_workspace_directory_display_label").textContent = selected_folder_directory_path;
      document.getElementById("sidebar_active_workspace_name").textContent = selected_folder_directory_path.split(/[\\/]/).pop();

      // WHAT: Saving chosen workspace path to browser local persistent memory.
      // WHY: Ensures the application remembers this workspace folder automatically on next startup.
      localStorage.setItem("setting_active_workspace_path", selected_folder_directory_path);

      // WHAT: Querying and displaying existing projects in folder.
      // WHY: Dynamically builds card grids for saved books.
      refresh_existing_projects_grid_list();
    }
  } catch (dialogue_launch_exception) {
    console.error("Failed to select workspace folder directory path.", dialogue_launch_exception);
  }
}

// WHAT: Scans selected directory and populates visual list cards.
// WHY: Displays initialized books and allows switching between projects.
async function refresh_existing_projects_grid_list() {
  const cards_grid_wrapper_element = document.getElementById("project_selection_cards_grid");
  
  if (!active_selected_workspace_directory_path) {
    return;
  }

  try {
    // WHAT: Calling preload bridge to read subfolders.
    // WHY: Main processes run filesystem operations without locking UI threads.
    const project_folder_names_list = await window.audiobook_api.list_audiobook_projects(active_selected_workspace_directory_path);
    cards_grid_wrapper_element.innerHTML = "";

    if (project_folder_names_list.length === 0) {
      // WHAT: Showing clean instructions if no projects are found.
      // WHY: Instructs how to start a new generation.
      cards_grid_wrapper_element.innerHTML = `
        <div class="empty_state_screen grid-col-full vh-35">
          <div class="empty_state_hex_glow text-neon-blue border-neon-blue-glow">
            <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </div>
          <h4 class="empty_state_title">No Audiobook Projects Found</h4>
          <p class="empty_state_tagline">Your workspace folder is currently empty. Initialize a new project using the form on the left to begin.</p>
        </div>
      `;
      return;
    }

    // WHAT: Building individual cards for each project folder detected.
    // WHY: Clicking these cards loads state variables and swaps active views automatically.
    for (let index_counter = 0; index_counter < project_folder_names_list.length; index_counter++) {
      const project_name_item = project_folder_names_list[index_counter];
      const project_card_element = document.createElement("div");
      project_card_element.className = "project_card";
      
      // WHAT: Binding selection triggers.
      // WHY: Opens chosen project state on double-click or click.
      project_card_element.onclick = () => load_audiobook_project_by_name(project_name_item);

      project_card_element.innerHTML = `
        <div>
          <div class="card_project_title">${project_name_item}</div>
          <div class="card_project_timestamp">Audiobook Directory</div>
        </div>
        <div class="card_project_footer">
          <span class="segment_counter_badge">Active Project</span>
          <span class="open_action_arrow">Open Script &rarr;</span>
        </div>
      `;
      cards_grid_wrapper_element.appendChild(project_card_element);
    }

  } catch (fs_list_exception) {
    console.error("Could not scan projects directory.", fs_list_exception);
  }
}

// WHAT: Initializes local directories and schemas for new books.
// WHY: Creates workspace subfolders before compiling dialogues or staging performance cues.
async function trigger_new_project_creation() {
  const project_title_field = document.getElementById("input_new_project_title_name");
  const raw_text_content_field = document.getElementById("input_new_project_text_contents");

  const project_name_string = project_title_field.value.trim();
  const book_raw_text_value = raw_text_content_field.value.trim();

  // WHAT: Validating user parameters before dispatching setup.
  // WHY: Avoids compiling blank strings or triggering directory creation failures.
  if (!active_selected_workspace_directory_path) {
    alert("Please select a workspace directory path first.");
    return;
  }
  if (!project_name_string) {
    alert("Please enter a valid, non-empty project name.");
    return;
  }
  if (!book_raw_text_value) {
    alert("Please paste the raw book text content to parse.");
    return;
  }

  try {
    // WHAT: Calling ipc setup.
    // WHY: Main process registers directories and writes JSON states recursively.
    const created_project_state = await window.audiobook_api.create_new_audiobook_project(
      active_selected_workspace_directory_path,
      project_name_string,
      book_raw_text_value
    );

    // WHAT: Clearing visual setup forms.
    // WHY: Clean forms prevent duplicate project setups.
    project_title_field.value = "";
    raw_text_content_field.value = "";

    // WHAT: Reloading workspace grid.
    // WHY: Ensures new project card displays instantly in the dashboard view.
    refresh_existing_projects_grid_list();

    // WHAT: Auto-loading the newly created project.
    // WHY: Immediately transitions user to screenplay view.
    load_audiobook_project_by_name(project_name_string);

  } catch (project_creation_exception) {
    console.error("Audiobook project creation failed.", project_creation_exception);
    alert(`Failed to create project: ${project_creation_exception.message}`);
  }
}

// WHAT: Fetches database states and exposes functional panes (editor, matrix).
// WHY: Switches active database variables when transitioning between books.
async function load_audiobook_project_by_name(project_name_string) {
  if (!active_selected_workspace_directory_path) {
    return;
  }

  try {
    const loaded_project_json_payload = await window.audiobook_api.load_audiobook_project_state(
      active_selected_workspace_directory_path,
      project_name_string
    );

    // WHAT: Binding loaded values to active variables.
    // WHY: Keeps system variables synchronized across all editing panels.
    active_loaded_project_state_object = loaded_project_json_payload;
    if (!active_loaded_project_state_object.directorialSegments) {
      active_loaded_project_state_object.directorialSegments = [];
    }
    if (!active_loaded_project_state_object.voiceMapping) {
      active_loaded_project_state_object.voiceMapping = {};
    }

    // WHAT: Ensuring 'Narrator' is present in the cast configuration database.
    // WHY: Treats the Narrator as a first-class character so directors can customize its
    //      seeds, timbre, and synthesis workflows inside the Voice Matrix tab.
    // STYLE: instructional friendly tutorial.
    if (!active_loaded_project_state_object.voiceMapping["Narrator"]) {
      active_loaded_project_state_object.voiceMapping["Narrator"] = {
        voice: "Narrator_Steady_F5",
        seed: 12345,
        gender: "Narrator",
        age: "Steady Narrator",
        voiceProfile: "A calm, professional narrator with a clear British accent, speaking at a steady, measured pace with precise enunciation.",
        identityBackground: "Experienced audiobook narrator with a steady, storytelling tone.",
        physicalAppearance: "Middle-aged gentleman with a warm presence.",
        personalityTraits: "Articulate, measured, and engaging storytelling persona.",
        isLocked: false,
        workflowType: "design",
        colorCode: "#485F86",
        designPrompt: "Character Name: Narrator\nGender: Narrator\nAge Category: Steady Narrator\nVoice Profile: A calm, professional narrator with a clear British accent, speaking at a steady, measured pace with precise enunciation.\nIdentity & Background: Experienced audiobook narrator with a steady, storytelling tone.\nPhysical Appearance: Middle-aged gentleman with a warm presence.\nPersonality Traits: Articulate, measured, and engaging storytelling persona."
      };
    }

    // WHAT: Updating sidebar status displays.
    // WHY: Informs user which book is currently target of edits.
    document.getElementById("sidebar_active_project_name").textContent = project_name_string;

    // WHAT: Revealing dual pane editing screens and hiding initial masks.
    // WHY: Grants access to actual script edits.
    document.getElementById("editor_empty_view_mask").style.display = "none";
    document.getElementById("editor_main_layout_split").classList.remove("d-none");
    document.getElementById("editor_main_layout_split").style.display = "grid";
    
    document.getElementById("editor_view_toggles").classList.remove("d-none");
    document.getElementById("editor_view_toggles").style.display = "flex";

    // WHAT: Loading original text blocks into editor textareas.
    // WHY: Gives visual access to raw source book paragraphs in the left panel.
    document.getElementById("raw_source_book_textarea_editor").value = loaded_project_json_payload.rawBookText || "";

    // WHAT: Loading the book author and extra notes into the about metadata fields.
    // WHY: Populates the UI inputs with any saved book metadata.
    document.getElementById("project_author_input_editor").value = loaded_project_json_payload.author || "";
    document.getElementById("project_notes_textarea_editor").value = loaded_project_json_payload.notes || "";

    // WHAT: Populating script list cards dynamically.
    // WHY: Renders parsed characters, dialogues, and status lights in the right panel.
    populate_screenplay_cards_in_editor_view();
    
    // WHAT: Populating directorial screenplay cards dynamically.
    // WHY: Renders Intent tooltips, technical badges, and sliders in the 3rd panel.
    populate_directorial_cards_in_editor_view();

    // WHAT: Updating the Voice mappings matrix cards.
    // WHY: Character castings are bound to the currently loaded project.
    document.getElementById("voice_matrix_empty_view_mask").style.display = "none";
    document.getElementById("voice_matrix_functional_container").classList.remove("d-none");
    document.getElementById("voice_matrix_functional_container").style.display = "block";
    populate_voice_matrix_configuration_cards();

    // WHAT: Revealing Stitch controls.
    // WHY: Lets user stitch master audio of active book.
    document.getElementById("stitch_console_empty_view_mask").style.display = "none";
    document.getElementById("stitch_console_functional_container").classList.remove("d-none");
    document.getElementById("stitch_console_functional_container").style.display = "grid";
    refresh_synthesis_progress_tracking_meters();

    // WHAT: Instantly routing user to script editor view.
    // WHY: Saves clicks, starting work phase.
    switch_active_navigation_tab("editor");

  } catch (state_fetch_failure_exception) {
    console.error("Project state mapping failed.", state_fetch_failure_exception);
    alert(`Could not load project state: ${state_fetch_failure_exception.message}`);
    try { require('fs').writeFileSync('./frontend_error.log', state_fetch_failure_exception.stack || state_fetch_failure_exception.toString()); } catch(filesystem_logging_error){}
  }
}

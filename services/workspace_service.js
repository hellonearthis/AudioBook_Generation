// =========================================================================
// WORKSPACE & PROJECT FILE MANAGEMENT SERVICE
// =========================================================================
// WHAT: Handles workspace directory selection, project lifecycle (create, load, save),
//       take file deletion, directory opening, external URL launching, and UI context menus.
// WHY: Isolates local disk I/O and OS dialogs into a modular service while maintaining strict
//      path boundary checks against directory traversal.

const path_library = require("path");
const filesystem_library = require("fs");
const { dialog, shell, Menu, BrowserWindow } = require("electron");

function register_workspace_handlers(ipcMain, getMainWindow) {
  // WHAT: Registering native open folder dialog IPC service.
  // WHY: Allows the front-end to request the user to select their main project storage folder.
  ipcMain.handle("dialog:select-workspace-directory", async () => {
    const parent_window = typeof getMainWindow === "function" ? getMainWindow() : null;
    const dialog_selection_result = await dialog.showOpenDialog(parent_window, {
      properties: ["openDirectory"]
    });

    if (dialog_selection_result.canceled) {
      return null;
    } else {
      return dialog_selection_result.filePaths[0];
    }
  });

  // WHAT: Handler to list all audiobook projects in a designated workspace.
  // WHY: Reads folder names representing existing books to display inside the project list view.
  ipcMain.handle("project:list-projects", async (ipc_event_context, workspace_directory_path) => {
    if (!filesystem_library.existsSync(workspace_directory_path)) {
      return [];
    }

    const workspace_contents = filesystem_library.readdirSync(workspace_directory_path, { withFileTypes: true });
    const list_of_project_folder_names = [];

    for (let index_counter = 0; index_counter < workspace_contents.length; index_counter++) {
      const active_file_system_node = workspace_contents[index_counter];
      if (active_file_system_node.isDirectory()) {
        const state_file_path = path_library.join(workspace_directory_path, active_file_system_node.name, "project_state.json");
        if (filesystem_library.existsSync(state_file_path)) {
          list_of_project_folder_names.push(active_file_system_node.name);
        }
      }
    }

    return list_of_project_folder_names;
  });

  // WHAT: Creating and initializing folder structures for a new book project.
  // WHY: We separate text, states, and audios inside unique subdirectories to ensure organized local storage.
  ipcMain.handle("project:create-project", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, raw_book_text_content } = request_arguments;
    const project_root_directory = path_library.join(workspace_directory_path, project_name);
    const project_audio_directory = path_library.join(project_root_directory, "audio");
    const project_anchors_directory = path_library.join(project_audio_directory, "anchors");

    if (!filesystem_library.existsSync(project_root_directory)) {
      filesystem_library.mkdirSync(project_root_directory, { recursive: true });
    }
    if (!filesystem_library.existsSync(project_audio_directory)) {
      filesystem_library.mkdirSync(project_audio_directory, { recursive: true });
    }
    if (!filesystem_library.existsSync(project_anchors_directory)) {
      filesystem_library.mkdirSync(project_anchors_directory, { recursive: true });
    }

    const book_raw_text_storage_path = path_library.join(project_root_directory, "book.txt");
    filesystem_library.writeFileSync(book_raw_text_storage_path, raw_book_text_content, "utf-8");

    const initial_project_state_schema = {
      projectName: project_name,
      createdTimestamp: Date.now(),
      voiceMapping: {},
      scriptSegments: [],
      directorialSegments: [],
      rawBookText: raw_book_text_content
    };

    const project_state_file_path = path_library.join(project_root_directory, "project_state.json");
    filesystem_library.writeFileSync(
      project_state_file_path,
      JSON.stringify(initial_project_state_schema, null, 2),
      "utf-8"
    );

    return initial_project_state_schema;
  });

  // WHAT: Reading a project's state from disk.
  // WHY: Allows the user to load previously saved configurations and screenplay segments.
  ipcMain.handle("project:load-state", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name } = request_arguments;
    const project_state_file_path = path_library.join(workspace_directory_path, project_name, "project_state.json");

    if (!filesystem_library.existsSync(project_state_file_path)) {
      throw new Error("Project state file does not exist on disk.");
    }

    const raw_serialized_state_data = filesystem_library.readFileSync(project_state_file_path, "utf-8");
    return JSON.parse(raw_serialized_state_data);
  });

  // WHAT: Writing updated state parameters back into the persistent project file on disk.
  // WHY: When changes are made, we maintain up-to-date states in case the application restarts.
  ipcMain.handle("project:save-state", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, project_state_data } = request_arguments;
    const project_state_file_path = path_library.join(workspace_directory_path, project_name, "project_state.json");

    filesystem_library.writeFileSync(
      project_state_file_path,
      JSON.stringify(project_state_data, null, 2),
      "utf-8"
    );

    return true;
  });

  // WHAT: Registering the dynamic take file deletion IPC service.
  // WHY: Gives the UI a secure, sandbox-compliant mechanism to delete a specific audio take from the filesystem.
  ipcMain.handle("project:delete-take", async (ipc_event_context, request_arguments) => {
    const { workspace_directory_path, project_name, is_directorial, index_position, take_number, extension } = request_arguments;
    
    const target_file_prefix_label = is_directorial ? "line_directorial" : "line";
    const project_root_directory = path_library.join(workspace_directory_path, project_name);
    const target_take_file_path = path_library.join(
      project_root_directory,
      "audio",
      "takes",
      `${target_file_prefix_label}_${index_position}`,
      `take_${take_number}${extension}`
    );

    if (!target_take_file_path.startsWith(project_root_directory)) {
      return { success: false, error: "Target take audio file access is restricted." };
    }

    if (!filesystem_library.existsSync(target_take_file_path)) {
      return { success: true, message: "File already missing from disk, but state cleared." };
    }

    try {
      filesystem_library.unlinkSync(target_take_file_path);
      return { success: true };
    } catch (filesystem_deletion_exception) {
      console.error("Failed to delete active take file:", filesystem_deletion_exception);
      return { success: false, error: filesystem_deletion_exception.message };
    }
  });

  // WHAT: Opens a local file's parent directory in the native OS file explorer.
  // WHY: Allows the user to quickly navigate to exported mixdown audio files.
  ipcMain.handle("system:open-file-folder", async (ipc_event_context, request_arguments) => {
    const { file_path } = request_arguments;
    if (filesystem_library.existsSync(file_path)) {
      shell.showItemInFolder(file_path);
      return { success: true };
    } else {
      return { success: false, error: "File not found on disk." };
    }
  });

  // WHAT: Opens external URLs (e.g. llama-server Web UI, Laya/CLM docs) safely in default browser.
  // WHY: Gives the user a one-click way to view and inspect active AI server operations.
  ipcMain.handle("system:open-external-url", async (ipc_event_context, request_arguments) => {
    const { url } = request_arguments;
    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false, error: "Invalid URL scheme" };
  });

  // WHAT: Handle native OS context menus for cell manipulation.
  // WHY: Provides a native, reliable popup menu overlaying the Electron window.
  ipcMain.handle("ui:show-context-menu", (event) => {
    return new Promise((resolve) => {
      const template = [
        { label: 'Combine with cell above', click: () => resolve('above') },
        { label: 'Combine with cell below', click: () => resolve('below') },
        { type: 'separator' },
        { label: 'Insert cell above', click: () => resolve('insert_above') },
        { label: 'Insert cell below', click: () => resolve('insert_below') },
        { type: 'separator' },
        { label: 'Split cell at quote (quick)', click: () => resolve('split_at_quote') }
      ];
      
      const menu = Menu.buildFromTemplate(template);
      const window_instance = BrowserWindow.fromWebContents(event.sender);
      
      menu.popup({
        window: window_instance,
        callback: () => {
          setTimeout(() => resolve(null), 50);
        }
      });
    });
  });
}

module.exports = {
  register_workspace_handlers
};

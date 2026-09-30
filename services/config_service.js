// =========================================================================
// CONFIGURATION & DYNAMIC CROSS-PLATFORM PATH RESOLUTION SERVICE
// =========================================================================
// WHAT: Centralized service for loading user configurations, environment variables,
//       and dynamically resolving paths to local AI microservices (ComfyUI, llama.cpp,
//       Laya, and CLM) across Windows, macOS, and Linux without hardcoded user directories.
// WHY: Eliminates hardcoded paths (e.g. C:\Users\Desktop-Dev) and enables portable,
//       zero-friction setup on any developer workstation or OS.

const path_library = require("path");
const filesystem_library = require("fs");
const os_library = require("os");

const CONFIG_FILE_NAME = "config.json";
const ENV_FILE_NAME = ".env";

// WHAT: Simple zero-dependency .env parser.
// WHY: Allows reading .env files without adding external npm package bloat.
function parse_dot_env_file_if_present(env_file_path) {
  const parsed_env_entries = {};
  try {
    if (filesystem_library.existsSync(env_file_path)) {
      const env_file_content = filesystem_library.readFileSync(env_file_path, "utf8");
      const lines = env_file_content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed_line = line.trim();
        if (!trimmed_line || trimmed_line.startsWith("#")) continue;
        const separator_index = trimmed_line.indexOf("=");
        if (separator_index > 0) {
          const key = trimmed_line.substring(0, separator_index).trim();
          let value = trimmed_line.substring(separator_index + 1).trim();
          // Remove wrapping quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.substring(1, value.length - 1);
          }
          parsed_env_entries[key] = value;
        }
      }
    }
  } catch (error) {
    console.warn("[ConfigService] Could not parse .env file:", error.message);
  }
  return parsed_env_entries;
}

// WHAT: Discovers the first existing directory among an ordered list of candidate paths.
// WHY: Provides smart dynamic fallbacks relative to the user's home directory across platforms.
function find_first_existing_directory(candidate_paths_list) {
  for (const candidate_path of candidate_paths_list) {
    if (candidate_path && typeof candidate_path === "string") {
      try {
        if (filesystem_library.existsSync(candidate_path) && filesystem_library.statSync(candidate_path).isDirectory()) {
          return path_library.resolve(candidate_path);
        }
      } catch {}
    }
  }
  return null;
}

// WHAT: Resolves configuration values combining config.json, .env, environment variables, and defaults.
// WHY: Ensures every service accesses a uniform, validated configuration object with zero setup friction.
function get_resolved_configuration() {
  const project_root = path_library.resolve(__dirname, "..");
  const config_file_path = path_library.join(project_root, CONFIG_FILE_NAME);
  const env_file_path = path_library.join(project_root, ENV_FILE_NAME);

  let file_config = {};
  try {
    if (filesystem_library.existsSync(config_file_path)) {
      file_config = JSON.parse(filesystem_library.readFileSync(config_file_path, "utf8"));
    }
  } catch (error) {
    console.warn("[ConfigService] Error reading config.json:", error.message);
  }

  const dot_env = parse_dot_env_file_if_present(env_file_path);
  const user_home = os_library.homedir();
  const is_windows = process.platform === "win32";

  // 1. Resolve Laya Directory
  const laya_candidates = [
    file_config.laya_path,
    process.env.LAYA_PATH,
    dot_env.LAYA_PATH,
    path_library.join(user_home, "Desktop", "Laya"),
    path_library.join(user_home, "AI_Models", "Laya"),
    path_library.join(user_home, "Laya")
  ];
  const resolved_laya_path = find_first_existing_directory(laya_candidates) || file_config.laya_path || (is_windows ? path_library.join(user_home, "Desktop", "Laya") : path_library.join(user_home, "Laya"));

  // 2. Resolve CLM Directory
  const clm_candidates = [
    file_config.clm_path,
    process.env.CLM_PATH,
    dot_env.CLM_PATH,
    path_library.join(user_home, "Desktop", "CLM"),
    path_library.join(user_home, "AI_Models", "CLM"),
    path_library.join(user_home, "CLM")
  ];
  const resolved_clm_path = find_first_existing_directory(clm_candidates) || file_config.clm_path || (is_windows ? path_library.join(user_home, "Desktop", "CLM") : path_library.join(user_home, "CLM"));

  // 3. Resolve ComfyUI Directory
  const comfyui_candidates = [
    file_config.comfyui_path,
    process.env.COMFYUI_PATH,
    dot_env.COMFYUI_PATH,
    is_windows ? "C:\\cui" : null,
    path_library.join(user_home, "ComfyUI"),
    path_library.join(user_home, "Desktop", "ComfyUI"),
    path_library.join(user_home, "AI_Models", "ComfyUI")
  ];
  const resolved_comfyui_path = find_first_existing_directory(comfyui_candidates) || file_config.comfyui_path || (is_windows ? "C:\\cui" : path_library.join(user_home, "ComfyUI"));

  // 4. Resolve llama.cpp Directory
  const llama_candidates = [
    file_config.llama_path,
    process.env.LLAMA_PATH,
    dot_env.LLAMA_PATH,
    is_windows ? "C:\\llamaCPP" : null,
    path_library.join(user_home, "llama.cpp"),
    path_library.join(user_home, "Desktop", "llamaCPP"),
    path_library.join(user_home, "AI_Models", "llama.cpp")
  ];
  const resolved_llama_path = find_first_existing_directory(llama_candidates) || file_config.llama_path || (is_windows ? "C:\\llamaCPP" : path_library.join(user_home, "llama.cpp"));

  return {
    // Service URLs
    comfyui_url: file_config.comfyui_url || process.env.COMFYUI_URL || dot_env.COMFYUI_URL || "http://127.0.0.1:8188",
    llama_url: file_config.llama_url || process.env.LLAMA_URL || dot_env.LLAMA_URL || "http://127.0.0.1:8081",
    laya_url: file_config.laya_url || process.env.LAYA_URL || dot_env.LAYA_URL || "http://127.0.0.1:8765",
    clm_url: file_config.clm_url || process.env.CLM_URL || dot_env.CLM_URL || "http://127.0.0.1:8700",

    // Discovered Local Paths
    comfyui_path: resolved_comfyui_path,
    llama_path: resolved_llama_path,
    laya_path: resolved_laya_path,
    clm_path: resolved_clm_path,

    // Platform Metadata
    is_windows,
    user_home
  };
}

// WHAT: Saves user-updated configuration to config.json.
// WHY: Allows the UI settings panel to persist custom endpoints and directories safely.
function save_user_configuration(updated_config_object) {
  const project_root = path_library.resolve(__dirname, "..");
  const config_file_path = path_library.join(project_root, CONFIG_FILE_NAME);

  let current_config = {};
  try {
    if (filesystem_library.existsSync(config_file_path)) {
      current_config = JSON.parse(filesystem_library.readFileSync(config_file_path, "utf8"));
    }
  } catch {}

  const merged_config = {
    ...current_config,
    ...updated_config_object
  };

  filesystem_library.writeFileSync(config_file_path, JSON.stringify(merged_config, null, 2), "utf8");
  return merged_config;
}

module.exports = {
  get_resolved_configuration,
  save_user_configuration,
  find_first_existing_directory
};

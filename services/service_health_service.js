// =========================================================================
// SERVICE HEALTH & ON-DEMAND RUNTIME ORCHESTRATION SERVICE
// =========================================================================
// WHAT: Handles non-blocking health probing, on-demand auto-launching, and bidirectional
//       VRAM eviction between llama-server and ComfyUI.
// WHY: On consumer GPUs (e.g. 16GB VRAM), running both a 27B LLM and ComfyUI TTS concurrently
//      causes out-of-memory errors. This service arbitrates GPU resources cleanly and only
//      launches secondary backends (ComfyUI, Laya, CLM) when explicitly requested.

const http_client_library = require("http");
const filesystem_library = require("fs");
const child_process_library = require("child_process");

// WHAT: Global tracking of active ComfyUI endpoint URL.
let last_known_comfyui_endpoint_url = "http://127.0.0.1:8188";

// WHAT: Normalizing any "localhost" string in a URL to the literal IPv4 address 127.0.0.1.
// WHY: Node.js v17+ resolves "localhost" through OS DNS, which returns IPv6 ::1 first.
//      Local AI servers (llama-server, ComfyUI, Laya, CLM) bind exclusively to IPv4.
function normalize_localhost_url_to_ipv4_address(input_url_string) {
  if (!input_url_string) return "http://127.0.0.1:8081";
  return input_url_string.replace(/^(https?:\/\/)localhost/i, "$1127.0.0.1");
}

// WHAT: Rapid non-blocking health check for local AI microservices.
// WHY: Allows main process to determine if a service is running before attempting queries or on-demand startup.
function probe_service_health(endpoint_url_string, timeout_milliseconds = 1500) {
  return new Promise((resolve_health_probe) => {
    try {
      const ipv4_safe_endpoint_url = normalize_localhost_url_to_ipv4_address(endpoint_url_string);
      const parsed_endpoint_url_object = new URL(ipv4_safe_endpoint_url);
      const http_probe_client_request = http_client_library.get({
        hostname: parsed_endpoint_url_object.hostname,
        port: parsed_endpoint_url_object.port,
        path: parsed_endpoint_url_object.pathname || "/",
        timeout: timeout_milliseconds
      }, (http_probe_incoming_response) => {
        resolve_health_probe(http_probe_incoming_response.statusCode === 200);
      }).on("error", () => resolve_health_probe(false));

      http_probe_client_request.setTimeout(timeout_milliseconds, () => {
        http_probe_client_request.destroy();
        resolve_health_probe(false);
      });
    } catch {
      resolve_health_probe(false);
    }
  });
}

// WHAT: Helper to dispatch quick POST requests (e.g. /free to ComfyUI).
// WHY: Used to trigger GPU memory release and model unloading without heavyweight client dependencies.
function dispatch_quick_post_request(target_url_string, payload_object) {
  return new Promise((resolve_quick_post, reject_quick_post) => {
    try {
      const ipv4_safe_target_url = normalize_localhost_url_to_ipv4_address(target_url_string);
      const parsed_target_url_object = new URL(ipv4_safe_target_url);
      const serialized_payload_data = JSON.stringify(payload_object || {});
      const http_post_client_request = http_client_library.request({
        hostname: parsed_target_url_object.hostname,
        port: parsed_target_url_object.port,
        path: parsed_target_url_object.pathname,
        method: "POST",
        timeout: 5000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(serialized_payload_data)
        }
      }, (http_post_incoming_response) => {
        let accumulated_response_body_text = "";
        http_post_incoming_response.on("data", (data_chunk_buffer) => {
          accumulated_response_body_text += data_chunk_buffer;
        });
        http_post_incoming_response.on("end", () => {
          resolve_quick_post(accumulated_response_body_text);
        });
      });

      http_post_client_request.on("error", (request_transmission_error) => {
        reject_quick_post(request_transmission_error);
      });
      http_post_client_request.setTimeout(5000, () => {
        http_post_client_request.destroy();
        reject_quick_post(new Error("Quick POST request timed out after 5000ms."));
      });
      http_post_client_request.write(serialized_payload_data);
      http_post_client_request.end();
    } catch (unexpected_dispatch_error) {
      reject_quick_post(unexpected_dispatch_error);
    }
  });
}

// WHAT: Unloads models and clears CUDA VRAM cache in ComfyUI.
// WHY: Releases ComfyUI GPU memory so the LLM has complete VRAM headroom during inference.
async function release_comfyui_vram(comfyui_base_endpoint_url) {
  try {
    const target_endpoint_url = comfyui_base_endpoint_url || last_known_comfyui_endpoint_url || "http://127.0.0.1:8188";
    const ipv4_endpoint_url = normalize_localhost_url_to_ipv4_address(target_endpoint_url).replace(/\/+$/, "");
    const is_service_online = await probe_service_health(`${ipv4_endpoint_url}/system_stats`, 400);
    if (!is_service_online) {
      return;
    }
    await dispatch_quick_post_request(`${ipv4_endpoint_url}/free`, {
      unload_models: true,
      free_memory: true
    });
    console.log("[VRAM Manager] Dispatched /free to ComfyUI; GPU cache and models released.");
  } catch {
    // Non-fatal if ComfyUI is offline or unreachable
  }
}

// WHAT: Ensures llama-server has transitioned to sleep mode before heavy ComfyUI generation starts.
// WHY: When llama-server is started with --sleep-idle-seconds (10s), it unloads the GGUF model
//      from VRAM automatically when idle. This check polls /props to confirm.
async function ensure_llama_vram_released(llama_base_endpoint_url, maximum_wait_milliseconds = 12000) {
  try {
    const raw_endpoint_url = llama_base_endpoint_url || "http://127.0.0.1:8081";
    const ipv4_endpoint_url = normalize_localhost_url_to_ipv4_address(raw_endpoint_url).replace(/\/+$/, "");
    const parsed_endpoint_url_object = new URL(ipv4_endpoint_url);
    const start_timestamp_milliseconds = Date.now();

    while (Date.now() - start_timestamp_milliseconds < maximum_wait_milliseconds) {
      const is_sleeping_confirmed = await new Promise((resolve_sleep_check) => {
        const http_props_client_request = http_client_library.get({
          hostname: parsed_endpoint_url_object.hostname,
          port: parsed_endpoint_url_object.port,
          path: "/props",
          headers: { "Accept": "application/json" }
        }, (http_props_incoming_response) => {
          let accumulated_props_body_text = "";
          http_props_incoming_response.on("data", (data_chunk) => {
            accumulated_props_body_text += data_chunk;
          });
          http_props_incoming_response.on("end", () => {
            try {
              const parsed_props_data = JSON.parse(accumulated_props_body_text);
              resolve_sleep_check(parsed_props_data.is_sleeping === true);
            } catch {
              resolve_sleep_check(true);
            }
          });
        }).on("error", () => resolve_sleep_check(true));

        http_props_client_request.setTimeout(1500, () => {
          http_props_client_request.destroy();
          resolve_sleep_check(true);
        });
      });

      if (is_sleeping_confirmed) {
        console.log("[VRAM Manager] Verified llama-server is sleeping; VRAM is available for ComfyUI.");
        return true;
      }

      console.log("[VRAM Manager] Waiting for llama-server auto-sleep idle timer...");
      await new Promise(resolve_idle_delay => setTimeout(resolve_idle_delay, 1000));
    }
  } catch (error_checking_llama_status) {
    console.log("[VRAM Manager] llama-server status check skipped:", error_checking_llama_status.message);
  }
  return true;
}

// WHAT: On-demand launcher for ComfyUI audio TTS engine.
// WHY: ComfyUI is only loaded when speech synthesis or audio editing begins, preserving GPU memory for LLM during cast discovery and script writing.
async function ensure_comfyui_ready(comfyui_base_endpoint_url = "http://127.0.0.1:8188", maximum_wait_seconds = 30, getMainWindow = null) {
  const normalized_endpoint_url = normalize_localhost_url_to_ipv4_address(comfyui_base_endpoint_url).replace(/\/+$/, "");
  last_known_comfyui_endpoint_url = normalized_endpoint_url;
  const is_service_already_up = await probe_service_health(`${normalized_endpoint_url}/system_stats`);
  if (is_service_already_up) {
    return true;
  }

  const launcher_script_path = "C:\\cui\\goLow.ps1";
  if (!filesystem_library.existsSync(launcher_script_path)) {
    console.warn(`[On-Demand] ComfyUI launcher script not found at ${launcher_script_path}`);
    return false;
  }

  console.log("[On-Demand] Launching ComfyUI for audio generation on-demand...");
  const primary_window_instance = typeof getMainWindow === "function" ? getMainWindow() : null;
  if (primary_window_instance) {
    primary_window_instance.webContents.send("system:ai-status-update", {
      service: "comfyui",
      status: "starting",
      message: "Starting ComfyUI TTS engine on-demand..."
    });
  }

  // Ensure llama-server drops to sleep before ComfyUI claims VRAM
  await ensure_llama_vram_released();

  try {
    const spawned_comfyui_process = child_process_library.spawn("powershell.exe", [
      "-ExecutionPolicy", "Bypass",
      "-File", launcher_script_path
    ], {
      cwd: "C:\\cui",
      detached: true,
      stdio: "ignore"
    });
    spawned_comfyui_process.unref();
  } catch (process_spawn_error) {
    console.error("[On-Demand] Failed to spawn ComfyUI:", process_spawn_error.message);
    return false;
  }

  const wait_start_timestamp = Date.now();
  while (Date.now() - wait_start_timestamp < maximum_wait_seconds * 1000) {
    await new Promise(resolve_polling_delay => setTimeout(resolve_polling_delay, 1500));
    const is_service_ready_probe = await probe_service_health(`${normalized_endpoint_url}/system_stats`);
    if (is_service_ready_probe) {
      console.log(`[On-Demand] ComfyUI initialized and ready in ${Math.round((Date.now() - wait_start_timestamp) / 1000)}s.`);
      if (primary_window_instance) {
        primary_window_instance.webContents.send("system:ai-status-update", {
          service: "comfyui",
          status: "ready",
          message: "ComfyUI initialized."
        });
      }
      return true;
    }
  }

  console.warn(`[On-Demand] ComfyUI failed to respond within ${maximum_wait_seconds}s.`);
  return false;
}

// WHAT: On-demand launcher for Laya Decision Engine.
// WHY: Laya is only loaded when fast attribution is selected by the user.
async function ensure_laya_ready(laya_base_endpoint_url = "http://127.0.0.1:8765", maximum_wait_seconds = 45, getMainWindow = null) {
  const normalized_endpoint_url = normalize_localhost_url_to_ipv4_address(laya_base_endpoint_url).replace(/\/+$/, "");
  const is_service_already_up = await probe_service_health(`${normalized_endpoint_url}/health`);
  if (is_service_already_up) {
    return true;
  }

  const launcher_script_path = "C:\\Users\\Desktop-Dev\\Desktop\\Laya\\start_server.ps1";
  if (!filesystem_library.existsSync(launcher_script_path)) {
    return false;
  }

  console.log("[On-Demand] Launching Laya Decision Engine for fast dialogue attribution...");
  const primary_window_instance = typeof getMainWindow === "function" ? getMainWindow() : null;
  if (primary_window_instance) {
    primary_window_instance.webContents.send("system:ai-status-update", {
      service: "laya",
      status: "starting",
      message: "Starting Laya Decision Engine on-demand..."
    });
  }

  try {
    const spawned_laya_process = child_process_library.spawn("powershell.exe", [
      "-ExecutionPolicy", "Bypass",
      "-File", launcher_script_path
    ], {
      cwd: "C:\\Users\\Desktop-Dev\\Desktop\\Laya",
      detached: true,
      stdio: "ignore"
    });
    spawned_laya_process.unref();
  } catch (process_spawn_error) {
    console.error("[On-Demand] Failed to spawn Laya:", process_spawn_error.message);
    return false;
  }

  const wait_start_timestamp = Date.now();
  while (Date.now() - wait_start_timestamp < maximum_wait_seconds * 1000) {
    await new Promise(resolve_polling_delay => setTimeout(resolve_polling_delay, 1500));
    const is_service_ready_probe = await probe_service_health(`${normalized_endpoint_url}/health`);
    if (is_service_ready_probe) {
      console.log(`[On-Demand] Laya initialized and ready in ${Math.round((Date.now() - wait_start_timestamp) / 1000)}s.`);
      if (primary_window_instance) {
        primary_window_instance.webContents.send("system:ai-status-update", {
          service: "laya",
          status: "ready",
          message: "Laya initialized."
        });
      }
      return true;
    }
  }
  return false;
}

// WHAT: On-demand launcher for CLM Decision Engine.
async function ensure_clm_ready(clm_base_endpoint_url = "http://127.0.0.1:8700", maximum_wait_seconds = 45, getMainWindow = null) {
  const normalized_endpoint_url = normalize_localhost_url_to_ipv4_address(clm_base_endpoint_url).replace(/\/+$/, "");
  const is_service_already_up = await probe_service_health(`${normalized_endpoint_url}/health`);
  if (is_service_already_up) {
    return true;
  }

  const launcher_script_path = "C:\\Users\\Desktop-Dev\\Desktop\\CLM\\run_clm_server.ps1";
  if (!filesystem_library.existsSync(launcher_script_path)) {
    return false;
  }

  console.log("[On-Demand] Launching CLM Decision Engine for contrastive attribution...");
  const primary_window_instance = typeof getMainWindow === "function" ? getMainWindow() : null;
  if (primary_window_instance) {
    primary_window_instance.webContents.send("system:ai-status-update", {
      service: "clm",
      status: "starting",
      message: "Starting CLM System One on-demand..."
    });
  }

  try {
    const spawned_clm_process = child_process_library.spawn("powershell.exe", [
      "-ExecutionPolicy", "Bypass",
      "-File", launcher_script_path
    ], {
      cwd: "C:\\Users\\Desktop-Dev\\Desktop\\CLM",
      detached: true,
      stdio: "ignore"
    });
    spawned_clm_process.unref();
  } catch (process_spawn_error) {
    console.error("[On-Demand] Failed to spawn CLM:", process_spawn_error.message);
    return false;
  }

  const wait_start_timestamp = Date.now();
  while (Date.now() - wait_start_timestamp < maximum_wait_seconds * 1000) {
    await new Promise(resolve_polling_delay => setTimeout(resolve_polling_delay, 1500));
    const is_service_ready_probe = await probe_service_health(`${normalized_endpoint_url}/health`);
    if (is_service_ready_probe) {
      console.log(`[On-Demand] CLM initialized and ready in ${Math.round((Date.now() - wait_start_timestamp) / 1000)}s.`);
      if (primary_window_instance) {
        primary_window_instance.webContents.send("system:ai-status-update", {
          service: "clm",
          status: "ready",
          message: "CLM initialized."
        });
      }
      return true;
    }
  }
  return false;
}

module.exports = {
  normalize_localhost_url_to_ipv4_address,
  probe_service_health,
  release_comfyui_vram,
  ensure_llama_vram_released,
  ensure_comfyui_ready,
  ensure_laya_ready,
  ensure_clm_ready
};

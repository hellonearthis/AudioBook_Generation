<#
.SYNOPSIS
    Easy-start launcher for the AI Audiobook Screenplay Generator & Synthesizer desktop app.

.DESCRIPTION
    WHAT: Checks dependencies, tests connectivity to local AI endpoints (ComfyUI, llama.cpp, Laya, and CLM),
          and launches the Electron application in either production or hot-reloading dev mode.
    WHY: Eliminates the friction of remembering npm commands or diagnosing silent connection
         failures with ComfyUI and LLM before the Electron window loads.

.PARAMETER Dev
    WHAT: Switch parameter to launch the app using nodemon hot-reload.
    WHY: Lets developers edit UI or renderer scripts and see changes reload immediately.

.PARAMETER NoAutoStart
    WHAT: Switch parameter to disable automatic launching of offline AI servers.
    WHY: Keeps start.ps1 in probe-only check mode if you prefer managing processes manually.

.EXAMPLE
    .\start.ps1
    Auto-starts missing AI services (ComfyUI & llama-server) and launches the application.

.EXAMPLE
    .\start.ps1 -Dev
    Auto-starts missing AI services and launches the application in dev mode.

.EXAMPLE
    .\start.ps1 -NoAutoStart
    Probes connectivity without automatically launching offline services.
#>

[CmdletBinding()]
param (
    [switch]$Dev,
    [switch]$NoAutoStart,
    [switch]$StartComfyUI,
    [switch]$StartLaya,
    [switch]$StartCLM
)

# WHAT: Set strict error handling and resolve the script directory path.
# WHY: Ensures relative paths resolve correctly regardless of where the terminal was launched from.
$ErrorActionPreference = "Continue"
$project_root_directory_path = $PSScriptRoot

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  AI Audiobook Screenplay Generator & Synthesizer Launcher " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# WHAT: Verify Node.js and npm availability in the environment path.
# WHY: Electron and runtime packages depend on a functioning Node.js environment.
$node_version_information = node --version 2>$null
if (-not $node_version_information) {
    Write-Host "[ERROR] Node.js was not detected in your PATH." -ForegroundColor Red
    Write-Host "Please install Node.js (v18+ recommended) from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Node.js runtime detected: $node_version_information" -ForegroundColor Green

# WHAT: Verify that project node_modules have been installed.
# WHY: Without local dependencies (Electron, fluent-ffmpeg, etc.), the application will fail on boot.
$node_modules_directory_path = Join-Path -Path $project_root_directory_path -ChildPath "node_modules"
if (-not (Test-Path -Path $node_modules_directory_path)) {
    Write-Host "[NOTICE] node_modules not found. Running npm install..." -ForegroundColor Yellow
    Push-Location $project_root_directory_path
    npm install
    Pop-Location
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] npm install encountered an error." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}
else {
    Write-Host "[OK] Local dependencies installed." -ForegroundColor Green
}

# WHAT: Load user configuration from config.json or environment variables if present.
# WHY: Eliminates hardcoded paths and supports customized endpoints and model folders.
$config_file_path = Join-Path -Path $project_root_directory_path -ChildPath "config.json"
$user_config = $null
if (Test-Path -Path $config_file_path) {
    try {
        $user_config = Get-Content -Path $config_file_path -Raw | ConvertFrom-Json
        Write-Host "[INFO] Configuration loaded from config.json" -ForegroundColor DarkGray
    }
    catch {
        Write-Host "[WARN] Could not parse config.json, using dynamic defaults." -ForegroundColor DarkYellow
    }
}

$user_home_dir = if ($env:USERPROFILE) { $env:USERPROFILE } elseif ($HOME) { $HOME } else { "." }

function Resolve-CandidatePath {
    param ([string[]]$CandidatePaths)
    foreach ($cand in $CandidatePaths) {
        if ($cand -and (Test-Path -Path $cand)) {
            return (Resolve-Path $cand).Path
        }
    }
    return $null
}

# -------------------------------------------------------------------------
# 1. ComfyUI (Audio TTS Engine - Port 8188)
# -------------------------------------------------------------------------
$comfyui_base_url = if ($user_config -and $user_config.comfyui_url) { $user_config.comfyui_url } elseif ($env:COMFYUI_URL) { $env:COMFYUI_URL } else { "http://127.0.0.1:8188" }
$comfyui_endpoint_address = "$($comfyui_base_url.TrimEnd('/'))/system_stats"
$comfyui_is_running = $false

try {
    $comfyui_connection_probe = Invoke-WebRequest -Uri $comfyui_endpoint_address -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($comfyui_connection_probe.StatusCode -eq 200) {
        Write-Host "[OK] ComfyUI server is reachable at $comfyui_base_url" -ForegroundColor Green
        $comfyui_is_running = $true
    }
}
catch {}

$comfyui_candidates = @(
    $(if ($user_config) { $user_config.comfyui_path }),
    $env:COMFYUI_PATH,
    "C:\cui",
    (Join-Path $user_home_dir "ComfyUI"),
    (Join-Path $user_home_dir "Desktop\ComfyUI"),
    (Join-Path $user_home_dir "AI_Models\ComfyUI")
)
$comfyui_dir = Resolve-CandidatePath $comfyui_candidates
$comfyui_launcher_script = if ($comfyui_dir) {
    Resolve-CandidatePath @(
        (Join-Path $comfyui_dir "goLow.ps1"),
        (Join-Path $comfyui_dir "run_nvidia_gpu.bat"),
        (Join-Path $comfyui_dir "main.py")
    )
} else { $null }

if ($comfyui_is_running) {
    if (-not $StartComfyUI) {
        Write-Host "[INFO] ComfyUI is running on port 8188. Evicting loaded models from VRAM to preserve 100% GPU memory for llama-server..." -ForegroundColor Yellow
        try {
            Invoke-RestMethod -Uri "$($comfyui_base_url.TrimEnd('/'))/free" -Method Post -Body '{"unload_models":true,"free_memory":true}' -ContentType "application/json" -TimeoutSec 3 -ErrorAction SilentlyContinue | Out-Null
            Write-Host "[OK] ComfyUI models evicted from VRAM." -ForegroundColor Green
        }
        catch {}
    }
}
else {
    if ($StartComfyUI -and $comfyui_launcher_script) {
        Write-Host "[NOTICE] Auto-launching ComfyUI ($comfyui_launcher_script) in a new window..." -ForegroundColor Yellow
        Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$comfyui_launcher_script`"" -WorkingDirectory $comfyui_dir
        Start-Sleep -Seconds 3
        try {
            $probe_after_cui = Invoke-WebRequest -Uri $comfyui_endpoint_address -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($probe_after_cui.StatusCode -eq 200) {
                Write-Host "[OK] ComfyUI server initialized at $comfyui_base_url" -ForegroundColor Green
                $comfyui_is_running = $true
            }
        }
        catch {
            Write-Host "[INFO] ComfyUI launched in a separate window; initializing models..." -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "[INFO] ComfyUI is offline ($comfyui_base_url). Preserving GPU VRAM for llama-server. (Pass -StartComfyUI or launch your ComfyUI runner when synthesizing audio)." -ForegroundColor DarkGray
    }
}

# -------------------------------------------------------------------------
# 2. llama.cpp (Attribution & Staging Engine - Port 8081)
# -------------------------------------------------------------------------
$llama_base_url = if ($user_config -and $user_config.llama_url) { $user_config.llama_url } elseif ($env:LLAMA_URL) { $env:LLAMA_URL } else { "http://127.0.0.1:8081" }
$llama_endpoint_address = "$($llama_base_url.TrimEnd('/'))/v1/models"
$llama_is_running = $false

try {
    $llama_connection_probe = Invoke-WebRequest -Uri $llama_endpoint_address -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($llama_connection_probe.StatusCode -eq 200) {
        Write-Host "[OK] llama.cpp server is reachable at $llama_base_url" -ForegroundColor Green
        $llama_is_running = $true
    }
}
catch {}

if (-not $llama_is_running) {
    $llama_candidates = @(
        $(if ($user_config) { $user_config.llama_path }),
        $env:LLAMA_PATH,
        "C:\llamaCPP",
        (Join-Path $user_home_dir "llama.cpp"),
        (Join-Path $user_home_dir "Desktop\llamaCPP"),
        (Join-Path $user_home_dir "AI_Models\llama.cpp")
    )
    $llama_dir = Resolve-CandidatePath $llama_candidates
    $llama_bat_path = if ($llama_dir) {
        Resolve-CandidatePath @(
            (Join-Path $llama_dir "start_webui_qwen3_8-27b-abliterated_8081.bat"),
            (Join-Path $llama_dir "start_webui_8081.bat"),
            (Join-Path $llama_dir "start_webui_8080.bat"),
            (Join-Path $llama_dir "start.bat"),
            (Join-Path $llama_dir "llama-server.exe")
        )
    } else { $null }

    if (-not $NoAutoStart -and $llama_bat_path) {
        Write-Host "[NOTICE] llama-server is offline. Auto-launching $llama_bat_path in a new window..." -ForegroundColor Yellow
        Start-Process -FilePath "cmd.exe" -ArgumentList "/k `"$llama_bat_path`"" -WorkingDirectory $llama_dir
        Write-Host "[INFO] Loading model weights into VRAM (this may take ~10-15 seconds for 27B)..." -ForegroundColor Yellow

        $llama_wait_seconds = 0
        $llama_max_wait = 25
        while (-not $llama_is_running -and ($llama_wait_seconds -lt $llama_max_wait)) {
            Start-Sleep -Seconds 2
            $llama_wait_seconds += 2
            try {
                $probe_after_llama = Invoke-WebRequest -Uri $llama_endpoint_address -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
                if ($probe_after_llama.StatusCode -eq 200) {
                    Write-Host "[OK] llama.cpp server initialized at $llama_base_url (loaded in ${llama_wait_seconds}s)" -ForegroundColor Green
                    $llama_is_running = $true
                    break
                }
            }
            catch {}
        }
        if (-not $llama_is_running) {
            Write-Host "[INFO] llama-server is still loading weights in the background; will be ready shortly." -ForegroundColor Yellow
        }
    }
    else {
        # Check if LLM is running as fallback on 1234
        $fallback_llm_endpoint_address = "http://127.0.0.1:1234/v1/models"
        $fallback_llm_is_running = $false
        try {
            $fallback_llm_connection_probe = Invoke-WebRequest -Uri $fallback_llm_endpoint_address -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
            if ($fallback_llm_connection_probe.StatusCode -eq 200) {
                Write-Host "[OK] LLM server detected at 127.0.0.1:1234" -ForegroundColor Green
                $fallback_llm_is_running = $true
            }
        }
        catch {}

        if (-not $fallback_llm_is_running) {
            Write-Host "[INFO] llama.cpp server is offline ($llama_base_url). Set llama_path in config.json or start your local LLM server. Fallback regex parsing will be used if needed." -ForegroundColor DarkGray
        }
    }
}

# -------------------------------------------------------------------------
# 3. Laya Decision Engine (Fast Attribution & Staging - Port 8765)
# -------------------------------------------------------------------------
$laya_base_url = if ($user_config -and $user_config.laya_url) { $user_config.laya_url } elseif ($env:LAYA_URL) { $env:LAYA_URL } else { "http://127.0.0.1:8765" }
$laya_endpoint_address = "$($laya_base_url.TrimEnd('/'))/health"
$laya_is_running = $false

try {
    $laya_connection_probe = Invoke-WebRequest -Uri $laya_endpoint_address -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
    if ($laya_connection_probe.StatusCode -eq 200) {
        Write-Host "[OK] Laya decision engine is reachable at $laya_base_url" -ForegroundColor Green
        $laya_is_running = $true
    }
}
catch {}

if (-not $laya_is_running) {
    $laya_candidates = @(
        $(if ($user_config) { $user_config.laya_path }),
        $env:LAYA_PATH,
        (Join-Path $user_home_dir "Desktop\Laya"),
        (Join-Path $user_home_dir "AI_Models\Laya"),
        (Join-Path $user_home_dir "Laya")
    )
    $laya_dir = Resolve-CandidatePath $laya_candidates
    $laya_script_path = if ($laya_dir) {
        Resolve-CandidatePath @(
            (Join-Path $laya_dir "start_server.ps1"),
            (Join-Path $laya_dir "start_server.sh"),
            (Join-Path $laya_dir "server.py")
        )
    } else { $null }

    if ($StartLaya -and $laya_script_path) {
        Write-Host "[NOTICE] Auto-launching Laya ($laya_script_path) in a new window..." -ForegroundColor Yellow
        Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$laya_script_path`"" -WorkingDirectory $laya_dir
        Start-Sleep -Seconds 3
        try {
            $probe_after_laya = Invoke-WebRequest -Uri $laya_endpoint_address -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($probe_after_laya.StatusCode -eq 200) {
                Write-Host "[OK] Laya decision engine initialized at $laya_base_url" -ForegroundColor Green
                $laya_is_running = $true
            }
        }
        catch {
            Write-Host "[INFO] Laya launched in a separate window; warming up model..." -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "[INFO] Laya is offline ($laya_base_url). Preserving resources; will load on-demand when fast attribution is selected." -ForegroundColor DarkGray
    }
}

# -------------------------------------------------------------------------
# 4. CLM Decision Engine (Contrastive Language Model - Port 8700)
# -------------------------------------------------------------------------
$clm_base_url = if ($user_config -and $user_config.clm_url) { $user_config.clm_url } elseif ($env:CLM_URL) { $env:CLM_URL } else { "http://127.0.0.1:8700" }
$clm_endpoint_address = "$($clm_base_url.TrimEnd('/'))/health"
$clm_is_running = $false

try {
    $clm_connection_probe = Invoke-WebRequest -Uri $clm_endpoint_address -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
    if ($clm_connection_probe.StatusCode -eq 200) {
        Write-Host "[OK] CLM decision engine is reachable at $clm_base_url" -ForegroundColor Green
        $clm_is_running = $true
    }
}
catch {}

if (-not $clm_is_running) {
    $clm_candidates = @(
        $(if ($user_config) { $user_config.clm_path }),
        $env:CLM_PATH,
        (Join-Path $user_home_dir "Desktop\CLM"),
        (Join-Path $user_home_dir "AI_Models\CLM"),
        (Join-Path $user_home_dir "CLM")
    )
    $clm_dir = Resolve-CandidatePath $clm_candidates
    $clm_script_path = if ($clm_dir) {
        Resolve-CandidatePath @(
            (Join-Path $clm_dir "run_clm_server.ps1"),
            (Join-Path $clm_dir "run_clm_server.sh"),
            (Join-Path $clm_dir "server.py")
        )
    } else { $null }

    if ($StartCLM -and $clm_script_path) {
        Write-Host "[NOTICE] Auto-launching CLM ($clm_script_path) in a new window..." -ForegroundColor Yellow
        Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$clm_script_path`"" -WorkingDirectory $clm_dir
        Start-Sleep -Seconds 3
        try {
            $probe_after_clm = Invoke-WebRequest -Uri $clm_endpoint_address -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($probe_after_clm.StatusCode -eq 200) {
                Write-Host "[OK] CLM decision engine initialized at $clm_base_url" -ForegroundColor Green
                $clm_is_running = $true
            }
        }
        catch {
            Write-Host "[INFO] CLM server launched in a separate window..." -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "[INFO] CLM is offline ($clm_base_url). Preserving resources; will load on-demand when contrastive attribution is selected." -ForegroundColor DarkGray
    }
}

Write-Host ""

# WHAT: Launching the Electron application.
# WHY: Spawns the desktop GUI via npm scripts. If -Dev is passed, nodemon hot-reloads on file changes.
Push-Location $project_root_directory_path
if ($Dev) {
    Write-Host ">>> Launching application in DEV MODE (hot-reloading enabled)..." -ForegroundColor Cyan
    npm run dev
}
else {
    Write-Host ">>> Launching application in STANDARD MODE..." -ForegroundColor Cyan
    npm start
}
Pop-Location

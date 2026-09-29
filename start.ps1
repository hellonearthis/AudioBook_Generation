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

# -------------------------------------------------------------------------
# 1. ComfyUI (Audio TTS Engine - Port 8188)
# -------------------------------------------------------------------------
$comfyui_endpoint_address = "http://127.0.0.1:8188/system_stats"
$comfyui_is_running = $false

try {
    $comfyui_connection_probe = Invoke-WebRequest -Uri $comfyui_endpoint_address -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($comfyui_connection_probe.StatusCode -eq 200) {
        Write-Host "[OK] ComfyUI server is reachable at 127.0.0.1:8188" -ForegroundColor Green
        $comfyui_is_running = $true
    }
}
catch {}

if ($comfyui_is_running) {
    if (-not $StartComfyUI) {
        Write-Host "[INFO] ComfyUI is running on port 8188. Evicting loaded models from VRAM to preserve 100% GPU memory for llama-server..." -ForegroundColor Yellow
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:8188/free" -Method Post -Body '{"unload_models":true,"free_memory":true}' -ContentType "application/json" -TimeoutSec 3 -ErrorAction SilentlyContinue | Out-Null
            Write-Host "[OK] ComfyUI models evicted from VRAM." -ForegroundColor Green
        }
        catch {}
    }
}
else {
    $comfyui_launcher_script = "C:\cui\goLow.ps1"
    if ($StartComfyUI -and (Test-Path -Path $comfyui_launcher_script)) {
        Write-Host "[NOTICE] Auto-launching ComfyUI (C:\cui\goLow.ps1) in a new window..." -ForegroundColor Yellow
        Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$comfyui_launcher_script`"" -WorkingDirectory "C:\cui"
        Start-Sleep -Seconds 3
        try {
            $probe_after_cui = Invoke-WebRequest -Uri $comfyui_endpoint_address -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($probe_after_cui.StatusCode -eq 200) {
                Write-Host "[OK] ComfyUI server initialized at 127.0.0.1:8188" -ForegroundColor Green
                $comfyui_is_running = $true
            }
        }
        catch {
            Write-Host "[INFO] ComfyUI launched in a separate window; initializing models..." -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "[INFO] ComfyUI is offline (127.0.0.1:8188). Preserving GPU VRAM for llama-server. (Pass -StartComfyUI or launch C:\cui\goLow.ps1 when synthesizing audio)." -ForegroundColor DarkGray
    }
}

# -------------------------------------------------------------------------
# 2. llama.cpp (Attribution & Staging Engine - Port 8081)
# -------------------------------------------------------------------------
$llama_endpoint_address = "http://127.0.0.1:8081/v1/models"
$llama_is_running = $false

try {
    $llama_connection_probe = Invoke-WebRequest -Uri $llama_endpoint_address -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($llama_connection_probe.StatusCode -eq 200) {
        Write-Host "[OK] llama.cpp server is reachable at 127.0.0.1:8081 (qwen3.8-27b-abliterated)" -ForegroundColor Green
        $llama_is_running = $true
    }
}
catch {}

if (-not $llama_is_running) {
    $llama_bat_candidates = @(
        "C:\llamaCPP\start_webui_qwen3_8-27b-abliterated_8081.bat",
        "C:\llamaCPP\start_webui_8081.bat",
        "C:\llamaCPP\start_webui_8080.bat"
    )
    $llama_bat_path = $llama_bat_candidates | Where-Object { Test-Path -Path $_ } | Select-Object -First 1

    if (-not $NoAutoStart -and $llama_bat_path) {
        Write-Host "[NOTICE] llama-server is offline. Auto-launching $llama_bat_path in a new window..." -ForegroundColor Yellow
        Start-Process -FilePath "cmd.exe" -ArgumentList "/k `"$llama_bat_path`"" -WorkingDirectory "C:\llamaCPP"
        Write-Host "[INFO] Loading model weights into VRAM (this may take ~10-15 seconds for 27B)..." -ForegroundColor Yellow

        $llama_wait_seconds = 0
        $llama_max_wait = 25
        while (-not $llama_is_running -and ($llama_wait_seconds -lt $llama_max_wait)) {
            Start-Sleep -Seconds 2
            $llama_wait_seconds += 2
            try {
                $probe_after_llama = Invoke-WebRequest -Uri $llama_endpoint_address -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
                if ($probe_after_llama.StatusCode -eq 200) {
                    Write-Host "[OK] llama.cpp server initialized at 127.0.0.1:8081 (loaded in ${llama_wait_seconds}s)" -ForegroundColor Green
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
            Write-Host "[INFO] llama.cpp server is offline (127.0.0.1:8081). Launch C:\llamaCPP\start_webui_qwen3_8-27b-abliterated_8081.bat. Fallback regex parsing will be used if needed." -ForegroundColor DarkGray
        }
    }
}

# -------------------------------------------------------------------------
# 3. Laya Decision Engine (Fast Attribution & Staging - Port 8765)
# -------------------------------------------------------------------------
$laya_endpoint_address = "http://127.0.0.1:8765/health"
$laya_is_running = $false

try {
    $laya_connection_probe = Invoke-WebRequest -Uri $laya_endpoint_address -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
    if ($laya_connection_probe.StatusCode -eq 200) {
        Write-Host "[OK] Laya decision engine is reachable at 127.0.0.1:8765" -ForegroundColor Green
        $laya_is_running = $true
    }
}
catch {}

if (-not $laya_is_running) {
    $laya_script_path = "C:\Users\Desktop-Dev\Desktop\Laya\start_server.ps1"
    if ($StartLaya -and (Test-Path -Path $laya_script_path)) {
        Write-Host "[NOTICE] Auto-launching Laya (C:\Users\Desktop-Dev\Desktop\Laya\start_server.ps1) in a new window..." -ForegroundColor Yellow
        Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$laya_script_path`"" -WorkingDirectory "C:\Users\Desktop-Dev\Desktop\Laya"
        Start-Sleep -Seconds 3
        try {
            $probe_after_laya = Invoke-WebRequest -Uri $laya_endpoint_address -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($probe_after_laya.StatusCode -eq 200) {
                Write-Host "[OK] Laya decision engine initialized at 127.0.0.1:8765" -ForegroundColor Green
                $laya_is_running = $true
            }
        }
        catch {
            Write-Host "[INFO] Laya launched in a separate window; warming up model..." -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "[INFO] Laya is offline (127.0.0.1:8765). Preserving resources; will load on-demand when fast attribution is selected." -ForegroundColor DarkGray
    }
}

# -------------------------------------------------------------------------
# 4. CLM Decision Engine (Contrastive Language Model - Port 8700)
# -------------------------------------------------------------------------
$clm_endpoint_address = "http://127.0.0.1:8700/health"
$clm_is_running = $false

try {
    $clm_connection_probe = Invoke-WebRequest -Uri $clm_endpoint_address -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
    if ($clm_connection_probe.StatusCode -eq 200) {
        Write-Host "[OK] CLM decision engine is reachable at 127.0.0.1:8700" -ForegroundColor Green
        $clm_is_running = $true
    }
}
catch {}

if (-not $clm_is_running) {
    $clm_script_path = "C:\Users\Desktop-Dev\Desktop\CLM\run_clm_server.ps1"
    if ($StartCLM -and (Test-Path -Path $clm_script_path)) {
        Write-Host "[NOTICE] Auto-launching CLM (C:\Users\Desktop-Dev\Desktop\CLM\run_clm_server.ps1) in a new window..." -ForegroundColor Yellow
        Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$clm_script_path`"" -WorkingDirectory "C:\Users\Desktop-Dev\Desktop\CLM"
        Start-Sleep -Seconds 3
        try {
            $probe_after_clm = Invoke-WebRequest -Uri $clm_endpoint_address -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($probe_after_clm.StatusCode -eq 200) {
                Write-Host "[OK] CLM decision engine initialized at 127.0.0.1:8700" -ForegroundColor Green
                $clm_is_running = $true
            }
        }
        catch {
            Write-Host "[INFO] CLM server launched in a separate window..." -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "[INFO] CLM is offline (127.0.0.1:8700). Preserving resources; will load on-demand when contrastive attribution is selected." -ForegroundColor DarkGray
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

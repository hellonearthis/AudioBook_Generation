<#
.SYNOPSIS
    Easy-start launcher for the AI Audiobook Screenplay Generator & Synthesizer desktop app.

.DESCRIPTION
    WHAT: Checks dependencies, tests connectivity to local AI endpoints (ComfyUI & LM Studio),
          and launches the Electron application in either production or hot-reloading dev mode.
    WHY: Eliminates the friction of remembering npm commands or diagnosing silent connection
         failures with ComfyUI and LM Studio before the Electron window loads.

.PARAMETER Dev
    WHAT: Switch parameter to launch the app using nodemon hot-reload.
    WHY: Lets developers edit UI or renderer scripts and see changes reload immediately.

.EXAMPLE
    .\start.ps1
    Launches the standard application (npm start).

.EXAMPLE
    .\start.ps1 -Dev
    Launches the application in hot-reloading dev mode (npm run dev).
#>

[CmdletBinding()]
param (
    [switch]$Dev
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
} else {
    Write-Host "[OK] Local dependencies installed." -ForegroundColor Green
}

# WHAT: Check connectivity to the local ComfyUI API endpoint (127.0.0.1:8188).
# WHY: Voice synthesis requires ComfyUI to be active; warning the user early saves troubleshooting time.
$comfyui_endpoint_address = "http://127.0.0.1:8188/system_stats"
try {
    $comfyui_connection_probe = Invoke-WebRequest -Uri $comfyui_endpoint_address -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($comfyui_connection_probe.StatusCode -eq 200) {
        Write-Host "[OK] ComfyUI server is reachable at 127.0.0.1:8188" -ForegroundColor Green
    } else {
        Write-Host "[WARN] ComfyUI returned unexpected HTTP status: $($comfyui_connection_probe.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[INFO] ComfyUI is currently offline (127.0.0.1:8188). You can still run Mock Mode or start ComfyUI later." -ForegroundColor DarkGray
}

# WHAT: Check connectivity to the local LM Studio API endpoint (127.0.0.1:1234).
# WHY: Dialogue attribution and cast extraction require LM Studio with an active model loaded.
$lm_studio_endpoint_address = "http://127.0.0.1:1234/v1/models"
try {
    $lm_studio_connection_probe = Invoke-WebRequest -Uri $lm_studio_endpoint_address -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($lm_studio_connection_probe.StatusCode -eq 200) {
        Write-Host "[OK] LM Studio server is reachable at 127.0.0.1:1234" -ForegroundColor Green
    } else {
        Write-Host "[WARN] LM Studio returned unexpected HTTP status: $($lm_studio_connection_probe.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[INFO] LM Studio is currently offline (127.0.0.1:1234). Fallback regex parsing will be used if needed." -ForegroundColor DarkGray
}

Write-Host ""

# WHAT: Launching the Electron application.
# WHY: Spawns the desktop GUI via npm scripts. If -Dev is passed, nodemon hot-reloads on file changes.
Push-Location $project_root_directory_path
if ($Dev) {
    Write-Host ">>> Launching application in DEV MODE (hot-reloading enabled)..." -ForegroundColor Cyan
    npm run dev
} else {
    Write-Host ">>> Launching application in STANDARD MODE..." -ForegroundColor Cyan
    npm start
}
Pop-Location

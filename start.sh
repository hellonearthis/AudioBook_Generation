#!/usr/bin/env bash
# =========================================================================
# AI Audiobook Screenplay Generator & Synthesizer Launcher (macOS / Linux)
# =========================================================================
# WHAT: Pre-flight environment check, dependency validation, and service probing
#       for macOS and Linux platforms with support for config.json and .env.

set -e

PROJECT_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT_DIR"

echo ""
echo "=========================================================="
echo "  AI Audiobook Screenplay Generator & Synthesizer Launcher"
echo "=========================================================="
echo ""

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not installed or not in PATH."
    echo "Please install Node.js (v18+ recommended) from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "[OK] Node.js runtime detected: $NODE_VERSION"

# 2. Check node_modules
if [ ! -d "$PROJECT_ROOT_DIR/node_modules" ]; then
    echo "[NOTICE] node_modules not found. Running npm install..."
    npm install
else
    echo "[OK] Local dependencies installed."
fi

# 3. Read config.json or environment variables if present
CONFIG_FILE="$PROJECT_ROOT_DIR/config.json"
COMFYUI_URL="http://127.0.0.1:8188"
LLAMA_URL="http://127.0.0.1:8081"
LAYA_URL="http://127.0.0.1:8765"
CLM_URL="http://127.0.0.1:8700"

if [ -f "$CONFIG_FILE" ]; then
    echo "[INFO] Reading configuration from config.json"
    COMFYUI_URL=$(node -e "try { const c = require('./config.json'); console.log(c.comfyui_url || '$COMFYUI_URL'); } catch { console.log('$COMFYUI_URL'); }")
    LLAMA_URL=$(node -e "try { const c = require('./config.json'); console.log(c.llama_url || '$LLAMA_URL'); } catch { console.log('$LLAMA_URL'); }")
    LAYA_URL=$(node -e "try { const c = require('./config.json'); console.log(c.laya_url || '$LAYA_URL'); } catch { console.log('$LAYA_URL'); }")
    CLM_URL=$(node -e "try { const c = require('./config.json'); console.log(c.clm_url || '$CLM_URL'); } catch { console.log('$CLM_URL'); }")
fi

# Override with environment variables if set
COMFYUI_URL="${COMFYUI_URL:-$COMFYUI_URL}"
LLAMA_URL="${LLAMA_URL:-$LLAMA_URL}"
LAYA_URL="${LAYA_URL:-$LAYA_URL}"
CLM_URL="${CLM_URL:-$CLM_URL}"

# 4. Probe AI Endpoints
check_endpoint() {
    local name="$1"
    local url="$2"
    if curl -s --connect-timeout 2 "$url" >/dev/null 2>&1; then
        echo "[OK] $name server is reachable at $url"
        return 0
    else
        echo "[INFO] $name is offline ($url)."
        return 1
    fi
}

check_endpoint "ComfyUI" "${COMFYUI_URL%/}/system_stats" || true
check_endpoint "llama.cpp" "${LLAMA_URL%/}/v1/models" || true
check_endpoint "Laya" "${LAYA_URL%/}/health" || true
check_endpoint "CLM" "${CLM_URL%/}/health" || true

echo ""

# 5. Launch Electron
if [ "$1" = "-Dev" ] || [ "$1" = "--dev" ]; then
    echo ">>> Launching application in DEV MODE (hot-reloading enabled)..."
    npm run dev
else
    echo ">>> Launching application in STANDARD MODE..."
    npm start
fi

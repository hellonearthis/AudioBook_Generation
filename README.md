# Multi-Speaker AI Audiobook Generator & Synthesizer

A local, offline desktop application built using **Electron**, designed to automate the process of converting raw book manuscripts into multi-speaker, context-aware screenplay audiobooks. It coordinates local instances of **LM Studio** (for dialogue extraction and acting directions) and **ComfyUI** (for voice synthesis) using high-performance, native Node.js processing queues and pure JavaScript PCM WAV stream compilers.

---

## Key Features

*   **Global Cast Discovery (Pass 1)**: Automatically reads sample book excerpts to discover characters, personality dynamics, age groups, and gender presets using local LLMs.
*   **Dialogue Attribution (Pass 2)**: Converts raw prose paragraphs into formatted screenplay segments, attributing speaker identities and resolving pronouns (`he`, `she`, `they`) in the local context.
*   **Stage Staging directions (Pass 3)**: Generates acting and performance guides (e.g. *"whispered, high tension"*, *"confident, shouting over wind"*) as parenthetical script directions to alter voice TIMBRE, pitch, and timing variations.
*   **Sequential Synthesis Worker (Pass 4)**: Enqueues and compiles audio lines one-by-one in the background main thread to safeguard local CPU/GPU hardware capacities.
*   **Pure JS WAV Stitcher (Pass 5)**: Merges segment audios together entirely in native Javascript, stripping PCM WAV headers to prevent pops and injecting natural breathing pauses between alternating speakers.
*   **Timeline Marker Exporter**: Generates companion CSV marker sheets mapping character spoken events directly to timeline offsets for quick DAW imports.
*   **Timbre Mapping Matrix**: A dedicated configuration panel to randomize speech seeds and map ComfyUI voice profiles to active cast lists.
*   **Developer Dev Mode**: Active file watcher with full hot-restarting capabilities.

---

## System Architecture

The application coordinates two offline systems without native database requirements or external dependencies like `fluent-ffmpeg`:

```
+--------------------------------------------------------+
|                    ELECTRON APP                        |
|                                                        |
|  +-------------------+          +-------------------+  |
|  |  Renderer (UI)    |<-------->|   Main Process    |  |
|  |  - Script Editor  |   IPC    |   - File System   |  |
|  |  - Voice Map Mgr  |          |   - API Client    |  |
|  +-------------------+          +-------------------+  |
+------------------------------------------|-------------+
                                           |
                +--------------------------+--------------------------+
                |                                                     |
                v (Port 1234)                                         v (Port 8188)
    +-----------------------+                             +-----------------------+
    |       LM STUDIO       |                             |       COMFYUI         |
    |  (Gemma-4-12b Parsing)|                             |  (TTS Audio Engine)   |
    +-----------------------+                             +-----------------------+
```

---

## Core Pipeline Details

### Pass 1: Global Cast Discovery
Uses local LLM endpoints (`/v1/chat/completions`) to analyze raw text segments and discover character casts. Characters are automatically added to the Global Voice Matrix.

### Pass 2: Dialogue Attribution & Script Parsing
Attributes prose blocks to narrator or character speakers.
*   *Offline Fallback*: If the local LLM is offline, a built-in regex parser automatically splits narrator segments and quotation blocks (`"Speech"`) to keep pipeline operations active.

### Pass 3: Contextual Stage Directions
Reads a sliding 3-sentence window surrounding each line to generate vocal delivery instructions, providing stage guidance for Instruct-TTS models.

### Pass 4: Voice Casting & Speech Synthesis
Maintains a sequential queue in the background process to feed text and acting directions to ComfyUI.
*   *Offline Mock Mode*: Programmatically generates valid, playable 1.5-second silent WAV files natively via custom Node buffers, allowing you to test the entire application pipeline fully offline without local AI servers active.

### Pass 5: Dynamic Assembly & Audio Stitching
Concatenates WAV PCM buffers natively, inserting silent zero-byte intervals to mimic breathing delays. Exports chronological marker lists to `timeline_markers.csv`.

---

## Script Editor Buttons Explained

The **Script Editor** view has two buttons in its header that look similar but serve different purposes:

### "Automate Attribution" (right pane header)
Runs the full **Pass 2 LLM dialogue attribution pipeline** directly against the raw book text that is **already saved** inside the project state. Use this when:
- You have just opened a project for the first time and want to generate screenplay cards.
- You want to re-run attribution without having edited the source text.

### "Reparse Text" (left pane header)
Does two things in sequence:
1. **Saves** whatever text is currently typed in the left raw-source textarea back into the project's `rawBookText` field (flushing it to `project_state.json` on disk).
2. **Then** runs the exact same attribution pipeline as **Automate Attribution**.

Use this when:
- You have **manually edited, trimmed, or corrected** the raw source text in the left pane and want the screenplay cards to reflect your changes.
- You want to re-attribute a different excerpt or chapter without creating a new project.

> **In short**: if you haven't touched the source text, use **Automate Attribution**. If you've made changes in the left pane, use **Reparse Text** to save them first.

---

## External Services & Workflows Setup

### 1. LM Studio Configuration
*   Ensure LM Studio is running on your system.
*   Load a model capable of context attribution (e.g., `google/gemma-4-12b` or `google/gemma-4-e4b` or similar chat models).
*   By default, the application connects to the local endpoint `http://127.0.0.1:1234/v1`. This is configured on the Settings page of the app.

### 2. ComfyUI Configuration & Custom Paths
*   The application interfaces with ComfyUI to save and load voice presets, and synthesize WAV audio clips.
*   By default, the application resolves ComfyUI's installation directory dynamically (checking `C:\cui` first, followed by desktop output shortcuts).
*   **Custom Configurations**: To define a custom ComfyUI installation path, create a `config.json` file in the root of this project:
    ```json
    {
      "comfyui_path": "C:\\your-custom-comfyui-path"
    }
    ```
    *(Note: This file is ignored by git so your local paths remain private.)*

### 3. Importing & Testing Workflows in ComfyUI
*   The `comfyui_workflows/` directory contains JSON templates for the backend API calls (files ending with `_api.json` or `_API.json`).
*   **Non-API versions** (files without the `_api` suffix, e.g., `QWEN3-TTS-loadCustomVoice.json`, `QWEN3-TTS-saveCustomVoice.json`, and `Qwen3-tts-DesignVoice.json`) are also included in the same folder.
*   You can drag-and-drop or load these non-API JSON workflows directly into the ComfyUI web UI to manually test your nodes, verify model configurations, or troubleshoot your generation pipeline visually.

---

## Quick Start & Dev Setup

### 1. Install Packages
Verify or install necessary dependencies:
```powershell
npm install
```

### 2. Launch the Application (Standard)
Start the desktop Electron frame:
```powershell
npm start
```

### 3. Launch in Developer Dev Mode (Hot-Reloading)
To edit styles, script cards, or file controllers and see updates relaunch instantly on save:
```powershell
npm run dev
```

### Handy Developer Shortcuts
When the application is running, you can use these shortcuts to debug and inspect:
*   **`Ctrl + R`** (or `F5`): Reloads the HTML layout and style configurations without restarting the core desktop process.
*   **`Ctrl + Shift + I`** (or `F12`): Opens the Chromium DevTools console directly inside Electron to inspect styles and log API payloads.

---

## Manual Walkthrough & Verification

1.  **Open Workspace**: Boot the app, click **Select Workspace** at the top of the Projects Dashboard, and pick your active workspace folder.
2.  **Initialize Project**: Enter a book title (e.g. *The Cabin Valley*) in the dashboard form, paste raw text paragraphs into the text box, and click **Create Audiobook Project**.
3.  **Attribute Script**: In the **Script Editor** view, click **Automate Attribution** to split paragraphs into interactive screenplay blocks.
4.  **Verify Timbre Map**: Switch to the **Voice Matrix** tab to see identified characters, adjust ComfyUI preset drop-downs, or randomize synthesis seeds.
5.  **Run Synthesis**: Toggle **Mock Offline Mode** in the top-right header, then click **Synthesize Audiobook** in the Script Editor pane to watch files write sequentially in real-time.
6.  **Stitch & Listen**: Switch to the **Assembly Console** tab, click **Stitch Concatenated Master (Pass 5)**, and click **Listen Master** to activate visualizers and play your finished audiobook.

# Multi-Speaker AI Audiobook Generator & Synthesizer

A local, offline desktop application built using **Electron**, designed to automate the process of converting raw book manuscripts into multi-speaker, context-aware screenplay audiobooks. It coordinates local instances of **Laya Fast Decision Engine** (for sub-25ms dialogue attribution and emotional staging), **llama.cpp** / **llama-server** (for character cast discovery and deep intent extraction), and **ComfyUI** (for AuK and Qwen voice synthesis & audio editing) using high-performance, native Node.js processing queues and pure JavaScript PCM WAV stream compilers.

---

## Key Features

*   **Global Cast Discovery (Pass 1)**: Automatically reads sample book excerpts to discover characters, personality dynamics, age groups, and gender presets using local LLMs (`llama-server.exe` on port 8081).
*   **Sub-25ms Laya Dialogue Attribution (Pass 2)**: Replaces slow autoregressive LLM token generation with **Laya's non-autoregressive ModernBERT classifier**, executing quote attribution in **~18–25ms per line**.
*   **📖 Unmarked Dialogue / Literary Prose Mode**: First-class support for quotation-free prose (e.g., Cormac McCarthy, James Joyce). Decouples dialogue boundary detection (Stage 2A via local LLM or syntactic speech-tag rules) from speaker attribution and emotional staging (Stage 2B via Laya ModernBERT).
*   **Multi-Engine Attribution Selector**: Switch dynamically between:
    *   `⚡ Laya Fast (~20ms)`: Ultra-fast ModernBERT classification against the active Voice Matrix cast list.
    *   `🎯 CLM-8B System One (~100ms)`: High-capacity contrastive language model (`C:\Users\Desktop-Dev\Desktop\CLM` on port 8700) powered by Qwen3-8B embeddings for nuanced literary prose.
    *   `⚡🎯 Cascade (Laya → CLM)`: High-throughput Laya pass with automatic contrastive escalation to CLM-8B whenever speaker confidence falls below 85%.
    *   `⚡🧠 Hybrid (Laya + llama)`: Sub-second attribution with automatic fallback to llama-server if Laya is offline.
    *   `🧠 llama.cpp (Deep LLM)`: Full generative LLM parsing via local GGUF models.
*   **Integrated Emotional Staging & Energy Scoring (Pass 3)**: Analyzes dialogue context to classify acting delivery across an 8-state AuK emotion palette (`calm`, `whisper`, `fearful`, `angry`, `sad`, `happy`, `excited`, `surprised`) and scores vocal energy/intensity.
*   **Confidence Badges & Ambiguity Alerts**: Visual confidence indicators (`⚡ 95%` or amber `⚡ 42%`) and `📖 Unmarked` badges highlight dialogue spans and ambiguous lines for instant user review.
*   **Sequential Synthesis Worker (Pass 4)**: Enqueues and compiles audio lines one-by-one in the background main thread to safeguard local CPU/GPU hardware capacities.
*   **🧬 AuK Zero-Shot Voice Clone & Audio Editing Suite**: 17 ComfyUI workflows for zero-shot cloning, whisper conversion, pitch/speed shifts, de-accenting, and speech enhancement.
*   **Pure JS WAV Stitcher (Pass 5)**: Merges segment audios together entirely in native Javascript, stripping PCM WAV headers to prevent pops and injecting natural breathing pauses between alternating speakers.
*   **Timeline Marker Exporter**: Generates companion CSV marker sheets mapping character spoken events directly to timeline offsets for quick DAW imports.
*   **Timbre Mapping Matrix**: A dedicated configuration panel to randomize speech seeds, lock in master vocal anchors, and map voice profiles to active cast lists.
*   **🔬 Independent Laya QC & Calibration Engine**: Audits Qwen's character presence, relationship citations (5-item taxonomy), dialogue attribution (narrow-window independence), and emotional delivery (binary noul decomposition). Logs uncalibrated probabilities to disk and fits task temperatures dynamically via negative log-likelihood line search.
*   **🧩 Modular Main Service Architecture**: Decomposed from a monolithic process into 7 decoupled domain services (`services/`) governing workspaces, FFmpeg timelines, Laya/CLM classification, AI LLM pipelines, audio queues, AuK post-production, and VRAM health arbitration.
*   **⏳ Dynamic Relationship State Timelines**: Discovers character relationships with chronological state progression across chapters and segments, accounting for shifting dynamics, emotional estrangement, and narrative triggers.
*   **🎭 Two-Level Voice Division of Labour**: Splits static character identity (designed once via Qwen3 VoiceDesign into reference audio anchors) from dynamic line delivery (rendered via AuK Zero-Shot with natural emotional instructions, relationship subtext, and auto-estimated durations).
*   **Auto-Start Launcher (`start.ps1`)**: Automatically checks and spawns ComfyUI, llama-server, and Laya if any service is offline.

---

## System Architecture

The application coordinates local AI microservices through an asynchronous, modular Electron architecture:

```
+-------------------------------------------------------------------------------------------------+
|                                          ELECTRON APP                                           |
|                                                                                                 |
|  +-----------------------------+               +---------------------------------------------+  |
|  |  Renderer (UI)              |<------------->|   Main Orchestrator (main.js)               |  |
|  |  - Script Editor & Engine   |      IPC      |   Decomposed into specialized services:     |  |
|  |  - Voice Matrix & Timeline  |               |   - services/workspace_service.js           |  |
|  |  - AuK Postprod Suite       |               |   - services/audio_ffmpeg_service.js        |  |
|  |  - Project State & Takes    |               |   - services/laya_clm_service.js            |  |
|  +-----------------------------+               |   - services/ai_pipeline_service.js         |  |
|                                                |   - services/audio_queue_service.js         |  |
|                                                |   - services/auk_postprod_service.js        |  |
|                                                |   - services/service_health_service.js      |  |
|                                                +---------------------------------------------+  |
+-------------------------------------------------------|-----------------------------------------+
                                                        |
         +--------------------------+-------------------+--------------------+--------------------+
         |                          |                                        |                    |
         v (Port 8765)              v (Port 8700)                            v (Port 8081)        v (Port 8188)
+------------------+       +-------------------------+              +------------------+  +-------------------+
|   LAYA ENGINE    |       |       CLM ENGINE        |              | LLAMA.CPP SERVER |  |      COMFYUI      |
|   (ModernBERT)   |       |   (CLM-v0.1-8B + Qwen)  |              |(llama-server.exe)|  |(TTS Audio Engine) |
| - ~18-25ms Quote |       | - ~75-180ms System One  |              | - Pass 1: Cast   |  | - AuK & Qwen3 TTS |
|   Attribution    |       | - Deeper literary prose |              |   Discovery      |  | - 17 Workflows    |
| - Pass 3: Acting |       | - High-semantic subtext |              | - Deep Directing |  | - Take Editor     |
| - Energy Scoring |       | - Cascade escalation    |              | - State Timelines|  | - Voice Cloning   |
+------------------+       +-------------------------+              +------------------+  +-------------------+
```

### Modular Backend Services (`services/`)

1. **`services/workspace_service.js`**: Manages workspace directory selection, multi-project file loading and saving (`project_state.json`), take file deletion, and native context menus.
2. **`services/audio_ffmpeg_service.js`**: Performs silent-padded multi-take timeline stitching via native FFmpeg, parses timeline markers CSV files, probes audio metadata durations, and streams binary buffers to Peaks.js.
3. **`services/laya_clm_service.js`**: Bridges the sub-25ms ModernBERT Laya Decision Engine and CLM-8B System One, manages empirical calibration logging, and coordinates contrastive escalation.
4. **`services/ai_pipeline_service.js`**: Executes LLM extraction, JSON parsing with repair heuristics, style attribute merging, and unmarked literary prose boundary detection.
5. **`services/audio_queue_service.js`**: Runs the sequential audio generation worker, AuK Zero-Shot instruction compilation, anchor baking, word-count duration calculations, and ComfyUI queue polling.
6. **`services/auk_postprod_service.js`**: Executes non-destructive AuK post-production workflows (whisper conversion, pitch shift, speed adjustment, volume editing, emotion morphing, de-accenting, and speech enhancement).
7. **`services/service_health_service.js`**: Controls on-demand microservice launching, health probing, and bidirectional VRAM eviction (`/free` and auto-sleep synchronization).

---

## Core Pipeline Details

### Pass 1: Global Cast Discovery & Dynamic Relationship Timelines
Uses local LLM endpoints (`http://127.0.0.1:8081/v1/chat/completions`) with `prompts/cast_discovery.txt` to discover character personas, age groups, vocal traits, and **chronological relationship state timelines**.

#### Dynamic Relationship Timeline Schema:
Unlike static relationship labels, character dynamics evolve across chapters:
```json
{
  "relationships": [
    {
      "id": "maren_josh",
      "a": "Maren",
      "b": "Josh",
      "states": [
        {
          "from": { "chapter": 1, "segment": 1 },
          "relation_type": "family",
          "relation_tone": "warm",
          "status": "current",
          "power_dynamic": "a_over_b",
          "trigger": null
        },
        {
          "from": { "chapter": 7, "segment": 3 },
          "relation_type": "family",
          "relation_tone": "tense",
          "status": "current",
          "power_dynamic": "equal",
          "trigger": "Josh finds the forged will"
        },
        {
          "from": { "chapter": 12, "segment": 1 },
          "relation_type": "family",
          "relation_tone": "hostile",
          "status": "estranged",
          "power_dynamic": "b_over_a",
          "trigger": "Open confrontation at the courthouse"
        }
      ]
    }
  ]
}
```
*   **State Resolution (`resolve_relationship_state_at_position`)**: Automatically resolves the active relational tone, power dynamic, and status for any line based on its current chapter and segment position.
*   **Relational Delivery Conditioning**: Directly feeds the resolved relationship state into AuK's directorial instructions for authentic dramatic tension.

### Pass 2: Dialogue Attribution & Script Parsing
Attributes prose blocks to narrator or character speakers using the selected engine:
*   **⚡ Laya Fast (~20ms)**: Uses local ModernBERT non-autoregressive decision calls against active cast profiles. Completely avoids LLM latency, token limits, and JSON hallucination errors.
*   **⚡🧠 Hybrid (Laya + llama)**: Runs Laya for maximum speed; if Laya encounters connection issues or is offline, it seamlessly falls back to llama.cpp.
*   **🧠 llama.cpp**: Uses the local GGUF model via llama-server for full open-ended generative extraction.
*   **📖 Unmarked Dialogue (Literary Mode)**: When enabled, raw text is first processed through Stage 2A boundary detection (via `prompts/unmarked_span_detection.txt` or a syntactic speech-tag rule engine) to isolate spoken segments from surrounding narration without modifying original text. Spoken spans are then fed into Stage 2B (Laya Decision Engine) for sub-25ms attribution, emotional staging, and energy scoring.
*   *Offline Fallback*: If both local AI services are offline, a built-in regex parser automatically separates narrator exposition and quoted lines (`"Speech"`).

### Pass 3: Emotional Staging & Directorial Guides
Extracts emotional delivery instructions (`whisper`, `fearful`, `angry`, `calm`, etc.) and vocal intensity metrics (`energy` score). These are mapped to parenthetical directions and AuK performance cues to drive expressive TTS synthesis.

### Pass 4: Voice Casting & Speech Synthesis
Maintains a sequential queue in the background process to feed text, actor directions, and voice reference clips to ComfyUI.
*   *Offline Mock Mode*: Programmatically generates valid, playable 1.5-second silent WAV files natively via custom Node buffers, allowing you to test the entire application pipeline fully offline without local AI servers active.

### Pass 5: Dynamic Assembly & Audio Stitching
Concatenates WAV PCM buffers natively, inserting silent zero-byte intervals to mimic natural breathing delays. Exports chronological marker lists to `timeline_markers.csv`.

---

## Script Editor Buttons Explained

The **Script Editor** view has controls designed for specific stages of script preparation:

### "Attribution Engine" Dropdown (Pane 2 Header)
Selects the decision engine used when running attribution:
*   **⚡ Laya Fast (~20ms)**: Recommended default. Runs closed-set classification across active Voice Matrix characters.
*   **🎯 CLM-8B System One (~100ms)**: Runs local Contrastive Language Model (`C:\Users\Desktop-Dev\Desktop\CLM`) on port 8700 for deeper contextual comprehension of ambiguous characters and literary prose.
*   **⚡🎯 Cascade (Laya → CLM)**: Two-tiered pipeline. Fast ModernBERT classifies high-confidence lines; ambiguous quotes (< 85% confidence) are automatically escalated to CLM-8B.
*   **⚡🧠 Hybrid (Laya + llama)**: High-speed Laya classification with automatic llama-server fallback.
*   **🧠 llama.cpp (Deep LLM)**: Full autoregressive token parsing.

### "📖 Unmarked Prose" Checkbox (Pane 2 Header)
Enables two-stage attribution for literary texts lacking quotation marks:
*   **Stage 2A (Boundary Detection)**: Isolates spoken sentences/clauses from narration using generative context analysis or syntactic speech verbs (`said`, `whispered`, `replied`).
*   **Stage 2B (Attribution & Staging)**: Pipes detected dialogue spans to Laya on port 8765 for character matching, emotion classification, and energy scoring.
*   Screens displaying unmarked dialogue items render a distinct `📖 Unmarked` badge on each card.

### "Automate Attribution" (Pane 2 Header)
Runs the attribution pipeline directly against the raw book text **already saved** inside the project state. Use this when:
*   You have just opened a project for the first time and want to generate screenplay cards.
*   You want to re-run attribution with a different engine without re-typing source text.

### "Reparse Text" (Pane 1 Header)
Does two things in sequence:
1. **Saves** whatever text is currently typed in the left raw-source textarea back into the project's `rawBookText` field (flushing it to `project_state.json` on disk).
2. **Then** runs the exact same attribution pipeline as **Automate Attribution**.

Use this when:
*   You have **manually edited, trimmed, or cleaned** the raw source text in the left pane and want the screenplay cards to reflect your changes.

> **In short**: If you haven't touched the source text, use **Automate Attribution**. If you've made changes in the left pane, use **Reparse Text** to save them first.

---

## Character Voice Design & Synthesis Rules

### The Two-Level Division of Labour: Identity vs Delivery
To achieve vocal consistency across an entire novel while allowing expressive emotional performance, the system splits character audio synthesis into two distinct operational levels:

```
+-----------------------------------------------------------------------------------------------+
| LEVEL 1: STATIC CHARACTER IDENTITY (Qwen3 VoiceDesign)                                       |
| - Created ONCE per character from written personality & vocal descriptions                     |
| - Baked into a clean reference audio clip (master physical anchor in audio/anchors/)         |
| - Encodes the character's physical vocal cords: pitch floor, age rasp, gender, resonance      |
+-----------------------------------------------------------------------------------------------+
                                                │
                                                ▼  (Locked Reference Anchor WAV)
+-----------------------------------------------------------------------------------------------+
| LEVEL 2: DYNAMIC LINE DELIVERY (AuK Zero-Shot Clone & Directorial Synthesis)                 |
| - Executed PER LINE in the Screenplay Editor                                                 |
| - Speaks new line text in the exact voice timbre of the Level 1 reference clip               |
| - Instruction carries delivery nuances: primary emotion, secondary emotion, intensity        |
| - Dynamic context: incorporates resolved Relationship State (tone, power dynamic)             |
| - Auto-calculates duration hint: gen_seconds estimated from line word count                   |
+-----------------------------------------------------------------------------------------------+
```

1. **The Custom Preset (Default Workflow)**
   By default, if no specific workflow is configured (defaulting to "inherit"), the system uses the `Qwen3-TTS-CustomVoice_API` workflow. It leverages pre-defined preset voices (like `Eric`, `Dylan`, or `Serena`) and dynamic acting prompts combined with a **deterministic seed** derived from a hash of the speaker's name. This ensures the character always has a consistent baseline voice profile across runs.

2. **The Character Designer (Voice Design Pipeline)**
   When you generate a test phrase on the **Characters** page, the system uses the `Qwen3-TTS-DesignVoice_API` workflow. It automatically compiles a comprehensive "Character Card" from Voice Profile, Identity & Background, and Personality Traits fields to design a completely new voice from scratch.

3. **⭐ The Anchor Lock-in Mechanism**
   Because the Design Pipeline creates a new voice dynamically based on the text it reads, it is prone to acoustic drift. To prevent this, click **"⭐ Lock in character"** on the design page once you find a voice you like.
   *   **What happens when you lock in?** The system saves that specific generated audio file to disk as the master physical anchor (`master_voice.wav`) and permanently locks the random seed and parameter states.
   *   **Editing locked characters:** Making further edits to the Character Card text inputs will NOT affect the script editor unless you generate a new test phrase and explicitly click "⭐ Lock in character" again.

4. **The Script Editor (Voice Clone Pipeline)**
   The Script Editor page **exclusively uses locked-in characters** for custom cast profiles. It routes generation requests through the `Qwen3-TTS-loadCustomVoice_API` (or VoiceClone) workflow, cloning the vocal cords of your locked-in master anchor while applying the acting emotions from the script line. **You cannot synthesize lines in the Script Editor for a character whose voice has not been explicitly locked in.**

5. **🧬 AuK Zero-Shot Voice Clone (`AuK-02`) & Instruct-TTS (`AuK-01`)**
   Supports ComfyUI native AuK models. Assign any reference audio file (or master anchor) to a character and use `AuK-02-Voice-Clone` to generate dialogue matching that reference without requiring reference transcripts. For characters without audio samples, `AuK-01-Instruct-TTS` synthesizes speech directly from descriptive text prompts.
   *   **Natural Instruction Synthesis**: AuK instructions are dynamically compiled from the line's emotional staging and relationship dynamic (e.g., *"Speak with bitter anger and hurt at high intensity. Spoken to Josh (family, hostile, b_over_a)."*).
   *   **Smart Duration Estimation (`gen_seconds`)**: Automatically computes the optimal generation window based on speech word-count rate (~2.5 words/sec + 1.2s buffer) to eliminate trailing silence while preventing cutoff.

6. **🪄 AuK Audio Editing Suite (`AuK-03` through `AuK-17`)**
   Every generated take card features a **"🪄 Edit Take"** action to non-destructively transform audio:
   *   **🤫 Whisper Conversion (`AuK-12`)**: Converts normal speech into an intimate whisper.
   *   **🧹 Denoise & Enhance (`AuK-13`)**: Removes background noise and boosts clarity.
   *   **🎵 Pitch Shift (`AuK-05`)**: Shifts pitch by discrete semitones (`±1, ±2, ±3`).
   *   **⚡ Speed Adjustment (`AuK-06`)**: Multiplies speaking tempo (`0.5x, 0.75x, 1.25x, 1.5x, 2.0x`).
   *   **🔊 Volume Adjustment (`AuK-07`)**: Boosts or attenuates dB level (`±5, ±10, ±15 dB`).
   *   **🎭 Emotion Morphing (`AuK-08`)**: Alters emotional tone (`sad`, `angry`, `happy`, `fearful`, `excited`).
   *   **🗣️ De-accent (`AuK-10`)**: Softens regional accent.
   *   **📝 Speech Content Edit (`AuK-03`)**: Re-speaks targeted phrases in existing audio (`[replace]`, `[insert]`, `[remove]`).
   *   *Non-Destructive*: All edits produce a new incremental take (e.g. `Take 2`) so your original take remains intact for A/B comparison.
   *   *Full Workflow Directory*: See [comfyui_workflows/AuK COOKBOOK.md](comfyui_workflows/AuK%20COOKBOOK.md) for the complete directory of all 17 workflows.

---

## External Services & Workflows Setup

### 1. On-Demand AI Service Architecture (`start.ps1`)
Running `.\start.ps1` boots the application with an on-demand, resource-conscious lifecycle:
*   **llama-server (8081)**: Auto-starts if offline. Powers **Stage 1 (Pass 1)** character cast discovery, relationships, and script writing with `qwen3.8-27b-abliterated`. Auto-sleeps after 10s idle to release VRAM.
*   **ComfyUI (8188)**: **Loads on demand at audio generation time**. When you click "Synthesize Classic" or "Synthesize Directorial", the backend automatically spins up `C:\cui\goLow.ps1`, generates the takes, and evicts models (`/free`) when finished. (Pass `-StartComfyUI` to pre-warm on boot).
*   **Laya Decision Engine (8765)**: **Loads on demand during attribution**. Only spins up if you select `⚡ Laya Fast`, `Cascade`, or `Hybrid` in the Screenplay Editor. (Pass `-StartLaya` to pre-warm on boot).
*   **CLM System One (8700)**: **Loads on demand during attribution**. Only spins up if you select `🎯 CLM-8B System One` or `Cascade`. (Pass `-StartCLM` to pre-warm on boot).

If you prefer to manage all services manually:
```powershell
.\start.ps1 -NoAutoStart
```

### 2. Laya Fast Decision Engine Reference & Setup (Port 8765)
*   **Overview**: A sub-25ms non-autoregressive ModernBERT classifier specialized for closed-set character dialogue attribution, emotional acting delivery, and vocal intensity scoring.
*   **Local Directory**: `C:\Users\Desktop-Dev\Desktop\Laya`
*   **Startup Command**:
    ```powershell
    cd C:\Users\Desktop-Dev\Desktop\Laya
    .\start_server.ps1
    ```
*   **Network Protocol & Endpoints**:
    *   `POST http://127.0.0.1:8765/decide`: Primary inference route accepting `{ state, questions }`.
    *   `GET http://127.0.0.1:8765/health`: Health probe returning loaded model state.
*   **Payload Wire Schema (TypeSafe / Jev Compatible)**:
    ```json
    {
      "state": "Preceding: John turned slowly.\nSpoken: \"Where have you been?\"",
      "questions": {
        "speaker": {
          "type": "choice",
          "instructions": "Which character speaks this dialogue?",
          "criteria": { "John": "Spoken by John", "Mary": "Spoken by Mary", "Narrator": "Exposition" }
        },
        "emotion": {
          "type": "choice",
          "instructions": "What is the emotional delivery?",
          "criteria": { "calm": "Neutral", "angry": "Aggressive", "whisper": "Hushed" }
        },
        "energy": {
          "type": "score",
          "instructions": "Rate vocal volume and intensity",
          "criteria": ["soft murmur", "moderate conversational volume", "shouting / forceful"]
        }
      }
    }
    ```
*   **Hardware Profile**: Negligible RAM/VRAM footprint (< 1 GB, or pure CPU inference). Leaves 100% of GPU resources available for heavy ComfyUI speech synthesis.
*   **QC & Empirical Calibration**:
    *   Logs uncalibrated decisions to [`benchmarks/qc_calibration_log.jsonl`](benchmarks/qc_calibration_log.jsonl).
    *   Run calibration optimization via: `node scripts/fit_calibration.js`.
    *   Writes temperature constants and confidence bounds to [`benchmarks/calibrated_qc_config.json`](benchmarks/calibrated_qc_config.json).

---

### 3. CLM (Contrastive Language Model v0.1-8B) Reference & Setup (Port 8700)
*   **Overview**: A System One contrastive architecture combining a frozen `Qwen/Qwen3-8B` 4096-dimensional embedding backbone with dual 512-dimensional trained MLP projection heads (`state_head` and `action_head`, ~18.8M parameters, ~75.5 MB) evaluated via normalized cosine compatibility.
*   **Local Directory**: `C:\Users\Desktop-Dev\Desktop\CLM`
*   **Model Source**: [Contrastive-LM/CLM-v0.1-8B](https://huggingface.co/Contrastive-LM/CLM-v0.1-8B)
*   **Prerequisites**: Requires an OpenAI-compatible `/v1/embeddings` endpoint returning 4096-dim embeddings for `Qwen/Qwen3-8B` on port `8090`.
*   **Setup & Launch Modes**:
    *   **Option A: Instant Demo / Mock Mode** (Test UI and pipelines without loading the 8B model):
        ```powershell
        cd C:\Users\Desktop-Dev\Desktop\CLM
        .\run_playground_mock.ps1
        # Or: python tools/playground_mock.py --port 8700
        ```
    *   **Option B: Full Production Serving**:
        ```powershell
        # 1. Start Qwen3-8B embedding endpoint (port 8090) using vLLM or LM Studio:
        vllm serve Qwen/Qwen3-8B --served-model-name qwen3-8b --runner pooling --enforce-eager --max-model-len 2048 --port 8090
        
        # 2. Launch the CLM decision server (port 8700):
        cd C:\Users\Desktop-Dev\Desktop\CLM
        .\run_clm_server.ps1 -Port 8700 -EmbUrl "http://127.0.0.1:8090/v1/embeddings"
        ```
*   **Network Protocol & Endpoints**:
    *   `POST http://127.0.0.1:8700/v1/systemone`: Evaluates `{ state, questions }` with calibrated choice distributions and noul probabilities.
    *   `POST http://127.0.0.1:8700/v1/rank`: Direct candidate ranking endpoint.
    *   `GET http://127.0.0.1:8700/health`: Embedder connectivity and cache diagnostics.
    *   `GET http://127.0.0.1:8700/`: Interactive Web Playground.
*   **When to Use CLM**:
    *   **Unmarked literary prose**: Novels without quotation marks (e.g. Cormac McCarthy, James Joyce) where speakers must be inferred from subtle phrasing.
    *   **Ambiguous pronoun chains**: When speakers alternate without explicit dialogue tags over multiple lines.
    *   **Directorial subtext**: Fine-grained emotional undertones (sarcasm, suppressed grief, tension).

---

### 4. Decision Engine Comparison & Cascade Strategy

| Metric | ⚡ Laya Fast (Port 8765) | 🎯 CLM-8B System One (Port 8700) | ⚡🎯 Smart Cascade (Laya → CLM) |
| :--- | :--- | :--- | :--- |
| **Model** | ModernBERT Classifier | Frozen Qwen3-8B + CLM Projection Heads | ModernBERT + CLM-8B Fallback |
| **Latency** | **~18–25 ms / line** | **~75–180 ms / line** | **~25 ms avg / line** |
| **VRAM Impact** | Negligible (< 1 GB) | Moderate (6–16 GB for 8B backbone) | Negligible for 90% of lines |
| **Best For** | High-speed processing of standard novels | Ambiguous literary prose & deep subtext | Optimal balance of speed and precision |

*   **How Smart Cascade Works**:
    1. Laya evaluates the dialogue quote in ~20ms.
    2. If speaker confidence is $\ge 85\%$, the decision is auto-accepted with badge `⚡ 92%`.
    3. If speaker confidence is $< 85\%$ (ambiguous), the line is automatically escalated to CLM-8B (`POST /v1/systemone`) and badged with `⚡🎯 91%`.

---

### 5. llama.cpp / llama-server Configuration
*   **Path**: `C:\llamaCPP\llama-server.exe`
*   **Start Script**: `C:\llamaCPP\start_webui_qwen3_8-27b-abliterated_8081.bat`
*   **Endpoint**: `http://127.0.0.1:8081/v1` (with `/v1/chat/completions`)
*   Load an instruction-tuned model capable of structured JSON dialogue extraction (e.g. `qwen3.8-27b-abliterated`). Context size is set to `8192` with `max_tokens` clamped to `4096`.

### 6. ComfyUI Configuration & Custom Paths
*   The application interfaces with ComfyUI (`http://127.0.0.1:8188`) to save and load voice presets, synthesize WAV audio clips, and execute AuK editing workflows.
*   By default, the application resolves ComfyUI's installation directory dynamically (checking `C:\cui` first, followed by desktop output shortcuts).
*   **Custom Configurations**: To define a custom ComfyUI installation path, create a `config.json` file in the root of this project:
    ```json
    {
      "comfyui_path": "C:\\your-custom-comfyui-path"
    }
    ```
    *(Note: This file is ignored by git so your local paths remain private.)*

### 7. Importing & Testing Workflows in ComfyUI
*   The `comfyui_workflows/` directory contains JSON templates for backend API calls (files ending with `_api.json` or `_API.json`).
*   **Non-API versions** (files without the `_api` suffix, e.g., `AuK-01-Instruct-TTS.json`, `AuK-02-Voice-Clone.json`, `QWEN3-TTS-loadCustomVoice.json`) are also included in the same folder.
*   You can drag-and-drop or load these non-API JSON workflows directly into the ComfyUI web UI to manually test your nodes, verify model configurations, or troubleshoot your generation pipeline visually.

---

## Quick Start & Dev Setup

### 1. Easy Start (Recommended)
Launch the entire app with pre-flight environment checks and automatic service spawning:
```powershell
.\start.ps1
```
Or with hot-reloading enabled for UI / script editing:
```powershell
.\start.ps1 -Dev
```

### 2. Manual Dev Setup (npm)
If you prefer running via npm:
```powershell
# Install packages
npm install

# Run unit tests
npm test

# Launch standard application
npm start

# Launch in dev mode (hot-reloading)
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
3.  **Attribute Script**: In the **Script Editor** view, choose your engine (`⚡ Laya Fast` or `⚡🧠 Hybrid`), and click **Automate Attribution** to attribute paragraphs into interactive screenplay blocks in under a second.
4.  **Verify Timbre Map**: Switch to the **Voice Matrix** tab to see identified characters, adjust ComfyUI preset drop-downs, or randomize synthesis seeds.
5.  **Run Synthesis**: Toggle **Mock Offline Mode** in the top-right header, then click **Synthesize Classic** in the Script Editor pane to watch files write sequentially in real-time.
6.  **Stitch & Listen**: Switch to the **Assembly Console** tab, click **Stitch Concatenated Master (Pass 5)**, and click **Listen Master** to activate visualizers and play your finished audiobook.

# ComfyUI Workflows Directory

This directory contains the ComfyUI workflow JSON templates used by the Multi-Speaker AI Audiobook Generator. It includes both **human-readable canvas workflows** (for interactive testing in the ComfyUI Web UI) and **API payloads** (used programmatically by the Electron backend).

For in-depth prompt engineering syntax, parameter guidelines, and CLI examples for all AuK models, see the [AuK Inference Cookbook](AuK%20COOKBOOK.md).

---

## Workflow File Naming Conventions

*   **`[Name].json` (Canvas Format):** Contains full node coordinates, canvas links, visual groups, and layout metadata. Drag-and-drop or load these into the ComfyUI Web UI (`http://127.0.0.1:8188`) to visually inspect node graphs and test parameters.
*   **`[Name]_api.json` (API Format):** Minimal JSON payload containing only node inputs, class types, and execution connections. Dispatched via HTTP POST to `/prompt` by the app's Node.js synthesis worker.

---

## 1. AuK Workflows & Task Directory

| Task # | Task Name | Human-Readable Canvas (`.json`) | App Backend API (`_api.json`) | Description & Parameters |
| :---: | :--- | :--- | :--- | :--- |
| **01** | Instruct-TTS | [`AuK-01-Instruct-TTS.json`](AuK-01-Instruct-TTS.json) | [`AuK-01-Instruct-TTS_api.json`](AuK-01-Instruct-TTS_api.json) | Text-to-speech from descriptive natural-language style prompts |
| **02** | Zero-Shot Voice Clone | [`AuK-02-Voice-Clone.json`](AuK-02-Voice-Clone.json) | [`AuK-02-Voice-Clone_api.json`](AuK-02-Voice-Clone_api.json) | Clones reference audio sample without requiring reference transcripts |
| **03** | Speech Content Editing | [`AuK-03-Speech-Content-Editing.json`](AuK-03-Speech-Content-Editing.json) | [`AuK-03-Speech-Content-Editing_api.json`](AuK-03-Speech-Content-Editing_api.json) | In-place text replacement, insertion, or word removal |
| **04** | Lyric Editing | [`AuK-04-Lyric-Editing.json`](AuK-04-Lyric-Editing.json) | [`AuK-04-Lyric-Editing_api.json`](AuK-04-Lyric-Editing_api.json) | Re-sings lyrics using isolated a cappella vocal inputs |
| **05** | Pitch Editing | [`AuK-05-Pitch-Editing.json`](AuK-05-Pitch-Editing.json) | [`AuK-05-Pitch-Editing_api.json`](AuK-05-Pitch-Editing_api.json) | Discrete semitone shifting (`±1, ±2, ±3` semitones) |
| **06** | Speed Editing | [`AuK-06-Speed-Editing.json`](AuK-06-Speed-Editing.json) | [`AuK-06-Speed-Editing_api.json`](AuK-06-Speed-Editing_api.json) | Speaking rate multiplier (`0.5x, 0.75x, 1.25x, 1.5x, 2.0x`) |
| **07** | Volume Editing | [`AuK-07-Volume-Editing.json`](AuK-07-Volume-Editing.json) | [`AuK-07-Volume-Editing_api.json`](AuK-07-Volume-Editing_api.json) | Discrete decibel adjustments (`±5, ±10, ±15` dB) |
| **08** | Emotion Editing | [`AuK-08-Emotion-Editing.json`](AuK-08-Emotion-Editing.json) | [`AuK-08-Emotion-Editing_api.json`](AuK-08-Emotion-Editing_api.json) | Emotional morphing (`happy`, `sad`, `angry`, `fearful`, `excited`) |
| **09** | Timbre Editing | [`AuK-09-Timbre-Editing.json`](AuK-09-Timbre-Editing.json) | [`AuK-09-Timbre-Editing_api.json`](AuK-09-Timbre-Editing_api.json) | Alters vocal texture from text description (e.g. raspy, breathy) |
| **10** | De-accent | [`AuK-10-De-accent.json`](AuK-10-De-accent.json) | [`AuK-10-De-accent_api.json`](AuK-10-De-accent_api.json) | Softens regional accents toward standard neutral delivery |
| **11** | Nonverbal Sound Editing | [`AuK-11-Nonverbal-Sound-Editing.json`](AuK-11-Nonverbal-Sound-Editing.json) | [`AuK-11-Nonverbal-Sound-Editing_api.json`](AuK-11-Nonverbal-Sound-Editing_api.json) | Inserts or removes sighs, chuckles, coughs, and gasps |
| **12** | Whisper Conversion | [`AuK-12-Whisper-Conversion.json`](AuK-12-Whisper-Conversion.json) | [`AuK-12-Whisper-Conversion_api.json`](AuK-12-Whisper-Conversion_api.json) | Transforms spoken voice into intimate whisper, or vice-versa |
| **13** | Speech Enhancement | [`AuK-13-Speech-Enhancement.json`](AuK-13-Speech-Enhancement.json) | [`AuK-13-Speech-Enhancement_api.json`](AuK-13-Speech-Enhancement_api.json) | Removes room reverb and background noise, boosts presence |
| **14** | Audio Quality Restoration | [`AuK-14-Audio-Quality-Restoration.json`](AuK-14-Audio-Quality-Restoration.json) | [`AuK-14-Audio-Quality-Restoration_api.json`](AuK-14-Audio-Quality-Restoration_api.json) | Repairs clipping, muffled bandpass, and telephone artifacts |
| **15** | Speaker Separation | [`AuK-15-Speaker-Separation.json`](AuK-15-Speaker-Separation.json) | [`AuK-15-Speaker-Separation_api.json`](AuK-15-Speaker-Separation_api.json) | Separates overlapping voices by turn order (1st, 2nd) |
| **16** | Music / Vocal Separation | [`AuK-16-Music-Vocal-Separation.json`](AuK-16-Music-Vocal-Separation.json) | [`AuK-16-Music-Vocal-Separation_api.json`](AuK-16-Music-Vocal-Separation_api.json) | Extracts singing or speech from background music |
| **17** | Target Speaker Extraction | [`AuK-17-Target-Speaker-Extraction.json`](AuK-17-Target-Speaker-Extraction.json) | [`AuK-17-Target-Speaker-Extraction_api.json`](AuK-17-Target-Speaker-Extraction_api.json) | Isolates a specific speaker based on a spoken anchor phrase |

---

## 2. Qwen3-TTS Workflows

| Task | Human-Readable Canvas (`.json`) | App Backend API (`_api.json`) | Description |
| :--- | :--- | :--- | :--- |
| **Voice Design** | [`Qwen3-tts-DesignVoice.json`](Qwen3-tts-DesignVoice.json) | [`Qwen3-tts-DesignVoice_API.json`](Qwen3-tts-DesignVoice_API.json) | Creates new character vocal cord profiles from natural-language descriptions |
| **Load Custom Voice** | [`QWEN3-TTS-loadCustomVoice.json`](QWEN3-TTS-loadCustomVoice.json) | [`QWEN3-TTS-loadCustomVoice_api.json`](QWEN3-TTS-loadCustomVoice_api.json) | Clones master vocal anchors with new line text and emotion prompts |
| **Save Custom Voice** | [`QWEN3-TTS-saveCustomVoice.json`](QWEN3-TTS-saveCustomVoice.json) | [`QWEN3-TTS-saveCustomVoice_api.json`](QWEN3-TTS-saveCustomVoice_api.json) | Persists newly designed voices into ComfyUI's preset storage directory |

---

## How to Test in ComfyUI

1. Start ComfyUI (e.g. `C:\cui\goLow.ps1`).
2. Open `http://127.0.0.1:8188` in your browser.
3. Drag any **canvas file** (without `_api` suffix) directly onto the browser window.
4. Verify node connections, check model paths in loaders, and click **Queue Prompt** to run a manual generation.

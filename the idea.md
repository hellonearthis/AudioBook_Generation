Building a multi-speaker, context-aware AI audiobook generator is an excellent project. The shift from standard single-voice text-to-speech (TTS) to an immersive, full-cast audio experience relies heavily on treating the book like a film script.

To pull this off effectively, the backend architecture needs a structured pipeline. Running this sequentially prevents data formatting issues and keeps generation costs (or compute time) down.

## The Core Processing Pipeline

Creating a screenplay layout with accurate emotional direction requires processing the text in distinct passes rather than doing everything at once.

1. **Global Cast Extraction:** Pass 1: Discover the Characters.
Before diving into individual lines, process the text (by chapter or chunk) to build a master **Cast Profile**. The LLM scans the text to identify all speaker entities and extracts descriptive traits like gender, implied age, personality, and relationship dynamics. This ensures voice consistency across the entire book.


2. **Dialogue Attribution & Screenplay Parsing:** Pass 2: Speaker Tagging.
Isolate every sentence and tag it as either `Narrator` or a specific `Character_ID`. This stage handles **coreference resolution**—determining who is speaking when the text simply says *"No," she whispered, walking away.* The output is structured into a clean JSON schema resembling a script.


3. **Contextual Instruction Generation:** Pass 3: Stage Directions.
Analyze the targeted line alongside its surrounding context (usually a 3–5 sentence window). Have the LLM generate concise emotional and performance instructions (e.g., *"whispered, high tension, breathless"* or *"booming voice, prideful"*). These act as the screenplay's parentheticals.


4. **Voice Casting & Speech Synthesis:** Pass 4: Audio Generation.
Map each `Character_ID` to a unique voice profile. Feed the raw text along with the generated emotional instructions into an **Instruct-TTS engine** (like Qwen3-TTS or specialized dialogue models). The engine uses the emotional tags to alter pitch, timbre, and pacing organically.


5. **Dynamic Assembly & Audio Stitching:** Pass 5: Post-Production.
Stitch the individual audio segments into a seamless track. Use a background process to inject natural pauses, breath spaces, or room tone between alternating speakers so the final file flows like a real conversation instead of abrupt sound bites.


---

## Features to Make the Tool Seamless and Powerful

If you want to move this from a basic pipeline to a truly useful developer or creator tool, focus on automation that minimizes manual editing.

| Feature Area | Implementation Idea | Why It Matters |
| --- | --- | --- |
| **Automated Timbre Matching** | Use a text-to-timbre model that reads the *Cast Profile* and automatically picks or generates an AI voice matching the character's description. | Saves the user from manually auditioning and assigning dozens of voices for minor characters. |
| **Interactive Script Editor** | Provide a dual-pane UI: raw book on the left, editable screenplay on the right. Users can click any line to override the assigned speaker or modify the emotional prompt. | AI will occasionally misattribute a line; giving users a visual way to patch mistakes before hitting "generate" is vital. |
| **Dynamic Pacing & Interplay** | Use the LLM to detect interruptions, awkward silence, or overlapping speech, and translate that into custom timing offsets. | Traditional TTS handles lines in isolation; modeling the *space between* lines makes dialogue sound human. |
| **Timeline Marker Export** | Export the final audio along with a data file (like a CSV or XML change-list) containing markers for every speaker transition. | If a creator wants to bring the audio into a digital audio workstation (DAW) or video editor later, they instantly see exactly where every character speaks. |

> **Pro Tip on Handling Large Books:** Don't feed a whole novel into an LLM context window at once for attribution. Process it in sliding, overlapping windows (e.g., 2,000 words at a time with a 200-word overlap). This gives the model enough immediate history to know who is talking without losing accuracy or blowing past token limits.

---

This is a powerhouse setup for a local, privacy-first desktop application. Electron handles the heavy lifting of local file systems and orchestrates the APIs, while LM Studio and ComfyUI run entirely on your local hardware.

Here is how to map out the technical architecture and tie these three components together efficiently.

---

## 1. The Application Architecture

Because Electron separates the UI (**Renderer Process**) from the system operations (**Main Process**), your app will operate as a central coordinator. The Main Process should handle all local API traffic to prevent blocking the user interface during heavy generation tasks.

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

## 2. Text Parsing via LM Studio (google/gemma-4-12b)

LM Studio exposes an OpenAI-compatible API endpoint at `http://localhost:1234/v1/chat/completions`. To make the screenplay data easy to manipulate in Electron, you need google/gemma-4-12b to return a strict, predictable JSON structure.

When you send text chunks to LM Studio, enable **JSON Mode** in your API request and use a structured system prompt.

### Target JSON Schema

For every paragraph or chunk processed, the API should return an array of script blocks:

```json
{
  "script_segments": [
    {
      "type": "narrator",
      "speaker": "Narrator",
      "text": "The wind howled through the open valley as John approached the old cabin.",
      "direction": "atmospheric, ominous, steady pacing"
    },
    {
      "type": "dialogue",
      "speaker": "John",
      "text": "Is anyone still out here?",
      "direction": "hesitant, shivering, shouting over wind"
    }
  ]
}

```

### Implementation Tip

google/gemma-4-12b handles structured patterns well. To maximize performance, feed it a "shot" (an example of a raw book paragraph alongside the target screenplay JSON) in the system prompt. This ensures it doesn't add conversational fluff like *"Sure, here is your script:"* before the payload.

---

## 3. Audio Synthesis via ComfyUI API

To control ComfyUI programmatically from Electron, you will bypass the visual browser interface and use its REST/WebSocket API (`http://localhost:8188`).

### The Workflow Setup

1. Open ComfyUI in your browser and build your ideal TTS pipeline (e.g., using nodes for F5-TTS, ChatTTS, or Bark).
2. Go to ComfyUI settings and check **"Enable Dev mode"**.
3. Click **"Save (API Format)"**. This downloads a compact JSON file representing the raw execution graph instead of the visual UI layout.

### Connecting Electron to ComfyUI

In your Electron Main Process, load that exported graph JSON. Every node in the graph has a specific ID key. Your code will locate the text input node and the voice/speaker seed node, swap their values for the current screenplay segment, and fire a POST request to ComfyUI:

```javascript
// Example fetch to queue a prompt in ComfyUI
const response = await fetch('http://localhost:8188/prompt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: modifiedComfyGraphJson })
});
const { prompt_id } = await response.json();

```

> **Tracking Progress:** ComfyUI processes requests asynchronously. Open a local WebSocket connection (`ws://localhost:8188/ws?clientId=your_app`) in your Electron code. Listen for the `executing` and `executed` messages to track when a node finishes rendering a line of dialogue, allowing you to update a progress bar in your UI.

---

## 4. UX Enhancements for a "Useful Tool"

To make this app efficient for a creator or developer to use, consider building these three interface components into your Electron layout:

* **The Global Voice Matrix:** A dedicated dashboard screen where the app lists every unique character name discovered by google/gemma-4-12b. Next to each name, provide a dropdown menu to assign a specific ComfyUI voice model or reference audio clone. Once mapped, the app automatically injects those settings whenever that character speaks.
* **A "Regenerate Line" Button:** Audio generation can be unpredictable. In your screenplay editor UI, make every line an individual row with a refresh icon. If a specific character line sounds robotic or glitched, clicking it should send just that isolated chunk back to ComfyUI with a slightly randomized seed, swapping it into the timeline seamlessly.
* **Zero-Copy Local Staging:** Because everything is local, don't waste time downloading files over HTTP. Configure your Electron app to read directly from ComfyUI’s default `output/` directory, copy the generated `.wav` files into your project's local directory, and clear the cache automatically.

---

To get completely clean, structured JSON from google/gemma-4-12b without any conversational fluff, you need to combine a highly explicit system prompt with **Few-Shot Examples** (giving the model an exact input/output baseline).

Here is a system prompt optimized for local models like google/gemma-4-12b to handle pronoun resolution, dialogue tracking, and emotional tagging.

```markdown
You are a precise backend text-parsing engine. Your sole task is to convert raw book excerpts into a structured screenplay JSON format for a multi-speaker Text-to-Speech pipeline.

CRITICAL ENFORCEMENT:
- Output ONLY valid, raw JSON. 
- Do NOT wrap the output in markdown code fences (do not use ```json).
- Do NOT include any introductory or concluding text (e.g., "Here is your JSON:").
- Do NOT alter, omit, or summarize any words from the source text. Every piece of text must be accounted for.

RULES FOR PARSING:
1. "type": Must be either "dialogue" (spoken text) or "narrator" (descriptions, actions, or spoken attributions like "he said").
2. "speaker": Identify the specific entity speaking. Use local context to resolve pronouns (e.g., if the text says 'He nodded,' determine who 'He' refers to and use their actual character name). For non-spoken text, use "Narrator".
3. "text": Strip away opening and closing quotation marks from "dialogue" blocks. Ensure the text matches the source exactly.
4. "direction": Generate short, comma-separated audio performance cues based on the emotional subtext (e.g., "whispered, high-tension, fast pacing" or "booming, confident, sarcastic").

JSON SCHEMA:
{
  "script_segments": [
    {
      "type": "narrator" | "dialogue",
      "speaker": "Character Name" | "Narrator",
      "text": "Exact string from text",
      "direction": "audio delivery instructions"
    }
  ]
}

### EXAMPLE 1
Input:
"Are you sure about this?" Sarah asked, her hands shaking as she held the lantern. Mark didn't look back. "We don't have a choice," he muttered.

Output:
{
  "script_segments": [
    {
      "type": "dialogue",
      "speaker": "Sarah",
      "text": "Are you sure about this?",
      "direction": "anxious, voice trembling, quiet"
    },
    {
      "type": "narrator",
      "speaker": "Narrator",
      "text": "Sarah asked, her hands shaking as she held the lantern.",
      "direction": "observational, tense pacing"
    },
    {
      "type": "narrator",
      "speaker": "Narrator",
      "text": "Mark didn't look back.",
      "direction": "steady, cold tone"
    },
    {
      "type": "dialogue",
      "speaker": "Mark",
      "text": "We don't have a choice,",
      "direction": "grim, flat, resigned"
    },
    {
      "type": "narrator",
      "speaker": "Narrator",
      "text": "he muttered.",
      "direction": "lowering volume, falling intonation"
    }
  ]
}
```


other llms to try:  

granite-4.1-8b  108 tokens/s    neh
axionml-qwen3.5-9b-nvfp4  92 tokens/s      //  it seems slow - maybe the token limits set in lm studio are causing offloading. too slow
google/gemma-4-e4b 30 tokens/s  // best
chromadb-context-1 80 tokens/s  // didn't pick up the characters right - nope
qwen/qwen3.5-9b  95 tokens/s  
deepseek/deepseek-r1-0528-qwen3-8b 109 tokens/s   // failed character identification

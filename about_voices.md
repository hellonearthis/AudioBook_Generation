# Audiobook Voice Styling & Orchestration Guide

This guide establishes the standardized vocabulary, emotional weights, and reference hook structures for the AI Audiobook Engine's advanced multi-engine pipeline (supporting **Qwen3-TTS** and **Zonos**).

---

## 1. The 8D Emotion Vector Map (Zonos)

Zonos conditions expressiveness using a precise 8-dimensional numeric vector. In our pipeline, manual sliders or LLM-generated emotional profiles are translated into an array or object containing these exact weights.

### Standardized Weights Lookup Matrix

| Emotional Style | Happiness | Sadness | Anger | Fear | Surprise | Disgust | Neutral | Other |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Neutral** | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.00 |
| **Happy / Joyous** | 0.85 | 0.00 | 0.00 | 0.00 | 0.10 | 0.00 | 0.05 | 0.00 |
| **Sad / Somber** | 0.00 | 0.80 | 0.00 | 0.05 | 0.00 | 0.00 | 0.15 | 0.00 |
| **Angry / Intense** | 0.00 | 0.00 | 0.85 | 0.05 | 0.00 | 0.00 | 0.10 | 0.00 |
| **Anxious / Terrified** | 0.00 | 0.10 | 0.00 | 0.80 | 0.05 | 0.00 | 0.05 | 0.00 |
| **Surprised / Shocked** | 0.10 | 0.00 | 0.00 | 0.15 | 0.70 | 0.00 | 0.05 | 0.00 |
| **Disgusted / Bitter** | 0.00 | 0.05 | 0.15 | 0.00 | 0.00 | 0.75 | 0.05 | 0.00 |
| **Whispered / Intimate** | 0.05 | 0.05 | 0.00 | 0.10 | 0.00 | 0.00 | 0.30 | 0.50 |

---

## 2. Qwen3-TTS Technical Style Prompting

Qwen3-TTS excels at interpreting natural-language style instructions rather than numeric grids. The pipeline synthesizes a descriptive prompt based on the **Triple-Input Model** metadata.

### Example of Generated Style Prompts
- **Tense Scene:** *"Speak in a high pitch with fast pacing at whisper volume, delivered with an anxious tone."*
- **Heroic Speech:** *"Speak in a low pitch with normal pacing at loud volume, delivered with an excited tone."*

---

## 3. The "Golden Reference" Audio Hooks Library

For premium, actor-grade consistency, the engine loads specific 3-second audio reference hooks to condition the physical features (timbres, acoustics, breath patterns) of the TTS output.

### File Naming Convention & Folder Structure
Reference WAVs are placed inside the active project directory at:
`[Workspace] / [Project_Name] / audio / references /`

Files must be named using this lowercase pattern:
`[character_name]_[style_label]_hook.wav`

---

## ⚠️ Important Note: Qwen3 Voice Clone Preview Performance

> [!WARNING]
> **Latency Warning for Zero-Shot Voice Cloning:**
> Synthesizing speech with custom 3-second reference audio hook clips (Zero-Shot voice cloning) requires significant local GPU context parsing and is **computationally heavy**. Connection latency and generation times will be noticeably slower.
> 
> **Best Practices for Rapid Previews:**
> - **Use Templates:** It is highly recommended to select predefined Voice Templates (e.g. `Eric`, `Dylan`, or `Serena`) for swift visual/audio drafts.
> - **Use Seeds:** Modify the character's **Speech Synthesis Seed** (which randomizes pitches and vocal timbres natively without loading dynamic audio hooks) to iterate on voice characters rapidly.
> - **Production Renders:** Apply dynamic reference hook files (`[name]_[style]_hook.wav`) specifically for final high-fidelity synthesis runs once raw screenplays are aligned.


---

# Qwen3-TTS Voice Reference Data Format

## The Three Qwen3-TTS Operational Custom Nodes (Class Types)
Inside the workflow files, the Qwen3-TTS system is driven by **three distinct custom node types** which handle voice synthesis differently depending on the stage of production:

1. **🎨 VoiceDesign (`FB_Qwen3TTSVoiceDesign`)**
2. **🎭 VoiceClone (`FB_Qwen3TTSVoiceClone`)**

---

# 4. ComfyUI API Workflows Integration

We integrate programmatically with ComfyUI using the REST API versions of the workflows. These files are located at:
*   `comfyui_workflows/Qwen3-tts-DesignVoice_API.json`

*   `comfyui_workflows/Qwen3-tts-voiceClone_API.json`

---

## 🎨 A. Qwen3-TTS DesignVoice API Workflow (`Qwen3-tts-DesignVoice_API.json`)

### WHAT it is:
This workflow designs a brand-new, customized voice character profile using natural language attributes. Instead of loading an existing recording, the AI generates a voice structure from scratch based purely on descriptive traits.

### WHY it is used:
This is ideal for casting brand-new fictional characters or narrators. By giving the AI a comprehensive description of the speaker's age, gender, posture, and personality traits, it crafts a distinct vocal identity tailored to that specific character.

### JSON API Node Mapping:
*   **WhatToSay (PrimitiveString, Node ID `42`):**
    *   **Value:** The raw string sentence that you want the designed voice to speak.
*   **VoiceStyle (PrimitiveString, Node ID `43`):**
    *   **Value:** A detailed natural language character design prompt. For example:
        ```text
        Character Name: Lin Huaiyue
        Voice Profile: A powerful, commanding middle-aged male voice; resonant and booming, characterized by a deep, authoritative register and strong emphasis.
        Identity & Background: Lead Consultant for a national key scientific research project and a seasoned strategic scientist nearing seventy.
        Physical Appearance: Possesses an upright, imposing stature. His temples are graying, typically wearing dark-colored Zhongshan suits.
        Personality Traits: Will of steel and unwavering conviction; deeply patriotic and disciplined.
        Personal Motto: "Our generation does not exist to stand in the light, but to pave the road toward it."
        ```
*   **Inference Node (`FB_Qwen3TTSVoiceDesign`, Node ID `38`):**
    *   **Inputs:** Connects directly to `WhatToSay` for text input and `VoiceStyle` for instructions. It uses configurations like `"model_choice": "1.7B"`, `"precision": "bf16"`, and `"device": "cuda"`.
*   **Output Node (`SaveAudioMP3`, Node ID `41`):**
    *   **Prefix:** `take/qwen3-tts-DesignVoice`
    *   **Quality:** `128k` (saves high-quality MP3 outputs for review).

---

## The Acoustic Context Bleed Problem

The core issue with `VoiceDesign` is that it lacks a physical anchor. It treats your design prompt and the target script as one combined puzzle to solve. When you change the text, the model re-interprets the *entire* context.

### 1. The "Acoustic Context" Bleed
In a pure text-to-voice design model, the model generates speech tokens by looking at your descriptive prompt *and* the target text together. Because they are processed in the same context window, the letters, syllables, and mood of the target text bleed into the vocal identity itself.
* If the text has a lot of sharp, aggressive consonants (like *"Attack the block!"*), the model might interpret the character as having a sharper, more piercing voice.
* If the next line is soft and vowel-heavy (like *"Moonlight on the water"*), the model re-sculpts the voice to be breathier and softer.
It isn't just changing the delivery; it is rewriting the vocal cords of the speaker.

### 2. The Random Seed Illusion
When using `VoiceDesign`, a fixed seed does **not** lock a specific human voice. It only locks the starting random point of the model's generation path. As soon as the target text changes, the generation path splits.

### The Two-Step Voice Cloning Pipeline (Bake-Once, Clone-Always)
To achieve a perfectly stable multi-speaker cast without shapeshifting voices, the engine utilizes a Two-Step pipeline:

1. **Baking the Master Anchor (UI -> Backend):** You run `VoiceDesign` exactly *once* using a neutral 12-second script. The backend converts this MP3 into a 24kHz Mono WAV and appends **200ms of digital silence** (using FFmpeg) to prevent "First-Token Phonic Bleed." This file is saved to `/audio/anchors/`.
2. **Auto-Rerouting (Runtime Engine):** At runtime, if the engine detects a baked anchor WAV for a character, it automatically hijacks the request. It upgrades the generation from the `design` workflow to the `clone` workflow (In-Context Learning), feeding the anchor WAV and exact transcript into `FB_Qwen3TTSVoiceClone`.

This process physically locks the character's vocal timber for all subsequent lines.

Yes, exactly! That is the beauty of the **VoiceClone** system.

Because the clone voice has a physical anchor (`master_voice.wav`) locking down the character's *vocal cords*, it is free to focus 100% of its attention on the *acting*.

When you pass a line like *"Look out!"* into the cloning pipeline, here is how the model handles it:

#### 1. It Keeps the Identity Rigid

It extracts the physical timbre, pitch baseline, and mouth-shape characteristics from your calm, balanced calibration file. It knows exactly who is speaking, so the core identity won't morph into a stranger.

#### 2. It Applies the Emotion to the Text

Because Qwen3-TTS is an autoregressive language model, it reads the words *"Look out!"* and the exclamation point, recognizes the high-stakes context, and automatically alters the delivery. It will:

* Raise the pitch relative to that character's baseline.
* Increase the volume and intensity.
* Shorten the duration of the words to imply urgency.

#### Why this is a massive upgrade for your app:

If you tried to do this with `VoiceDesign` on the fly, the model would re-sculpt the voice from scratch for *"Look out!"*, likely resulting in a completely different, harsher-sounding person.

By using the `VoiceClone` method, you get the best of both worlds: **the exact same person, naturally reacting to the dramatic context of the text.**

---

## Making the Master Voice Files

To create a great voice clone, you actually need two different formulas:

1. **The Voice Design Prompt:** The descriptive attributes that dictate the physical characteristics of the voice cords.
2. **The Calibration Script:** The literal text the voice reads to create that 12-second master `.wav` file.

If either of these contains overly emotional or chaotic language, the resulting audio file will be warped, making it a poor foundation for a long-term voice clone.

### 1. The Voice Design Prompts (Pick Your Archetype)

Qwen3-TTS responds best to a **structured, highly clinical breakdown** of vocal physics rather than loose, artistic prose. Here are three production-ready blueprints optimized for clear, cloneable audio.

#### The Calm Narrator (Great for Multi-Speaker Audiobooks)

> `"Gender: Male. Age: Middle-aged (45-50). Pitch: Deep, low-frequency resonance, clear chest voice. Pace: Steady, measured, deliberate pacing. Clarity: High enunciation, professional studio recording environment, zero background noise, dry acoustics, standard neutral accent."`

#### The Warm Storyteller (Great for Companions or NPCs)

> `"Gender: Female. Age: Young adult (28-32). Pitch: Medium-low, warm, gentle, smooth vocal texture. Pace: Conversational, natural pauses. Clarity: Crisp pronunciation, clear diction, very slight breathiness, intimate microphone proximity, clean audio."`

#### The Clear Instructor (Great for Educational Apps or Tools)

> `"Gender: Female. Age: Middle-aged (40-45). Pitch: Medium-high, bright, clear, energetic but professional tone. Pace: Moderately brisk but distinct. Clarity: Authoritative enunciation, standard accent, perfectly balanced frequencies, broadcast studio quality."`

### 2. The Production Calibration Scripts (Pick One)

"The quick brown fox" is a pangram—meaning it covers every letter of the alphabet—but it is notoriously poor for audio calibration because it doesn't account for **phonetic context** or **acoustic density**.

Letters do not equal sounds. For example, the letter "o" sounds entirely different in *fox*, *brown*, *women*, and *one*. Furthermore, Qwen3-TTS reads words in context; a short, abstract phrase like the fox jump gives the neural network zero emotional or linguistic structural pacing to latch onto.

To train a robust voice clone, you need **phonetically dense, Harvard-sentence inspired scripts**. These use complex word transitions to map out vowels, fricatives (like *sh*, *v*, *th*), and plosives (like *p*, *b*, *t*) across a natural reading flow.

Here are two distinct scripts engineered to give Qwen3-TTS the ultimate phonetic map of your character's vocal profile. They take roughly **20 to 25 seconds** to read naturally, which is the sweet spot for the 1.7B context window.

Do **not** use a line of intense script dialogue (e.g., *"Look out!"*). If the reference audio contains shouting, gasping, or intense emotional spikes, your clone engine will try to stretch those exact distortions across every future line of text your app generates. Always generate/read the calibration script in a completely neutral tone.

#### Option 1: The Smooth & Resonance-Rich Script

*Best for capturing deep chest tones, warm mid-ranges, complex vowels, and fluid word-to-word blending.*

> "The direct path through the valley was covered in thick, dark moss. Young children should always evaluate their choices before jumping into unknown waters. She saw a magnificent bluejay perched high upon the smooth wooden fence, singing a remarkably clear tune that echoed softly across the quiet, frozen northern landscape."

#### Option 2: The Articulate & Crisp-Consonant Script

*Best for mapping out precise enunciation, hard stops, sibilance (s/z sounds), and rapid mouth-shape transitions.*

> "Please pack those five big leather bags into the red truck as quickly as possible. We realized the complex project required specific technical expertise and an extra measure of patience. The bright yellow sunlight cast long, dramatic shadows through the glass windows, creating a striking contrast against the rough stone floor."

#### Option 3: The Sibilant & Soft-Fricative Specialist

* **Best For:** Sorting out voices that tend to hiss, lisp, or lose clarity on high frequencies. This script heavily exercises the **"s", "z", "sh", "ch", "th", and "f"** sounds in varying word positions.
* **Target Tone:** Smooth, crisp, clean, and highly defined.

> "The silver sunrise cast a sharp reflection across the frozen surface of the lake. She observed several small, unusual birds searching for seeds beneath the thick brush. It was a exceptionally quiet morning, matching her peaceful state of mind before the long, strenuous journey across the southern plains finally began."

#### Option 4: The Plosive & Dynamic Range Torture Test

* **Best For:** Teaching the model how to handle hard mouth stops and bursts of air without creating popping artifacts. It forces clean execution of **"p", "b", "t", "d", "k", and "g"** sound pairings.
* **Target Tone:** Confident, structural, punchy, and highly articulate.

> "Please pull the heavy black tarp completely over the dynamic equipment before the storm begins. We discovered that a background packet of technical data could predict the group’s behavior with remarkable accuracy. The bright spotlight created distinct, dramatic patterns on the dark wooden floor, completely captivating the quiet audience."

#### Option 5: The Complex Vowel & Resonant Core Test

* **Best For:** Capturing the deep, rich, chest-voice characteristics of a persona. It emphasizes **diphthongs** (vowels that glide together, like the *oy* in boy or *ou* in house) and **nasal/liquid consonants** (like **"m", "n", "ng", "l", "r"**).
* **Target Tone:** Warm, cinematic, deep, and highly melodic.

> "The winding mountain trail offered a truly magnificent view of the entire valley below. Many local folklore stories were originally written around these ancient, towering pine trees. As the cold autumn wind began to howl, a strange sense of wonder and calm settled over the solitary traveler."

---

### Why These Work Better Than a Basic Pangram

A truly resilient reference file needs to show the model how the voice transitions between different physical mouth shapes.

These scripts ensure Qwen3-TTS captures the critical phonetic groups:

* **Diphthongs (Vowel Glides):** Transitions like the "ou" in *choices* or the "i" in *bright* force the model to map out how the voice moves between two distinct vowel sounds within a single syllable.
* **Voiced vs. Unvoiced Pairs:** Words like *thick* (unvoiced "th") and *their* (voiced "th"), or *pack* (p) and *bags* (b) teach the model exactly how much breath and vocal cord vibration the character uses for hard stops.
* **Acoustics & Pacing:** The sentence structures vary in length. This forces the model to learn the natural breathing patterns, pacing slowdowns at commas, and final pitch drops at the end of a thought.

---

### Implementation Tip for Your App

When generating your master audio asset using `VoiceDesign`, generate **three separate variations** using the exact same script and seed. Listen closely to the transitions between words. Choose the one that sounds the most physically effortless and steady—that is the file you want to save to your production folder for the `VoiceClone` engine to duplicate.

---

### How to execute this in your workflow:

1. **Generate the Master File:** Creative Phase.
   Input your chosen **Voice Design Prompt** from above, and set the target text to one of the **Calibration Scripts** above. Run a few seeds until you hit the perfect vocal timbre.

2. **Export and Clean:** Asset Preparation.
   Export that generated clip as a `master_voice.wav` file. Trim any trailing digital artifacts so it ends cleanly. Ensure it is saved as **24kHz, Mono, 16-bit WAV**.

3. **Deploy to Production:** Cloning Phase.
   Lock this file into your app's asset folder. From now on, when your app generates dynamic text, feed this static `.wav` file into the cloning pipeline as your anchor.

---

## 🎵 B. Qwen3-TTS CustomVoice API Workflow (`Qwen3-tts_CustomVoice_API.json`)

### WHAT it is:
Generates dialogue using built-in preset speakers in the model alongside manual **Speech Synthesis Seeds** and concise emotional directives.

### WHY it is used:
This is the fastest rendering pipeline. Because it avoids parsing dynamics from dyn-loaded external audio files, it has extremely low latency—making it the perfect engine for real-time script previews and editing passes.

### JSON API Node Mapping:
*   **WhatToSay (PrimitiveString, Node ID `41`):**
    *   **Value:** The script segment dialogue text to synthesize.
*   **VoiceStyle (PrimitiveString, Node ID `42`):**
    *   **Value:** Short, comma-separated acting directions. For example: `anxious, voice trembling, low volume` or `excited, fast pace, energetic`.
*   **Preset Speaker Selection (`speaker` parameter in node `39`):**
    *   **Value:** Binds to a preset speaker. The node contains a built-in dropdown of model-trained voices.
    *   > [!NOTE]
        > **Predefined Preset Voices List:**
        > You can choose from standard preset speaker names, including:
        > *   `Eric` (default clean male narrator tone)
        > *   `Ono_anna` (expressive, conversational female tone)
        > *   `Aiden`, `Dylan`, `Ryan`, `Serena`, `Sohee`, `Uncle_fu`, `Vivian` (additional built-in speaker templates).
*   **Inference Node (`FB_Qwen3TTSCustomVoice`, Node ID `39`):**
    *   **Inputs:** Binds the text and style inputs to synthesize speech rapidly using designated seeds to vary standard pitch.
*   **Output Node (`SaveAudioMP3`, Node ID `43`):**
    *   **Prefix:** `take/Qwen3-tts-CustomVoice`

---

## 🎭 C. Qwen3-TTS VoiceClone API Workflow (`Qwen3-tts-voiceClone_API.json`)

### WHAT it is:
Performs advanced Zero-Shot voice cloning where the engine copies the exact physical traits, accent, acoustic style, and breath patterns of an actor from a short reference recording.

### WHY it is used:
For final high-fidelity production renders. It connects the character's physical voice properties directly to a directory of emotional recordings, allowing the AI to clone and act in specific emotional registers on the fly.

### JSON API Node Mapping:
*   **SayIinCloneVoice (PrimitiveString, Node ID `6`):**
    *   **Value:** The targeted script line sentence that the cloned voice will speak.
*   **CloneAudioText (PrimitiveString, Node ID `5`):**
    *   **Value:** The exact text transcript of the reference audio clip. This is mandatory for Qwen's attention alignment mechanism to map sound patterns correctly.
*   **LoadCloneAudio (LoadAudio, Node ID `2`):**
    *   **audio:** The file path or name of the reference audio hook file.
*   **Inference Node (`FB_Qwen3TTSVoiceClone`, Node ID `3`):**
    *   **Inputs:** Links the target text, reference text, and reference audio to perform high-fidelity speech synthesis.
*   **Output Node (`SaveAudioMP3`, Node ID `4`):**
    *   **Prefix:** `take/Qwen3-tts-ClonedVoice`

---

## 📁 Character Voice Connection & Custom Emotional Folders

To maintain strict vocal continuity and emotional variance, the cloned voice system is directly linked to the screenplay character profile. Each character is assigned a **custom subfolder containing source emotion MP3 clips**.

### Directory Folder Structure:
Reference clips are stored within your workspace directory organized by character subfolders:
```text
[Workspace] / [Project_Name] / audio / references / [character_name] /
```

Within a character's folder, place individual reference recordings corresponding to specific emotional registers (e.g., approximately 3 to 10 seconds in duration), saved as MP3 files matching these exact lowercase names:
*   `neutral.mp3` - Standard narration or calm baseline delivery.
*   `angry.mp3` - Highly intense, loud, aggressive delivery.
*   `anxious.mp3` - Shaky, rapid-paced, trembling delivery.
*   `excited.mp3` - Energetic, elevated pitch, joyous delivery.
*   `whispered.mp3` - Intimate, quiet, breathy delivery.

---

## 💻 Behind the Scenes: Dynamic Routing Tutorial

### WHAT the Backend Orchestrator is doing:
When a synthesis task runs, the Electron main process checks the character name and the parsed screenplay line emotional style. It automatically resolves the correct reference audio file and transcription from the character folder, then binds these parameters to the API request payload.

### WHY it works this way:
Automating this dynamic resolution prevents the user from manually mapping audio hooks for every single line of script, enabling full-book rendering with complex acting variations in a single click.

Here is the implementation routing logic used by the engine to map characters to their custom emotional folder structures:

```javascript
// WHAT: Resolving the absolute file path to a character's custom emotional reference clip.
// WHY: We check the character folder on disk for a file matching the delivery emotion,
//      falling back to 'neutral.mp3' if a specific emotion is missing.
const resolve_character_emotional_source_audio_path = (
  active_screenplay_character_name,
  targeted_line_emotional_style_label,
  active_workspace_directory_path,
  current_active_project_name
) => {
  // WHAT: Standardizing names to safe lowercase filesystem strings.
  const standardized_character_name = active_screenplay_character_name.toLowerCase().replace(/\s+/g, "_");
  const standardized_emotional_style = targeted_line_emotional_style_label.toLowerCase().trim();

  // WHAT: Constructing path to the character's emotional references subfolder.
  const character_reference_subfolder_path = path.join(
    active_workspace_directory_path,
    current_active_project_name,
    "audio",
    "references",
    standardized_character_name
  );

  // WHAT: Mapping potential target paths for the specific emotion and neutral fallback.
  const targeted_emotional_file_path = path.join(character_reference_subfolder_path, `${standardized_emotional_style}.mp3`);
  const baseline_neutral_file_path = path.join(character_reference_subfolder_path, "neutral.mp3");

  // WHAT: File presence check.
  // WHY: Binds the specific emotion file if present; otherwise, falls back to neutral.
  if (fs.existsSync(targeted_emotional_file_path)) {
    return targeted_emotional_file_path;
  } else if (fs.existsSync(baseline_neutral_file_path)) {
    return baseline_neutral_file_path;
  }

  // WHAT: Catch-all fallback.
  // WHY: Returns null if no custom folder exists, alerting the system to use standard seeds.
  return null;
};
```

---

## 5. Qwen3-TTS Expressive Voice Engineering & Style Prompting Guidelines

Qwen3-TTS offers a powerful, instruction-driven approach to voice generation. Instead of just picking a preset, you can use **Voice Design** to define a persona from scratch using natural language, or use **CustomVoice** for style control.

### Understanding the Voice Style Prompt

The voice style prompt (often called a `voice_prompt` or instruction) is a descriptive text block that the model uses to shape the acoustic "DNA" of the output. To create a high-quality, actionable voice style prompt for Qwen3-TTS, you need to provide a balanced mix of **vocal timbre**, **speech patterns**, and **emotional intent**.

#### 📋 The Persona Prompt Template
Use this structure to ensure the model understands both the *sound* and the *rhythm* of the voice:
> **Voice Quality**: A [Age Range] [Gender] with a [Pitch: e.g., deep/high-pitched] and [Texture: e.g., gravelly/smooth/resonant] voice.
> **Prosody**: [Pacing: e.g., slow/measured/rapid-fire] delivery, featuring [Cadence: e.g., clipped/syrupy/rhythmic] speech.
> **Style**: [Persona descriptor: e.g., cynical, enthusiastic, clinical]. Emphasize [Specific technique: e.g., upward inflections at the end of sentences, deliberate pauses between clauses].
> **Emotion**: [Primary emotional state: e.g., weary but kind, sharp and impatient].

---

#### 🎭 Example: "The Reluctant Noir Detective"
If you were aiming for a gritty, world-weary character, you would use this prompt:
> **Voice Quality**: A middle-aged male with a deep, gravelly, and resonant voice. The tone is dark and slightly smoked.
> **Prosody**: Slow and measured delivery with frequent, heavy pauses after commas to indicate weariness. Speech is clipped, with very little melodic variation.
> **Style**: A cynical, hardened noir narrator. Focus on de-emphasizing the ends of sentences, letting them drop off into a low register.
> **Emotion**: Extremely jaded, world-weary, and stoic. Sound as though speaking from a dimly lit office late at night.

---

### How to Use Style Control Effectively

There are generally two workflows for using these custom voices:

#### A. The Design-and-Save Workflow (Voice Design Node)
This is the standard approach for consistent character voices:
1. **Design:** Submit your `voice_prompt` to the Voice Design model along with a `preview_text` (a short sample sentence).
2. **Verify:** The model generates a sample. If you like the result, the system assigns that voice an ID or name.
3. **Synthesize:** In your main TTS API calls, you reference that specific voice name/ID to ensure consistent character output across different blocks of text.

#### B. The Direct Instruction Approach (CustomVoice Node)
If you are using the 1.7B-CustomVoice model, you can pass style instructions directly into the synthesis call:
*   **Pros:** Allows for dynamic, scene-by-scene adjustments (e.g., *"Speak the first sentence with excitement, then whisper the second sentence"*).
*   **Cons:** Can sometimes lead to inconsistency if your prompt is too vague or if the model "drifts" between different segments of long text.

#### ⚙️ Behind the Scenes: Automatic Character Card Prompt Compilation
To ensure maximum expressiveness and consistency without forcing users to type repetitive voice quality and role details for every line, our synthesis orchestrator automatically compiles the character's global profile with the specific scene cues into a structured Qwen3 Character Card prompt on the fly:

1. **Character Name**: Declares the targeted speaker identity.
2. **Voice Profile**: Summarizes the acoustic register, pitch, timbre, and textures.
3. **Identity & Background**: Provides biographical/role context.
4. **Physical Appearance**: Suggests physical qualities, stature, or age-based nuances.
5. **Personality Traits**: Outlines the psychological demeanor.
6. **Delivery**: Dynamic line delivery parameters (e.g. emotion, pacing, pitch, volume).

##### How the Orchestrator Compiles the Character Card Prompt (from `main.js`):
```javascript
// WHAT: Resolving individual character card sections and compiling the full card for Qwen3-TTS.
// WHY: We either use a precompiled card (assembled during cast discovery) or dynamically build one 
//      from individual fields, appending current line delivery cues (emotion, pacing, pitch, volume)
//      to ensure the voice is conditioned on both persistent traits and dynamic acting states.
const precompiled_design_prompt_string = cell_override_mapping.designPrompt || 
  global_character_mapping.designPrompt || "";

const resolved_voice_profile_section = global_character_mapping.voiceProfile || 
  global_character_mapping.baseVoice || 
  global_character_mapping.traits || 
  "A clean, clear, and natural speaking voice.";
const resolved_identity_background_section = global_character_mapping.identityBackground || "";
const resolved_physical_appearance_section = global_character_mapping.physicalAppearance || 
  global_character_mapping.visualDetails || "";
const resolved_personality_traits_section = global_character_mapping.personalityTraits || 
  global_character_mapping.traits || "";

let structured_custom_voice_style_prompt_string;

if (precompiled_design_prompt_string && precompiled_design_prompt_string.includes("Voice Profile:")) {
  // WHAT: Using the precompiled card and appending dynamic delivery parameters.
  structured_custom_voice_style_prompt_string = 
    precompiled_design_prompt_string + `\n` +
    `Delivery: ${active_emotional_state}, ${active_pacing_level}, ${active_pitch_level} pitch, ${active_volume_level} volume`;
} else {
  // WHAT: Assembling individual fields into the structured character card format.
  structured_custom_voice_style_prompt_string = 
    `Character Name: ${active_speaker_name}\n` +
    `Voice Profile: ${resolved_voice_profile_section}\n` +
    (resolved_identity_background_section ? `Identity & Background: ${resolved_identity_background_section}\n` : "") +
    (resolved_physical_appearance_section ? `Physical Appearance: ${resolved_physical_appearance_section}\n` : "") +
    (resolved_personality_traits_section ? `Personality Traits: ${resolved_personality_traits_section}\n` : "") +
    `Delivery: ${active_emotional_state}, ${active_pacing_level}, ${active_pitch_level} pitch, ${active_volume_level} volume`;
}
```

---

### Pro-Tips for Better Results

*   **Be Multi-Dimensional:** Avoid single words like *"nice"*. Use at least 3–4 descriptors (age, pitch, texture, and emotion).
*   **Avoid Vague Adjectives:** Instead of "happy," use "bubbly, energetic, and optimistic." Instead of "sad," use "hollow, breathy, and melancholic."
*   **The "Context" Hack:** Add a line about the acoustic environment. If you add "Sound as if speaking in a large, empty stone hall," the model will often introduce a subtle reverb or projection style that matches the prompt.
*   **Negative Prompting (If Supported):** Specify what to *avoid* to steer the acoustics cleanly (e.g., *"Avoid robotic staccato"*, *"Avoid high-pitched inflections"*, *"Avoid over-enunciating consonants"*).
*   **Use Specific Previews:** When designing a voice, use a `preview_text` that reflects how the character will actually speak (e.g., if it's an angry character, use a preview text that sounds like an argument).
*   **Troubleshooting Consistency:** If you want a character to stay identical for an entire project, "cloning" a stable sample created via Voice Design often produces more consistent results than relying on the text prompt alone for every single sentence.
*   **Technical Constraints:** Keep your prompt under 2,048 characters. While the models are multilingual, English and Chinese descriptions are currently the most reliable for conditioning the voice characteristics.

---

# the design voice api node

"C:\Users\Desktop-Dev\Desktop\AudioBooks\comfyui_workflows\Qwen3-tts-DesignVoice_API.json"

This is the structure of the style used in this node.

Character Name: Lin Huaiyue

Voice Profile: A powerful, commanding middle-aged male voice; resonant and booming, characterized by a deep, authoritative register and strong emphasis.

Identity & Background: Lead Consultant for a national key scientific research project and a seasoned strategic scientist nearing seventy. A veteran of major national technological breakthrough initiatives, he has weathered decades of adversity, witnessing the arduous journey from industrial backwardness to indigenous innovation. Currently a lifetime honorary member of the National Science and Technology Advisory Committee, he remains dedicated to mentoring young talent on the front lines and providing strategic guidance for national development.

Physical Appearance: Possesses an upright, imposing stature. His temples are graying, and his brow is etched with the stoic resolve earned over a lifetime. He typically wears dark-colored Zhongshan suits or crisp formal attire. His gaze is calm yet piercing, and every movement exudes a natural sense of dignity and composure.

Personality Traits: Possesses a will of steel and unwavering conviction; he never retreats in the face of adversity. Deeply patriotic and invested in the nation’s future, he inextricably links his personal destiny to the country’s rise and fall. Rigorous and disciplined, he is a man of his word whose speech carries a profound sense of historical responsibility. While appearing cold and stern on the surface, he is warm-hearted, harboring great expectations for the younger generation and willingly serving as a bridge to their success.

Personal Motto: "Our generation does not exist to stand in the light, but to pave the road toward it."
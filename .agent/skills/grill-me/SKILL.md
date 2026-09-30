---
name: grill-me
description: Stress-tests and refines creative premises, character designs, video/music briefs, and plans via one-at-a-time interactive interview questions mapped along a branching Design Tree.
---
# Grill-Me — Decision Tree & Frontier Interview Engine

A high-engagement alignment engine based on the **Matt Pocock / kajili grilling methodology**.

Instead of guessing your intent, assuming constraints, or dumping a bewildering batch of 10 questions at once, this skill actively constructs a **Design Tree** and walks the **Decision Frontier** asking **one focused question at a time**, providing a recommended answer, and waiting for your call.

---

## 🏛️ The Core Philosophy

1. **One Question at a Time (No Batch Overwhelm):** Asking multiple questions at once turns creative brainstorming into filling out a tax form. One question keeps human engagement high and cognitive load low.
2. **Always Provide a Recommendation:** Never ask a lazy open-ended question. Always provide your recommended choice with a one-sentence rationale so the user can just say *"Yes"*, *"Option 2"*, or adjust course.
3. **Fact-Finding vs. Decision-Making:**
   * **Facts are the AI's job:** Search the codebase, examine prompt docs, inspect audio tags, and check files autonomously. Never ask the user for facts you can look up yourself.
   * **Decisions are the User's job:** Tonal choices, character motives, risk tolerances, stylistic pivots, and core compromises.
4. **The Decision Frontier:** A question is only ready to be asked when all its prerequisite decisions are settled. If Question B depends on Question A, you never ask B until A is resolved.

---

## 🌳 The Design Tree Architecture

At the start of a grilling session, mentally model or track the session as a **Design Tree** with settled vs. open branches:

```markdown
# Design Tree: [Project / Concept Name]

- [x] Topic / Core Premise: Cuzzy Obvious Explains Solar Energy
  - [x] Setting & Props: Otaki shed, rusted solar panel, extension cord
  - [ ] Tone & Affect Calibration (FRONTIER - Current)
    - [ ] Resolution / Punchline Escalation (Blocked by Tone)
  - [ ] MiniMax Video Model Targeting (FRONTIER)
    - [ ] Speech Timing & Word Quota (Blocked by Target Model)
```

### The Frontier Rule:
The **Frontier** is the set of all open decisions whose prerequisites are already settled. You only pick the most crucial question from the frontier to ask next.

---

## ⚙️ The Turn-by-Turn Execution Protocol

On every turn during a grilling session, follow this strict structure:

### 1. The Autonomous Fact Check (Silent)
Before asking anything, run any necessary tools (`grep_search`, `view_file`) to check existing files, previous prompts, or character bibles. Do not ask questions the workspace already answers.

### 2. State Current Progress (Brief Status)
A 1-line summary of what was just locked in.

### 3. Ask Exactly ONE Question from the Frontier
State the core decision clearly.

### 4. Provide the Recommendation & Options
Present 2–3 distinct pathways, prefixing your top suggestion with `(Recommended)` and explaining why it best serves the project:

```text
[Settled]: Character is Uncle Trev; setting is an Otaki workshop during a power outage.

### Frontier Decision: The Core Misunderstanding
How should Uncle Trev explain how solar panels generate electricity?

- (Recommended) Option A: The "Photons Are Free Storage" Theory. He argues that sunlight is just free heat the government hasn't figured out how to meter yet, so storing it in car batteries is basic civic thrift. (Fits his anti-bureaucracy shed ethos).
- Option B: The "Cloud Tax" Theory. He claims solar panels work fine in rain because clouds are just translucent steam, but the council slows down the signal.
- Option C: You have a specific theory in mind.
```

### 5. Stop and Wait
Do not generate the story, video prompt, or code yet. Wait for the user's response.

---

## 💡 Creative Writing & Motivational Tone Calibration

When grilling any creative writing project (poetry, lyrics, narrative scripts, speeches, or character monologues), always place **Emotional Register & Motivational Intent** on the Decision Frontier:

### Probing Motivational Direction on the Frontier:
Probe whether the piece should have a **Motivational / Inspirational** dimension:

```text
[Settled]: Concept is a night-shift worker watching the neon sunrise on an empty highway.

### Frontier Decision: Emotional Register & Motivational Arc
How should the emotional momentum land for the reader/listener?

- (Recommended) Option A: Gritty Motivational (Earned Resilience). Focuses on agency, physical endurance, and quiet defiance against impossible odds (banishing hollow corporate slogans in favor of concrete struggle).
- Option B: Triumphant Anthem. High-energy, accelerating momentum and an uncompromising rallying cry for breakthrough.
- Option C: Contemplative / Melancholic. Preserves quiet, vulnerable stillness without forcing an optimistic resolution.
- Option D: Satirical / Deadpan. Subverts hustle culture through ironic distance.
```

If the user selects a motivational pathway, carry that constraint into the writing skills (`poetry-craft`, `rap-lyricist`, `ai-video-storytelling`) to enforce earned agency, physical friction, and rhythmic momentum over empty platitudes.

---

## 🎬 Cinematic Staging & Psychological Directing Moves Calibration

When grilling any video, film scene, shot list, or storyboard project (cross-referencing `director-toolkit`, `ai-video-storytelling`, and `psychological-design`), probe the **Subtext-to-Moves Frontier** rather than jumping into generic camera settings:

### 1. Probe the Hidden Psychological Subtext First
Ask what unsaid pressure is vibrating beneath the surface (Fragile Denial, Status Inversion, Institutional Erasure, or Domestic Vulnerability).

### 2. Offer at least ONE "Outside-the-Box" Psychological Inversion
Always present an option that uses cognitive contrast (e.g. Anderson's rigid pastel symmetry to dramatize devastating grief, or 80s Broadcast kitchen-sink dead air to dramatize high-stakes conspiracy) rather than on-the-nose clichés.

### 3. Stage the Environmental Catalyst
Probe what physical event in the room forces the state change (The Background Arrival, The Sodium Flicker, The Dropped Score, The Optical Squeeze) so the scene moves through space and light rather than dialogue exposition.

---

## 🏁 Session Completion (The Hand-Off)

The grilling session concludes when the **frontier is empty**:
1. All critical branches (character, setting, conflict, format, motivational/emotional tone, technical limits) are settled.
2. Nothing is left silently assumed.
3. Present a crisp **Settled Decisions Summary**.
4. Ask: *"We have a complete shared understanding. Ready for me to generate the master document?"*
5. Only upon confirmation do you proceed to generate the story, poem, video prompt, or code.

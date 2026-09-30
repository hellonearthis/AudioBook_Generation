---
name: skill-creator
description: Creates, modifies, and benchmarks custom agent skills, optimizing descriptions for trigger accuracy, writing evaluations, and packaging skills with the 3-Layer Style framework.
---
# Skill Creator

A skill for creating new skills and iteratively improving them.

At a high level, the process of creating a skill goes like this:

- Decide what you want the skill to do and roughly how it should do it
- Write a draft of the skill
- Create a few test prompts and run claude-with-access-to-the-skill on them
- Help the user evaluate the results both qualitatively and quantitatively
  - While the runs happen in the background, draft some quantitative evals if there aren't any (if there are some, you can either use as is or modify if you feel something needs to change about them). Then explain them to the user (or if they already existed, explain the ones that already exist)
  - Use the `eval-viewer/generate_review.py` script to show the user the results for them to look at, and also let them look at the quantitative metrics
- Rewrite the skill based on feedback from the user's evaluation of the results (and also if there are any glaring flaws that become apparent from the quantitative benchmarks)
- Repeat until you're satisfied
- Expand the test set and try again at larger scale

Your job when using this skill is to figure out where the user is in this process and then jump in and help them progress through these stages. So for instance, maybe they're like "I want to make a skill for X". You can help narrow down what they mean, write a draft, write the test cases, figure out how they want to evaluate, run all the prompts, and repeat.

On the other hand, maybe they already have a draft of the skill. In this case you can go straight to the eval/iterate part of the loop.

Of course, you should always be flexible and if the user is like "I don't need to run a bunch of evaluations, just vibe with me", you can do that instead.

Then after the skill is done (but again, the order is flexible), you can also run the skill description improver, which we have a whole separate script for, to optimize the triggering of the skill.

Cool? Cool.

---

## Communicating with the user

The skill creator is liable to be used by people across a wide range of familiarity with coding jargon. Please pay attention to context cues to understand how to phrase your communication! In the default case:

- "evaluation" and "benchmark" are borderline, but OK
- for "JSON" and "assertion" you want to see serious cues from the user that they know what those things are before using them without explaining them

It's OK to briefly explain terms if you're in doubt, and feel free to clarify terms with a short definition if you're unsure if the user will get it.

---

## Creating a skill

### Capture Intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture (e.g., they say "turn this into a skill"). If so, extract answers from the conversation history first — the tools used, the sequence of steps, corrections the user made, input/output formats observed. The user may need to fill the gaps, and should confirm before proceeding to the next step.

1. What should this skill enable Claude to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What's the expected output format?
4. Should we set up test cases to verify the skill works? Skills with objectively verifiable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from test cases. Skills with subjective outputs (writing style, art) often don't need them. Suggest the appropriate default based on the skill type, but let the user decide.

### Interview and Research

Proactively ask questions about edge cases, input/output formats, example files, success criteria, and dependencies. Wait to write test prompts until you've got this part ironed out.

Check available MCPs / tools — if useful for research (searching docs, finding similar skills, looking up best practices), research in parallel via subagents if available, otherwise inline. Come prepared with context to reduce burden on the user.

### Write the SKILL.md

Based on the user interview, fill in these components:

- **name**: Skill identifier
- **description**: When to trigger, what it does. This is the primary triggering mechanism — include both what the skill does AND specific contexts for when to use it. All "when to use" info goes here, not in the body. Note: currently models have a tendency to "undertrigger" skills — to not use them when they'd be useful. To combat this, please make the skill descriptions a little bit "pushy".
- **the rest of the skill :)**

### Skill Writing Guide

#### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
├── README.md (user documentation & examples)
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    ├── references/ - Docs loaded into context as needed
    └── assets/     - Files used in output (templates, icons, fonts)
```

#### Progressive Disclosure

Skills use a three-level loading system:
1. **Metadata** (name + description) — Always in context (~100 words)
2. **SKILL.md body** — In context whenever skill triggers (<500 lines ideal)
3. **Bundled resources** — As needed (unlimited, scripts can execute without loading)

**Key patterns:**
- Keep SKILL.md under 500 lines; if approaching this limit, add hierarchy with pointers to `references/`.
- Reference files clearly from SKILL.md with guidance on when to read them.
- For large reference files (>300 lines), include a table of contents.

#### Writing Style & Instructions

- Prefer using the imperative form in instructions.
- Explain the **why** behind rules so the model understands the underlying reasoning and generalizes well.
- Define explicit failure modes and anti-patterns to prevent predictable generative drifts.

#### Designing Voice & Style Skills (The 3-Layer Rule)

When building skills that emulate specific writing styles, authors, or comedic personas:
1. **Never stop at Level 1 (Surface):** Word lists, punctuation habits, and profanity are non-distinctive.
2. **Encode Level 2 (Structural Rhythm):** Define cadence, tension-release timing, where the turn/punchline lands in a stanza or paragraph, and front-loading vs burying information.
3. **Lock Level 3 (Stance & Posture):** Codify the speaker's philosophical/emotional relationship to their subject (e.g. unblinking literalism, ironic distance, weaponized vulnerability).
4. **The Counterfactual Invariance Test ("What Breaks If I Change X?"):** For every candidate rule, ask: *If this rule is removed or inverted, does the voice immediately collapse?* If yes, keep it as a core constraint; if no, demote or discard as surface noise.

### Test Cases

After writing the skill draft, come up with 2–3 realistic test prompts — the kind of thing a real user would actually say. Share them with the user: *"Here are a few test cases I'd like to try. Do these look right, or do you want to add more?"* Then run them.

Save test cases to `evals/evals.json`.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result",
      "files": []
    }
  ]
}
```

---

## Running and Evaluating Test Cases

### Step 1: Spawn runs (with-skill AND baseline)

For each test case, execute two runs:
- **With-skill run:** Execute the task with the new skill loaded.
- **Baseline run:** Execute without the skill (or using the previous version snapshot) to quantify value-add.

### Step 2: Draft assertions & failure checks

Draft testable assertions for each test case:
- Did it follow structural schemas?
- Did it avoid all defined failure modes?
- Did it adhere to the length/density constraints?

### Step 3: Grade and iterate

1. Grade each run against assertions.
2. Focus revisions on where the model deviated or where user feedback identifies weakness.
3. Keep the prompt lean — remove instructions that aren't pulling their weight.
4. Bundle scripts in `scripts/` if test runs show repeated programmatic work.

---

## Description Optimization

The description field in SKILL.md frontmatter determines triggering accuracy.

1. **Generate trigger eval queries:** Create a mix of 8–10 realistic should-trigger queries (including casual speech and colloquial phrasing) and 8–10 tricky near-miss should-not-trigger queries.
2. **Iterate and refine description:** Optimize phrasing until the model triggers consistently without false positives.

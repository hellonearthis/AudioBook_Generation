# Skill Creator & Optimization Engine

## Overview
This meta-skill guides the creation, auditing, evaluation, and refinement of custom agent skills in `.agents/skills/`. It enforces production-grade structural standards: pushy triggers, concrete failure modes, distinctiveness guardrails, and automated validation scripts.

## Core Features
1. **The 5 Golden Rules:** Ensures all skills have pushy triggers, failure modes, cross-skill guardrails, operational mechanics, and standalone docs.
2. **End-to-End Creation Pipeline:** Streamlined 5-step workflow (Intent $\to$ `SKILL.md` $\to$ Validator Script $\to$ `README.md` $\to$ Master Catalogs).
3. **Auditing & Iteration:** Diagnoses under-triggering, voice bleed, or loose structural rules in existing skills and upgrades them.

## How to Use
Ask the agent to create a new skill or optimize an existing one:

**Example Prompts:**
- "Use the skill-creator skill to make a new skill for writing cyberpunk worldbuilding lore."
- "Audit and upgrade our dialogue skills using skill-creator."
- "Turn this multi-step conversation into a permanent agent skill."

## What to Expect
You will receive:
1. Complete, production-grade `SKILL.md` with YAML frontmatter, closed menus, failure modes, and output schemas.
2. Standalone `README.md` user documentation.
3. Standalone Python validation script (if structural/verifiable).
4. Automatic indexing in `catalog_readme.md` and root `README.md`.

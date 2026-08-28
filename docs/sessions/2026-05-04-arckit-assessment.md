# ArcKit Relevance Note For Themis

**Date:** 2026-05-04

**Source:** https://arckit.org/

**Purpose:** Capture what is useful from ArcKit without pulling Themis away from the KISS-first activation/project-foundation path.

---

## Short Take

ArcKit is useful for Themis as a reference for **agent-assisted project structure**, not as a product shape to copy wholesale.

ArcKit packages architecture/governance work into explicit AI commands, templates, role guides, example outputs, and lifecycle phases. That is close to Themis' ambition: agents should not just chat; they should create structured, reviewable project artifacts that preserve context.

Themis should learn from ArcKit's command/artifact discipline while avoiding ArcKit's breadth and governance-heavy complexity in the early product.

---

## What ArcKit Appears To Be

ArcKit describes itself as an enterprise architecture governance and vendor procurement toolkit.

Observed concepts:

- 70 AI-assisted commands.
- Commands mapped to delivery/governance phases.
- Template-driven, audit-ready artifacts.
- Works across Claude Code, Gemini CLI, Codex CLI, OpenCode, and GitHub Copilot.
- Project initialization flow that creates a structured project artifact directory.
- `/arckit.start` to orient the agent/user and recommend next steps.
- `/arckit.init` to initialize project structure.
- `/arckit:build` to bulk-build architecture artifacts in waves with resumable state.
- Role-specific command recommendations.
- Example projects showing generated outputs.
- Strong emphasis on human review of AI-generated artifacts.

---

## Useful Ideas For Themis

### 1. Agent commands should be product-level actions

ArcKit's commands are not generic prompts. They are named product workflows like requirements, risk, roadmap, data model, design review, and traceability.

For Themis, this suggests future agent actions such as:

- `start_project`
- `seed_project_context`
- `summarize_current_state`
- `propose_next_tasks`
- `record_decision`
- `append_progress_update`
- `prepare_review_context`

The KISS version is not 70 commands. It is 3-5 excellent actions that map to the first useful loop.

### 2. The first command should orient the user/agent

ArcKit has `/arckit.start`, which checks project status, connected tools, and recommended next steps.

Themis could eventually have a similar first action:

```text
/themis.start
```

or, through MCP/API:

```text
get_project_status
get_next_focus
```

This fits Themis strongly because the product goal is reducing context switching and helping the user know what matters next.

### 3. Templates can make agent output predictable

ArcKit's value is partly that AI output is constrained by templates and artifact types.

For Themis, project seeding should not ask an agent to "summarize the repo" vaguely. It should ask for specific sections:

- project purpose
- current implementation state
- active branch/workstream
- key files
- known gaps
- next safe focus
- risks/blockers
- decisions discovered

This makes the agent output easy to store, compare, and review.

### 4. A lightweight artifact model matters

ArcKit produces explicit artifacts. Themis should do the same, but with fewer primitives.

KISS Themis primitives:

- Project
- Project context
- Project document
- Decision
- Task/update later

Do not begin with dozens of artifact types.

### 5. Role/context-specific guidance is valuable later

ArcKit has role guides for enterprise architect, product manager, delivery manager, DevOps engineer, etc.

For Themis, this can become a future feature:

- "What should a Tech Lead look at next?"
- "What should the agent prepare for a Product Manager?"
- "What should be summarized for a Delivery Manager?"

But this is a later layer. For now, Themis should focus on one primary user: the builder/tech lead using agents to preserve execution context.

### 6. Build recipes are interesting, but dangerous early

ArcKit's `/arckit:build` can bulk-build many artifacts through wave plans and resumable state.

Themis could later support project recipes such as:

- SaaS product seed
- internal tool seed
- migration project seed
- AI-agent integration seed

But not now. Early recipes should be tiny and transparent.

---

## What Not To Copy

Avoid copying these ArcKit characteristics into early Themis:

- Do not create a large command catalog before the core loop works.
- Do not optimize for heavy governance/compliance first.
- Do not make setup feel like installing a methodology.
- Do not generate many artifacts that users will not maintain.
- Do not make the product depend on a particular AI CLI too early.
- Do not make Themis feel like an enterprise architecture suite.

Themis' advantage should remain: calm, low-overhead operational continuity for projects and agents.

---

## Better Interpretation: ArcKit As A Pre-Seed Step

The most useful near-term idea is not to copy ArcKit into Themis. It is to use ArcKit **before Themis seeding** as a preparation layer.

ArcKit can help an agent produce structured project material first, then Themis can ingest the useful parts as durable project context.

Suggested flow:

1. User points an AI agent at a repository or idea.
2. Agent runs a small ArcKit-style preparation pass.
3. Preparation pass creates/refines structured artifacts such as:
   - project purpose
   - stakeholder/problem summary
   - requirements
   - risks
   - architecture notes
   - decisions
   - delivery plan / next tasks
4. Human reviews or lightly edits the output.
5. Themis seed imports/summarizes those artifacts into:
   - project context
   - project documents
   - decisions
   - suggested next focus
   - later, tasks

This makes Themis seeding higher quality because the seed is not raw repo scanning only. It is repo scanning plus a structured preparation pass.

### KISS version

Do not require users to install or understand all of ArcKit.

For now, Themis could expose the idea as one optional instruction in the seed prompt:

```text
Before seeding Themis, prepare the project like an architecture/project brief.
Create concise sections for purpose, requirements, risks, decisions, current state, and next work.
Then use those sections to create or update Themis project context.
```

Later, if this proves useful, Themis could support an explicit pre-seed source:

```text
Import prepared project brief
```

or:

```text
Seed from ArcKit artifacts
```

But this should be optional. The core Themis activation flow should still work without ArcKit.

### Why this is valuable

- Themis receives better structured input.
- ArcKit handles the "prepare the project thinking" step.
- Themis handles continuity: storing, updating, decisions, next focus, and eventually tasks.
- The user keeps a simple mental model: prepare first, then seed.

---

## KISS-First Application To Current Themis Slice

ArcKit reinforces the current recommendation: finish activation/project foundation first.

A useful near-term Themis activation seed prompt should behave like a mini ArcKit/pre-seed command:

```text
Analyze this repository and prepare Themis project context.

Return:
1. Project purpose
2. Current implementation state
3. Important files and commands
4. Known gaps
5. Suggested next 3 tasks
6. Risks/blockers
7. Decisions that should be recorded

If Themis API access is available, create or update the project and project documents.
If not, return structured markdown that can be pasted into Themis.
```

This borrows ArcKit's structure without importing its complexity.

---

## Recommendation

Use ArcKit as inspiration for the **agent workflow layer** of Themis:

1. Agent actions should be named and structured.
2. Project seeding should produce predictable artifacts.
3. Themis should be able to tell the user/agent the next best action.
4. Human review should remain explicit.
5. Start with a very small command/action surface.

Suggested first Themis action set:

- `get_activation_status`
- `seed_project_context`
- `get_project_context`
- `record_decision`
- `suggest_next_focus`

Only after these feel useful should Themis expand into tasks, recipes, or richer role-specific workflows.

---

## Product Principle

ArcKit shows the power of turning AI assistance into repeatable workflows.

Themis should do the same, but with less ceremony:

> ArcKit is structured governance for architecture artifacts. Themis should be structured continuity for project execution.

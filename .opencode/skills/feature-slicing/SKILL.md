---
name: feature-slicing
description: Split a large feature or SDD spec into small vertical PR slices with verification and handoff boundaries for Themis.
compatibility: opencode
metadata:
  audience: agents
  workflow: planning
---

# Feature Slicing Skill

Use this skill when starting a new feature, implementing an SDD spec, or when a change is becoming too large to review comfortably.

## Workflow

1. Read `AGENTS.md` and `docs/agents/workflow.md`.
2. Read the relevant area guidance files for the feature, such as `docs/agents/frontend.md`, `docs/agents/backend.md`, `docs/agents/e2e.md`, or `docs/agents/design-system.md`.
3. Inspect the existing code and the current spec or issue before proposing slices.
4. Split the work into vertical PR slices that each have a clear review goal.
5. Identify enabling infrastructure PRs only when they are useful independently.
6. For each slice, list expected files, verification commands, risks, and dependencies.

## Output Format

Return a concise plan with:

- Feature goal.
- Proposed PR slices in order.
- Files or areas likely touched per slice.
- Verification command per slice.
- Risks and open questions.
- Recommended first slice.

## Sizing Rules

- Aim for slices below roughly 500 changed lines when practical.
- Slices above roughly 1000 changed lines need a reason they cannot be split.
- Avoid mixing broad refactors, new infrastructure, product behavior, and E2E coverage in one slice.
- Prefer route-specific or scenario-specific E2E slices.

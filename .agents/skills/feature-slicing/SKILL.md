---
name: feature-slicing
description: Split a large requested change into small vertical reviewable slices with verification and handoff boundaries. Use only when multiple slices are needed, not as a mandatory workflow for every edit.
compatibility: opencode
metadata:
  audience: agents
  workflow: planning
---

# Feature Slicing Skill

Use this skill when a requested change is too large for one comfortable review, or the user explicitly asks to split it. A small change needs only its next step, not a formal plan or SDD workflow.

## Workflow

1. Read applicable repository instructions, including `AGENTS.md`.
2. Discover and read relevant area guidance that actually exists; do not assume template paths.
3. Inspect the relevant existing code and current request, spec, or issue before proposing slices. Preserve domain-first DDD boundaries, installed versions, and privacy constraints.
4. Split the work into vertical PR slices that each have a clear review goal.
5. Identify enabling infrastructure PRs only when they are useful independently.
6. For each slice, list evidence-backed files/areas, focused verification, risks, and dependencies. Do not add infrastructure or abstractions for hypothetical future work.
7. Present the recommended next slice and respect the user's approval checkpoints. Planning alone does not authorize branches, commits, publication, or implementation.

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
- Avoid mixing unrelated refactors or speculative infrastructure with product behavior. Keep the focused tests needed to verify a slice with that slice.
- Prefer route-specific or scenario-specific E2E slices.

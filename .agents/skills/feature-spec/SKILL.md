---
name: feature-spec
description: 'Draft a small, human-reviewed feature specification only when the user explicitly asks for a feature spec or requirements document. Do not select roadmap work, create branches, or start implementation automatically.'
---

# Feature Spec

## Scope

Use the current user request and applicable repository instructions as the source of scope. Inspect relevant existing code and documentation; do not assume a constitution directory, roadmap, branch convention, version file, or document destination exists.

This skill drafts requirements, not implementation authorization. Preserve the existing Angular/Express/Node/Nx stack, domain-first DDD boundaries, privacy constraints, and user-selected checkpoints. Do not add dependencies or infrastructure without approval.

## Workflow

1. Confirm the requested outcome, non-goals, and acceptance criteria from available context.
2. Inspect only the relevant capability, dependencies, tests, and established patterns. Use `context-map` for a concise impact map when useful.
3. Ask only unresolved questions that materially affect scope or decisions. Do not repeat answered questions or require a fixed question count.
4. Present a short draft for review using the format below. Keep a small feature to one concise draft; do not create multiple documents by default.
5. Revise after feedback. Save a file only when requested, using an established repository location or a destination agreed with the user.
6. Stop at the user's approval checkpoint. Do not create a branch, update a roadmap, bump a version, or implement the feature merely because the specification is drafted.

## Suggested Draft

- **Goal:** the user-visible outcome.
- **Scope and non-goals:** the smallest independently useful change.
- **Acceptance criteria:** observable behavior, failure cases, and relevant privacy/security constraints.
- **Affected capability:** existing files or areas, with evidence rather than guessed paths.
- **Next slice:** one reviewable step and its focused verification.
- **Open decisions:** only matters not settled by the request or repository instructions.

Use `feature-slicing` only if the change needs multiple reviewable slices. A PRD, ADR, or detailed implementation plan is optional and should be produced only when requested or justified by a substantial decision, not as an automatic chain.

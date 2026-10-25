---
name: create-implementation-plan
description: 'Create an implementation plan when the user explicitly requests one, or after agreeing that a multi-step change needs a written plan. Keep it proportional, reviewable, and subject to user approval; do not trigger for every feature or fix.'
---

# Create Implementation Plan

## Scope

Read applicable repository instructions and inspect the relevant existing code before planning. Preserve the installed stack, domain-first DDD boundaries, privacy rules, and established verification targets. Prefer the smallest useful change; do not plan speculative layers, frameworks, dependencies, or infrastructure.

A plan is a proposal, not permission to execute, create branches, commit, publish, or skip user checkpoints. Ask about material unresolved decisions; do not invent exact paths, line numbers, constants, or requirements merely to make a plan appear deterministic.

## Workflow

1. Summarize the goal, non-goals, and constraints already established.
2. Identify relevant files and tests from evidence. Use a short `context-map` if helpful.
3. Propose one reviewable next step, or a short ordered list of vertical slices for larger work. Use `feature-slicing` when necessary; note real dependencies instead of forcing parallel execution.
4. For each step, state the intended change, verification, and any decision that needs approval.
5. Present the plan for review and follow the user's requested execution boundary.
6. Save only when requested, at an existing project convention or agreed destination. Do not require a new `/plan/` directory or a fixed set of companion documents.

## Suggested Format

- **Goal / non-goals**
- **Relevant constraints and existing patterns**
- **Next step or ordered slices:** affected files/areas, intended behavior, focused checks
- **Risks / open decisions**
- **Approval checkpoint**

Small changes may need only a few bullets. Include alternatives, migration details, rollback, or an ADR only when the actual risk or a durable architecture decision warrants them. Existing requested templates may be used, but eight sections, coded identifiers, status badges, and machine-readable tables are not mandatory.

## Verification and Status

Use existing Nx targets and repository commands. Distinguish planned checks from checks actually run; record failures, skipped checks, and limits honestly. Update completion status only from evidence. Do not invent coverage percentages or require documentation work unrelated to the requested change.

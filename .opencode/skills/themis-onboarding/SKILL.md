---
name: themis-onboarding
description: Use on the first Themis interaction in a workspace to detect whether the project is new or initialized, gather or inspect context, and create an agreed project plan.
---

# Themis First-Run Onboarding

This skill is usable by any agent. It does not require OpenCode's custom
`themis_*` tools; use the `pnpm themis` CLI when those tools are unavailable.

OpenCode provides the complete control-plane experience through the
`themis-coordinator` agent and `themis_*` tools. Other agents can use this skill
for project discovery and task management through the CLI, but must not claim
to provide the delegated execution, evidence, approval, and review protocol
unless those capabilities are actually available.

## Required First Step

Run `pnpm themis workspace-status --json` before creating or changing any
Themis entity. Do not infer initialization from the presence of a Git
repository. A workspace is initialized when `.themis/state.json` or
`.themis/events.ndjson` exists.

## New Workspace

Ask the user for:

- What they want to build or change.
- Who or what the outcome is for.
- The desired first milestone and approximate time horizon.
- Constraints, non-goals, and known risks.

Reflect the understanding back to the user and wait for confirmation. After
confirmation, create the project, split the goal into one or more epics, define
outcome-oriented work items, propose sprints, and record the timeline through
the normal CLI commands. Do not invent detailed requirements silently.

## Initialized Workspace

Inspect the repository before planning. Prefer `graphify` when its knowledge
graph is available and relevant; otherwise use an exploration agent or focused
repository inspection. Review the existing Themis portfolio, work items,
sprints, validation result, and `pnpm themis timeline --json`.

Give the user a concise report covering:

- Detected project structure and important domains.
- Existing Themis projects, epics, sprints, and unfinished work.
- Inferred risks, gaps, and likely next milestones.
- Evidence used and uncertainty that still needs confirmation.

Iterate with the user on that report. Only after they confirm the context,
create or update epics, work items, sprint proposals, and the timeline.

## Planning Rules

- Keep project ownership explicit on every epic, work item, and sprint.
- Keep epic scope separate from sprint scope; an epic may span sprints.
- Use a timeline as an audit view of events, not as a second mutable database.
- Every work item needs acceptance criteria, scope boundaries, and verification.
- With OpenCode, use `themis_*` tools and stop for human sprint approval.
- Without OpenCode, use the CLI and state clearly that delegated execution and
  lifecycle gates are not available through this skill alone.

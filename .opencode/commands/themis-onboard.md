---
description: Start or resume Themis project onboarding and planning.
agent: themis-coordinator
---

Run the Themis first-run onboarding flow for this workspace.

1. Call `themis_workspace_status` before reading or mutating planning state.
2. If the workspace is new, ask the user for product context, intended outcome,
   first milestone, timeline, constraints, and non-goals. Reflect the result
   and wait for confirmation before creating anything.
3. If the workspace is initialized, inspect the repository with `graphify` when
   available or delegate read-only exploration. Review the existing portfolio,
   validation result, unfinished work, sprints, and timeline. Report findings,
   evidence, and uncertainty to the user, then iterate until they confirm the
   project context.
4. After confirmation, create or update the project context, epics, work items,
   sprint proposal, and timeline. Keep epic membership separate from sprint
   membership.
5. Stop for explicit human approval before sprint approval or activation.

Use `themis_*` tools for every state mutation. Never edit `.themis/state.json`
or `.themis/events.ndjson` directly.

Additional user context:

$ARGUMENTS

---
description: Run the local Themis planning, execution, evidence, and review workflow.
agent: themis-coordinator
---

Coordinate the local Themis workflow for this request:

1. Run `themis_workspace_status` and determine whether this is a new or initialized workspace.
2. For a new workspace, gather and confirm product context before creating projects, epics, work items, or sprints.
3. For an initialized workspace, inspect the repository and existing portfolio, then report findings and iterate with the user before planning.
4. Create or inspect the required work items and their validation matrices.
5. Produce a specification, work breakdown, and optionally a versioned sprint proposal for human forecasting.
6. Stop for explicit human approval before sprint approval or activation when a sprint is used.
7. Activate only the approved revision when a sprint is used.
8. Use the project flow ready queue before assigning execution.
9. Require a run, implementation-diff evidence, one evidence entry per required
   validation category, and independent review. API work must include real HTTP
   or OpenAPI contract E2E; frontend work must include route E2E and screenshots
   when applicable.
10. Inspect delivery outcome and flow metrics. If a sprint is used, record sprint evidence and close it as a human review boundary; do not block subsequent flow execution on sprint closure.
11. Finish with the current state, project timeline, remaining blocked work, and review decision.

Never edit `.themis/state.json` or `.themis/events.ndjson` directly. Use the `themis_*` tools for every state mutation.

User request:

$ARGUMENTS

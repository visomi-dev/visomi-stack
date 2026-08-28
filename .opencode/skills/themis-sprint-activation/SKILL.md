---
name: themis-sprint-activation
description: Use when reviewing, approving, activating, or recalculating the executable baseline of a local Themis sprint.
---

# Themis Sprint Activation And Closure

Activation is a human gate when a sprint is used as a planning or forecasting
cadence. It is not required before agents execute project-flow work.

Only one sprint may be active within a project. Different projects may have
active sprints concurrently. Always pass and verify the project context before
activation. This constraint applies to sprint planning context, not to project
execution flow.

The required order is:

1. Inspect the proposed revision.
2. Confirm scope, dependencies, non-goals, and verification.
3. Use `themis_sprint_approve` only after explicit human approval.
4. Use `themis_sprint_activate` with the approved revision.
5. Use `themis_ready_queue` to inspect sprint-scoped work, or
   `themis_flow_ready_queue` to inspect project-flow work.

When all sprint work is terminal, closing is a separate human-gated step:

1. Confirm every sprint item is `done` or intentionally `cancelled`.
2. Confirm no runs are open and no reviews are pending.
3. Run every sprint-level verification command and record the observed results
   with `themis_sprint_evidence_add`.
4. Use `themis_sprint_close` with the explicit project and sprint identifiers.
5. Only then propose or activate the next sprint in that project if another
   human planning cadence is needed. Flow execution does not wait for closure.

Do not activate a draft or unapproved revision. Activation converts the selected work items into the sprint planning baseline; project-flow work remains independently claimable when dependencies are complete. Do not infer sprint closure from an empty ready queue; closure requires terminal selected work and final verification evidence.

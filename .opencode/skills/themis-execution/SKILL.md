---
name: themis-execution
description: Use when an OpenCode executor must claim and implement one ready Themis work item within its approved scope.
---

# Themis Execution

The executor must follow this sequence:

1. Call `themis_flow_ready_queue` with the explicit project identifier. Use
   `themis_ready_queue` only when a human sprint context is explicitly required.
2. Select one item returned by the queue.
3. Call `themis_work_claim`.
4. Call `themis_run_start`.
5. Implement only the claimed item's `scopeIn`.
6. Read and classify the validation matrix before choosing the verification path.
7. Record discovered work separately instead of expanding the current item.
8. Ask the verifier to run every required category, including API/OpenAPI
   contract tests and visual snapshot checks where applicable.

The executor cannot approve its own review and cannot transition directly to `done`. Never bypass a failed precondition by editing local state files.

If the claimed item's contract is incomplete, ask the coordinator to use
`themis_workitem_update` to correct it. Do not create a duplicate validation
item solely because the existing item needs its verification strategy updated.

An active sprint is optional for execution. The project flow, dependency state,
WIP policy, evidence, and independent review are the authoritative execution
constraints. A sprint is planning and forecasting context, not a scheduling
lock.

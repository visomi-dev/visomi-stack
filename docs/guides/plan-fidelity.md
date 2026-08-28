# Approved Plan Fidelity

Themis treats a confirmed plan as an explicit phase inventory. Planning agents
must preserve every phase and every rich step as observable state rather than
compressing the plan into generic implementation language.

## Mutation protocol

1. Capture the confirmed phase IDs and rich steps.
2. Before a mutation, show a matrix containing every phase, mapped work-item ID
   or explicit sub-scope, status, and gaps.
3. Apply the mutation through Themis tools.
4. Show the matrix again and compare coverage. Any omitted phase blocks review.
5. For an approved scope change, update the affected item and rework it, or
   create a separate item. Never silently replace approved scope.
6. Only authorized Themis mutation tools may change workflow state. Never edit
   `.themis/state.json` or `.themis/events.ndjson` directly, fabricate status,
   or infer evidence from an unrelated check.
7. Run `validationMatrixErrors` before accepting an item; malformed rows,
   duplicate categories, missing categories, and empty not-applicable reasons
   are hard failures. Run `traceabilityErrors` after rendering the matrix; any
   gap blocks the mutation or review.

UX research, user flows, evaluation, prototypes, and human-readable state/event
translation are examples of rich steps. They must be acceptance criteria or
separate work items with their own validation matrix.

## Validation contract

Every item has exactly one classification and an exact check for each category:
`unit`, `api`, `app-e2e`, `gateway-e2e`, `site-e2e`, `visual`, `security`, and
`build`. `not-applicable` requires a reason. The focused evaluator checks
omission detection, rich-step preservation, before/after traceability,
scope-change handling, and matrix completeness.
`evidenceMatrixErrors` requires exactly one evidence entry for each required
category, with an exact command and observed result in that entry; a shared
generic observation is not valid evidence.

Run the evaluator directly with `pnpm run plan-fidelity:test`. This executable
path imports and exercises `scripts/plan-fidelity.ts` through
`scripts/plan-fidelity.test.ts`; it is recorded separately from any nearest Nx
project checks because these workflow artifacts are project-less.

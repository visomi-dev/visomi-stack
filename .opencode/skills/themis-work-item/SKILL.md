---
name: themis-work-item
description: Use when creating, defining, or preparing a Themis local work item with acceptance criteria, boundaries, dependencies, and verification strategy.
---

# Themis Work Items

Use the `themis_workitem_create` tool for creation. Never edit `.themis/state.json` directly.

Every work item must define:

- An owning project and, when applicable, an epic.
- A concise title and outcome-oriented summary.
- Observable acceptance criteria.
- Explicit `scopeIn` paths or behaviors.
- Explicit `scopeOut` exclusions.
- A verification strategy with a validation matrix and concrete commands or checks.

The validation matrix must classify these categories as `required` or
`not-applicable`: `unit`, `api`, `app-e2e`, `gateway-e2e`, `site-e2e`, `visual`,
`security`, and `build`. A not-applicable category must include its reason.
Use stable labels in `verificationStrategy`, for example:

```text
[api][required] pnpm exec nx run api-e2e:openapi
[visual][not-applicable] No user-visible frontend behavior changed.
```

API items must use real HTTP/API E2E or an OpenAPI-driven contract runner.
Frontend items must use route E2E; visual changes must also use deterministic
screenshots and snapshot review. Do not treat a generic test command as a
substitute for a category.

Create the item in `draft`, then transition it to `ready` only after all required fields are present. Do not add implementation details that belong in the sprint plan. Record discovered work as a separate item instead of silently expanding scope.

When an existing work item needs corrected acceptance criteria, scope, or
validation requirements, use `themis_workitem_update` instead of creating a
duplicate item. Updating a reviewed or done item reopens it in `rework`,
preserves its runs, evidence, and review history, and requires a new execution
and independent review. The supported pending state for this purpose is
`rework`; do not invent a separate `pending` status.

## Plan Fidelity

When an item comes from a confirmed plan, record its source phase ID and keep
each phase mapped to one item or an explicit sub-scope. UX research, user flows,
evaluation, prototypes, human-readable state/event translation, and other rich
steps must be observable in acceptance criteria or represented by separate
items. Before and after a mutation, the coordinator must show the complete
phase-to-work-item matrix with coverage, item IDs, statuses, and gaps.

Approved scope is not silently replaceable: use `themis_workitem_update` and
rework for changed existing scope, or create a new item for separate scope.
Use `scripts/plan-fidelity.test.ts` to evaluate omission, traceability, and
scope-change behavior.

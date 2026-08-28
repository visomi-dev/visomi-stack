---
name: themis-review
description: Use when independently comparing a local Themis implementation against its work item, sprint revision, and recorded evidence.
---

# Themis Review

The reviewer is independent from the executor. Inspect:

- Work item acceptance criteria.
- Scope in and scope out.
- Active sprint revision.
- Implementation diff or commit evidence.
- Verification evidence.
- Validation matrix coverage, including required and justified not-applicable
  categories.
- Regressions and missing tests.

For API changes, confirm real HTTP requests and the OpenAPI contract target
were run when required. For frontend changes, confirm route E2E and inspect
deterministic screenshot/snapshot evidence when required. An accepted review
must not rely on a generic verification entry when a matrix category is
missing.

When rework changes the work item contract, review the latest run and evidence
after `themis_workitem_update`; historical accepted reviews remain audit
history and do not satisfy the new execution automatically.

Use `themis_review_submit` with `accepted` only when the evidence supports the acceptance criteria. Use `rejected` when actionable rework is required. A rejected review moves the work item to `rework`; it does not silently change the sprint scope.

An accepted work-item review does not require sprint closure. If a sprint is
being used as a human outcome boundary, the coordinator may run its verification
strategy, record sprint evidence, and use `themis_sprint_close` after the
selected items are terminal. Project-flow execution may continue independently.

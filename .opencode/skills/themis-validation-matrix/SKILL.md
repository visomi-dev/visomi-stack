---
name: themis-validation-matrix
description: Define and audit required unit, API, E2E, visual, security, and build validation for Themis work items.
---

# Themis Validation Matrix

Use this skill when planning, executing, verifying, or reviewing a work item
that changes product behavior.

## Categories

Classify every item as `required` or `not-applicable` for:

- `unit`
- `api`
- `app-e2e`
- `gateway-e2e`
- `site-e2e`
- `visual`
- `security`
- `build`

## Rules

- API or backend behavior requires real HTTP/API E2E or the OpenAPI contract
  runner at `pnpm exec nx run api-e2e:openapi`.
- Angular route or user-visible behavior requires app E2E.
- Any visual change requires deterministic Playwright screenshots and review of
  the resulting snapshot diff.
- Gateway, worker, realtime, or composition changes require the applicable
  gateway E2E targets.
- Security-sensitive behavior requires negative, isolation, and disclosure
  checks.
- A `not-applicable` decision must state why the category cannot observe the
  changed behavior.
- A passed unit test does not satisfy API, E2E, visual, or build validation.

## Evidence format

Record one evidence entry per required category. Each entry must contain:

- category label;
- exact command or check;
- observed result;
- report, screenshot, or snapshot location;
- blocker details when the result is `failed` or `blocked`.

Do not request independent review until the matrix is complete or the item is
explicitly blocked with a follow-up work item.

For every created or updated item, the matrix is a complete eight-row contract,
not a representative sample. Each row must contain the exact command or
observable check. A not-applicable row must explain why that category cannot
observe the changed behavior. Plan-fidelity evaluation must fail when a row is
missing or its reason is empty; use `scripts/plan-fidelity.test.ts` for the
focused contract check.

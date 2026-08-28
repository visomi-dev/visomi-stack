# Development Workflow Guidance

These instructions apply to feature planning, SDD specs, PR slicing, multi-agent collaboration, and handoff work.

## PR Size And Scope

- Prefer PRs that are small, vertical, and independently reviewable.
- A PR should usually contain one user-visible behavior slice, one API contract change, one route/page state, one E2E scenario group, or one enabling refactor.
- Avoid combining infrastructure, feature behavior, E2E coverage, and broad refactors in one PR.
- If a change exceeds roughly 500 changed lines, consider splitting it.
- If a change exceeds roughly 1000 changed lines, document why it cannot be split.
- Do not split so aggressively that reviewers cannot verify behavior end-to-end.

## Feature Slicing

For large features, prefer this order:

1. Contracts, schemas, or data model foundations.
2. Backend behavior for the first usable path.
3. Frontend happy path.
4. Validation, loading, empty, and error states.
5. Route-specific E2E coverage.
6. Polish, cleanup, and follow-up refactors.

Prefer vertical slices when a feature can be made reviewable end-to-end. Prefer enabling PRs only when the infrastructure itself is useful and easy to review.

## SDD Specs

- Keep specs scoped to one feature or phase.
- Record implementation phases as reviewable slices, not as broad layers.
- Each phase should include expected files, verification commands, and acceptance criteria.
- Update the spec when scope changes rather than hiding new scope in the PR.

## Stacked PRs And Integration Branches

- Use stacked PRs when each slice can build on the previous one cleanly.
- Use an integration branch when a large feature needs several agents or cannot land independently in main.
- Keep each stacked PR reviewable on its own and include the dependency order in the PR description.

## Agent Handoff

When work is incomplete or another agent will continue, leave concise handoff notes with:

- What changed.
- Files touched.
- Commands run and their results.
- Remaining tasks.
- Known risks or blockers.
- Recommended next PR slice.

## Verification

- Run focused Nx lint, test, build, or e2e targets relevant to the touched project when feasible.
- Prefer focused verification before broad workspace verification.
- If verification is skipped, state why and provide the exact command to run later.

Every feature work item must carry a validation matrix covering `unit`, `api`,
`app-e2e`, `gateway-e2e`, `site-e2e`, `visual`, `security`, and `build`.
Each category is either required or explicitly not applicable with a reason.
API changes require real HTTP/API E2E or the OpenAPI contract target
`pnpm exec nx run api-e2e:openapi`. Angular route changes require route E2E;
visual changes additionally require deterministic Playwright screenshots and
snapshot review. Unit tests or builds do not substitute for missing API, E2E,
visual, or security evidence.

## Plan Fidelity And Mutation Traceability

The confirmed plan is a phase inventory. Before and after any coordinator or
planner mutation, present a traceability matrix with one row per phase:

| Phase      | Work-item ID(s) or explicit sub-scope | Status  | Gaps                          |
| ---------- | ------------------------------------- | ------- | ----------------------------- |
| `phase-id` | `THM-...` or documented sub-scope     | `ready` | `none` or a concrete omission |

Every phase must have a row. Omission is a blocking gap; it must not be hidden
by merging the phase into generic implementation language. Rich plan steps,
including UX research, user flows, evaluation, prototypes, and human-readable
state/event translation, remain observable acceptance criteria or separate work
items. Approved scope changes use item update plus rework or a new item; they do
not overwrite the approved contract. The focused evaluator is
`node --experimental-strip-types --test scripts/plan-fidelity.test.ts`.

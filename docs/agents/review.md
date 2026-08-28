# Code Review Guidance

These instructions apply when the user asks for a review or when evaluating whether a change is ready for PR.

## Review Priorities

- Prioritize bugs, behavioral regressions, security risks, accessibility issues, data isolation issues, and missing tests.
- Findings come first, ordered by severity.
- Include file and line references for each finding when possible.
- Keep summaries brief and secondary to findings.
- If no findings are discovered, say so and mention residual risks or testing gaps.

## Scope Checks

- Check whether the change mixes unrelated refactors with feature behavior.
- Check whether the PR can be split into smaller vertical slices.
- Check whether enabling infrastructure is separated from behavior when practical.
- Check whether verification is appropriate for the touched projects.

## Themis-Specific Risks

- For backend changes, verify account-scoped data uses `account_id` as the tenant boundary.
- For API changes, verify request validation goes through shared route schema middleware.
- For frontend changes, verify Angular conventions, signal-based async state, and accessibility stability.
- For E2E changes, verify route-specific organization and accessible selectors.
- For design changes, verify token usage, mobile-first behavior, and contrast.

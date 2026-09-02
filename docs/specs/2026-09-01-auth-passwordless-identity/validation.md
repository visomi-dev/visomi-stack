# Passwordless Identity Route Validation

This validation log is updated as each slice ships. Each slice records
its commands and observed results in
`.themis/projects/visomi-stack/state.json` (per the themis evidence
skill, mirrored here because visomi-stack has its own `.themis/`
state).

## Slice 1 — Backend contracts (in progress)

- File scope: `apps/web/api/src/auth/auth-schemas.ts`,
  `apps/web/api/src/auth/passport.ts`.
- Pre-commit gate: must pass on the slice commit.
- Expected checks:
  - `pnpm exec nx run api:lint --skip-nx-cache`
  - `pnpm exec nx run api:test --skip-nx-cache`
- Acceptance: `passwordSchema` and `LocalStrategy` are gone. The
  challenge `purpose` enum collapses to a single `bootstrap_recovery`
  purpose (or removes the discriminator entirely if no other code
  reads it). `passport.serializeUser` / `passport.deserializeUser`
  keep only the `restricted | full` session discriminator.

## Slice 2 — Backend service foundations

- File scope: `apps/web/api/src/auth/auth-service.ts`.
- Acceptance: `verifyPassword`, `signUp`, `requestPasswordReset`,
  `submitPasswordReset` are gone. The new service exports
  `findOrCreateUserByEmail`, `bindRestrictedSession`,
  `consumeOtpAndBindSession`, `resendOtp`. Existing
  `findUserByEmail`, `findUserById`, `resolveAuthUser`,
  `createChallenge`, `resendChallenge`, `verifyChallenge` are
  retained but `getLatestChallengeForUser` and
  `getOrCreateActiveChallenge` are rewritten to use the new
  purpose enum.

## Slice 3 — Backend router

- File scope: `apps/web/api/src/auth/auth-router.ts`.
- Acceptance: the 12 removed endpoints are gone. The router mounts
  `/email-otp/{request,verify,resend}`, `/session`, `/sign-out`,
  and the passkey subrouter. The OpenAPI document regenerates with
  only passwordless endpoints.

## Slice 4 — Backend passkey alignment

- File scope: `apps/web/api/src/auth/passkey-router.ts`,
  `apps/web/api/src/auth/passkey-schemas.ts`.
- Acceptance: anonymous `registration/begin` returns 401
  `restricted_session_required`. `registration/complete` returns the
  `verificationChallengeId`. A new `registration/verify` ceremony
  upgrades the restricted session to a full session.

## Slice 5 — Frontend constants and guards

- File scope: `apps/web/app/src/app/shared/constants/routes.ts`,
  `apps/web/app/src/app/shared/auth/authenticated-guard.ts`,
  `apps/web/app/src/app/shared/activation/activated-guard.ts`,
  `apps/web/app/src/app/shared/layout/sidebar-menu/sidebar-menu.ts`.
- Acceptance: the legacy `*_PATH` and `*_URL` constants are gone.
  `IDENTITY_PATH = 'auth/identity'` and `IDENTITY_URL = '/auth/identity'`
  are added. All redirects point to `IDENTITY_URL`.

## Slice 6 — Frontend identity component

- File scope:
  - Removed: `apps/web/app/src/app/auth/sign-up/`,
    `verify-email/`, `verify-device/`, `forgotten-password/`,
    `reset-password/`, `verification-code-form/`.
  - Renamed: `auth/sign-in/{sign-in.ts,sign-in.html,sign-in.css}`
    to `auth/identity/{identity.ts,identity.html,identity.css}`.
- Acceptance: the new `Identity` component renders the unified state
  machine with the "Sign in or create an account" copy. The
  `Security` screen drops its password setup view.

## Slice 7 — i18n

- File scope: `apps/web/app/src/locales/messages.xlf`,
  `apps/web/app/src/locales/messages.es.xlf`.
- Acceptance: `messages.xlf` is regenerated from the templates.
  `messages.es.xlf` carries the new Spanish translations. The
  `@@brandName` and `@@brandHome` keys are added.

## Slice 8 — API E2E

- File scope: `apps/web/api-e2e/src/api/api.spec.ts`,
  `apps/web/api-e2e/src/api/passkey-atomicity.spec.ts`.
- Acceptance: `api.spec.ts` asserts only passwordless endpoints are
  documented and that the removed endpoints return 404 without
  creating users. `passkey-atomicity.spec.ts` adds the
  restricted-session case.

## Slice 9 — App E2E

- File scope:
  - Removed: `apps/web/app-e2e/src/auth/sign-up.spec.ts`,
    `verify-email.spec.ts`, `forgotten-password.spec.ts`,
    `reset-password.spec.ts`.
  - Renamed: `auth/sign-in.spec.ts` -> `auth/identity.spec.ts`.
  - Updated: `apps/web/app-e2e/src/support/routes.ts`,
    `apps/web/app-e2e/src/support/auth.ts`.
  - Regenerated: `apps/web/app-e2e/src/__snapshots__/chromium/auth/visual.spec.ts/`.
- Acceptance: `auth/identity.spec.ts` passes (5 cases). The visual
  snapshots are regenerated and the re-run is stable.

## Slice 10 — UI Designer

- File scope: `apps/web/ui-designer/src/prototypes/`.
- Acceptance: only `identity.html` remains. The other prototypes are
  removed.

## Slice 11 — Docs

- File scope: `docs/product/auth-flow.md`,
  `docs/architecture/backend/auth.md`.
- Acceptance: both documents describe the passwordless state
  machine. No mention of password endpoints.

## Slice 12 — server-e2e

- File scope: `apps/web/server-e2e/src/server/server.spec.ts`.
- Acceptance: the `/app/en/auth/identity` probe replaces the
  `/app/en/sign-in` probe. The Angular response carries the new
  base href and the new copy.

## Aggregate Validation

After all slices ship:

- `pnpm exec nx run app-e2e:e2e --skip-nx-cache` is green.
- `pnpm exec nx run api-e2e:e2e --skip-nx-cache` is green.
- `pnpm exec nx run server-e2e:e2e --skip-nx-cache` is green.
- `pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production --skip-nx-cache`
  is green.
- `git diff --check` is clean.
- The pre-commit hook on the final commit is green.

If the aggregate matrix cannot run inside the budget of a single
agent turn, follow the "When a test is genuinely hard to run"
playbook in `docs/agents/e2e.md` and document the skipped checks in
the handoff notes.

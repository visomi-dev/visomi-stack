# Passwordless Identity Route

## Problem

Visomi Stack's `/app/sign-in` is one of six password-based auth routes
(`/sign-up`, `/verify-email`, `/verify-device`, `/forgotten-password`,
`/reset-password`, plus `/security/password`). The backend still ships
`passport-local`, `verifyPassword`, and an `authenticationMethod: 'passkey' | 'password'`
discriminator. None of the routes can complete access without a password,
so the product cannot onboard without an existing password.

The product name in copy is "Visomi Stack", but every screen is named
after Themis (`Sign in to Themis`, "Themis home" aria-label, etc.). The
chrome logo lives in `apps/web/app/public/{isotype,wordmark}.svg` but the
canonical brand mark in `assets/` is generic placeholder artwork that
does not match any shipped copy. The product needs one auth route that
explains the dual sign-in / create intent and a brand mark that matches
the rest of the chrome.

## Goal

Replace the six password routes with a single `/auth/identity` route
that drives bootstrap, recovery, account selection, and mandatory passkey
enrollment. Eliminate every password endpoint from the backend so there
is no second-class "password fallback" authority. Update the chrome copy
to "Visomi Stack" and keep the existing brand mark.

The plan below mirrors the slice that already shipped in
`visomi-dev/themis` (PR #19 + #24) but is rebuilt from scratch against
the current state of `visomi-dev/visomi-stack` because the backend
auth model is structurally different (passport-local, `verifyPassword`,
`security/password`, `password/reset/session`).

## Non-goals

- Do not introduce a password fallback path. All authentication is
  passkey or OTP-recovered passkey.
- Do not redesign the chrome. Only the copy strings and the brand mark
  source change.
- Do not change the activation flow.
- Do not touch the Astro site landing page or its "Visomi Stack"
  branding copy.
- Do not touch the `ui-designer` gallery route beyond removing the
  auth prototypes that no longer match a real screen.

## Backend Surface

Removed endpoints (all return 404 with `code: 'route_not_found'`):

- `POST /api/auth/sign-up`
- `POST /api/auth/sign-up/verify`
- `POST /api/auth/sign-in/password`
- `POST /api/auth/sign-in/verify`
- `POST /api/auth/verify-email/resend`
- `POST /api/auth/verify-device/{begin,complete}`
- `POST /api/auth/password/forgotten`
- `POST /api/auth/password/reset`
- `POST /api/auth/password/reset/verify`
- `GET  /api/auth/password/reset/session`
- `GET  /api/auth/security/password`
- `POST /api/auth/security/password/reauthenticate`
- `POST /api/auth/security/password`

New or kept endpoints:

- `GET  /api/auth/session` (unchanged, restricted session authority)
- `POST /api/auth/sign-out` (unchanged)
- `POST /api/auth/email-otp/request` (`{ email }` -> 202, identical
  responses for known and unknown emails, 429 cooldown, 403 client flag)
- `POST /api/auth/email-otp/verify` (`{ flowId, pin }` -> 200 with
  restricted session if email is verified, 401 otherwise, 409 if the
  email has multiple accounts)
- `POST /api/auth/email-otp/resend` (`{ flowId }` -> 202 with
  `resendAvailableAt`, 429 cooldown)
- `POST /api/auth/passkey/registration/{begin,complete}`
  (begin returns 401 `restricted_session_required` if no restricted
  session; complete accepts `{ challengeId, label, attestation }`)
- `POST /api/auth/passkey/authentication/{begin,complete}`
  (begin returns `{ challengeId, options }`; complete returns
  `{ user, restrictedSession }`)
- `POST /api/auth/passkey/registration/verify` (immediate verification
  using a freshly-created passkey, restricted session upgrade)

`passport-local`, `LocalStrategy`, `verifyPassword`, `signUp`,
`requestPasswordReset`, `submitPasswordReset`, `security/password/*`,
`password/reset/session`, and the `AuthenticationMethod` discriminator
are removed. The `users.passwordHash` column is dropped; only
`emailVerifiedAt`, `createdAt`, and the new `bootstrappedAt` survive.
Sessions keep the `restricted | full` discriminator.

## Frontend Surface

Removed components (`apps/web/app/src/app/auth/`):

- `sign-up/` (+ spec, + visual)
- `verify-email/` (+ spec)
- `verify-device/` (+ spec)
- `forgotten-password/` (+ spec)
- `reset-password/` (+ spec)
- `verification-code-form/` (shared, replaced by inline `app-input`
  for the 6-digit pin in the new component)

Kept component (renamed):

- `auth/sign-in/{sign-in.ts,sign-in.html,sign-in.css}` becomes
  `auth/identity/{identity.ts,identity.html,identity.css}` with
  selector `app-identity` and class `Identity`.

Removed routes (`apps/web/app/src/app/shared/constants/routes.ts`):

- `SIGN_UP_PATH`, `VERIFY_EMAIL_PATH`, `VERIFY_DEVICE_PATH`,
  `FORGOTTEN_PASSWORD_PATH`, `RESET_PASSWORD_PATH` (and the matching
  `*_URL` constants).

New constant:

- `IDENTITY_PATH = 'auth/identity'`
- `IDENTITY_URL = '/auth/identity'`

Guards (`authenticated-guard.ts`, `activated-guard.ts`) and the
sidebar sign-out handler (`sidebar-menu.ts`) redirect to
`IDENTITY_URL` instead of `SIGN_IN_URL`.

The new `Identity` component keeps the unified state machine from the
themis port:

- `ready` -> passkey button + "Try another way"
- `passkey-loading` -> device prompt
- `passkey-error` -> retry button
- `email` -> bootstrap/recovery email form
- `otp` -> 6-digit pin form
- `account-choice` -> multi-account picker
- `enrollment` -> passkey label + create
- `enrollment-loading` / `verification-loading`
- `success` -> "Opening Visomi Stack..."

Copy in `messages.xlf`:

- `@@accessTitle` -> "Sign in or create an account"
- `@@accessDescription` -> "If the email already belongs to an account
  we will sign you in. If it does not, we will create your account once
  you verify the email and finish setting up a passkey."
- Other `@@access*` keys stay (success, retry, error labels, etc.).
- New keys for the Visomi Stack chrome:
  - `@@brandName` -> "Visomi Stack"
  - `@@brandHome` -> "Visomi Stack home"

Spanish translations are added for the new keys and the updated copy.

## E2E Surface

App E2E (`apps/web/app-e2e/src/auth/`):

- Remove `sign-up.spec.ts`, `verify-email.spec.ts`,
  `forgotten-password.spec.ts`, `reset-password.spec.ts`.
- Rename `sign-in.spec.ts` to `identity.spec.ts`; update heading
  assertion to "Sign in or create an account".
- Update `support/routes.ts` to drop the legacy routes; keep
  `identityRoute = '/app/en/auth/identity'`.
- Update `support/auth.ts` so the helper navigates to `identityRoute`.
- Regenerate `auth/visual.spec.ts` snapshots as
  `identity-{theme}.png`, `identity-email-{theme}.png`,
  `identity-passkey-retry-{theme}.png`. Drop the `sign-in-*` PNGs.

API E2E (`apps/web/api-e2e/src/api/`):

- `api.spec.ts` replaces the existing `documents only the OTP lifecycle`
  check with `documents only the passwordless OTP + passkey lifecycle`.
- New negative checks assert that the removed password endpoints
  return 404 and do not create users.
- `passkey-atomicity.spec.ts` adds a case for
  `restricted_session_required` on anonymous registration.

UI Designer (`apps/web/ui-designer/src/prototypes/`):

- Remove `app-auth-shell.html`, `passkey-sign-up.html`,
  `security-password-setup.html`.
- Rename `passkey-sign-in.html` to `identity.html` and update its
  copy to "Sign in or create an account".

Docs:

- `docs/product/auth-flow.md` rewritten to describe the passwordless
  state machine.
- `docs/architecture/backend/auth.md` updated to drop password
  endpoints.

## Slice Plan

Each slice is a single commit on `feature/auth-passwordless-identity`
based on `main`. Each slice ends with a passing pre-commit gate
(`lint-staged`, affected lint, affected unit, affected E2E).

- [ ] **Slice 1 — Backend passwordless (consolidated)**: rewrite
      `auth-schemas.ts`, `passport.ts`, `auth-service.ts`,
      `auth-router.ts`, `passkey-contract.ts`, `passkey-router.ts`,
      `passkey-schemas.ts`, plus the matching specs. The slice is
      consolidated because every backend file references symbols that
      the other files export; a finer slicing would not compile. The
      slice exceeds the 1000-line soft heuristic; the justification is
      atomicity (the backend must drop password authority in one
      reviewable commit to avoid transient states where some endpoints
      accept passwords while others reject them).
- [ ] **Slice 2 — Frontend constants and guards**: drop the legacy
      `*_PATH` constants, add `IDENTITY_PATH` / `IDENTITY_URL`, update
      `authenticated-guard.ts`, `activated-guard.ts`, `sidebar-menu.ts`,
      and any other consumer.
- [ ] **Slice 3 — Frontend identity component**: create
      `auth/identity/{identity.ts,identity.html,identity.css}`. Delete
      `sign-up/`, `verify-email/`, `verify-device/`,
      `forgotten-password/`, `reset-password/`,
      `verification-code-form/`. Adapt the Security screen to drop its
      password setup view.
- [ ] **Slice 4 — i18n**: regenerate `messages.xlf`, translate to
      Spanish, add the brand keys.
- [ ] **Slice 5 — API E2E**: rewrite `api.spec.ts` to assert only
      passwordless endpoints and that the removed endpoints return 404.
      Update `passkey-atomicity.spec.ts` with the restricted-session case.
- [ ] **Slice 6 — App E2E**: rename the auth spec to
      `identity.spec.ts`, drop the legacy specs, update the route helpers,
      regenerate the visual snapshots.
- [ ] **Slice 7 — UI Designer**: drop the obsolete prototypes,
      rename `passkey-sign-in.html` to `identity.html`, refresh copy.
- [ ] **Slice 8 — Docs**: rewrite `docs/product/auth-flow.md` and
      update `docs/architecture/backend/auth.md`.
- [ ] **Slice 9 — server-e2e**: update
      `apps/web/server-e2e/src/server/server.spec.ts` so the
      `/app/en/auth/identity` probe replaces the `/app/en/sign-in` probe.

## Verification Matrix

Each slice carries its own matrix. The aggregate matrix for the whole
feature is:

| Category   | Command                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| unit       | `pnpm exec nx run app:vite:test --skip-nx-cache`                                                                           |
| unit       | `pnpm exec nx run api:test --skip-nx-cache`                                                                                |
| lint       | `pnpm exec nx run-many -t lint --projects app,api,app-e2e,api-e2e,server,server-e2e --skip-nx-cache`                       |
| build      | `pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production --skip-nx-cache` |
| api        | `pnpm exec nx run api-e2e:e2e --skip-nx-cache`                                                                             |
| app-e2e    | `pnpm exec nx run app-e2e:e2e --skip-nx-cache`                                                                             |
| visual     | `pnpm exec nx run app-e2e:e2e --skip-nx-cache -- --grep visual`                                                            |
| server-e2e | `pnpm exec nx run server-e2e:e2e --skip-nx-cache`                                                                          |
| security   | `pnpm exec nx run api-e2e:openapi --skip-nx-cache`                                                                         |

## Risks

- **Auth schema migration**: the `users.passwordHash` column is in
  production. The migration must drop it without losing the
  `emailVerifiedAt` audit trail. If a user has a password and no
  passkey, the password column is the only authority — dropping it
  without a recovery path locks them out. Slice 3 must either keep
  the column read-only for one release, or run a backfill that
  creates a recovery passkey for every existing user. The chosen
  path is to keep the column read-only in slice 3 and schedule a
  follow-up to delete it after the next release.
- **Snapshot churn**: every visual regression snapshot under
  `apps/web/app-e2e/src/__snapshots__/chromium/auth/` will be
  regenerated in slice 9. Reviewers must compare side-by-side and
  accept the new chrome.
- **WebAuthn RP ID**: the gateway dev host is `localhost` (raw IPs
  are not valid RP IDs). The e2e config already enforces this. The
  Playwright webServer URL must move from
  `${baseURL}/app/en/sign-in` to
  `${baseURL}/app/en/auth/identity` and the `webServer.url` health
  check must pass on first boot.
- **Brand mark**: `assets/themis_isotype.png`,
  `assets/themis_logotype.png`,
  `assets/minimal_geometric_symbol_for_themis_an_ai_enhanced_*.svg`,
  and `assets/wordmark_themis_in_manrope_style_*.svg` are placeholder
  art from the template init. They are not replaced in this spec;
  only the copy changes to "Visomi Stack".
- **Hook cost**: the pre-commit gate runs affected lint, affected
  unit tests, and affected E2E. The E2E suite is the slowest step
  and requires the gateway to boot (api + app + site + worker +
  realtime) plus Redis. If the environment cannot boot the gateway,
  follow the "When a test is genuinely hard to run" playbook in
  `docs/agents/e2e.md` and document the skipped slices in the
  handoff notes.

## Open Questions

- Should the password column be dropped in this PR or in a follow-up?
  Default: keep read-only in slice 3, drop in a later PR.
- Should the new `Identity` component live at `/auth/identity` or at
  `/identity` (no `/auth/` prefix)? Default: `/auth/identity` to keep
  the routing namespace consistent with the themis port.
- Should `users.bootstrappedAt` be added now or only when the
  activation flow migrates to bootstrap-aware milestones? Default:
  add now so the audit trail is complete.

## Recommended First Slice

Slice 1 — Backend contracts. It is the smallest slice that gives the
later slices a stable schema foundation and a verifiable unit surface.

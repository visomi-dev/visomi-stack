# Passwordless Identity Route Requirements

## Functional

- F-1. `GET /app/en/auth/identity` is the only public authentication
  surface. It renders the unified state machine.
- F-2. `POST /api/auth/email-otp/request` accepts any email and
  returns 202 with identical bodies for known and unknown emails. The
  response is non-enumerating.
- F-3. `POST /api/auth/email-otp/verify` consumes the OTP. If the
  email has no account, the OTP consumption creates the user and
  issues a restricted session. If the email has one account, the
  restricted session is bound to it. If the email has multiple
  accounts, the response is 409 `multiple_accounts` and the client
  must call `/api/auth/restricted/accounts` to choose.
- F-4. `POST /api/auth/email-otp/resend` accepts a `flowId` and
  returns 202 with the new `resendAvailableAt`. It enforces the
  configured cooldown (60 seconds).
- F-5. `POST /api/auth/passkey/registration/begin` requires a
  restricted session. It returns 401 `restricted_session_required`
  otherwise. It rejects client-authoritative flags
  (`pinVerified`, `explicitPassword`, `password_fallback`) with
  `invalid_request`.
- F-6. `POST /api/auth/passkey/registration/complete` accepts the
  WebAuthn attestation and persists the credential. It returns the
  challenge id for the immediate verification ceremony.
- F-7. `POST /api/auth/passkey/registration/verify` runs a second
  WebAuthn ceremony using the freshly-created passkey and upgrades
  the restricted session to a full session.
- F-8. `POST /api/auth/passkey/authentication/begin` is anonymous
  when no restricted session is present. It returns the WebAuthn
  public-key options plus a `challengeId`. The server must not
  persist any state that grants authority to the caller.
- F-9. `POST /api/auth/passkey/authentication/complete` consumes the
  WebAuthn assertion and issues a full session.
- F-10. Removed password endpoints return 404 with
  `code: 'route_not_found'`. They never reach the password service.
- F-11. `users.passwordHash` is read-only in this PR. A follow-up
  PR will drop the column after the next release.

## Non-Functional

- NF-1. All new code uses TypeScript strict patterns, avoids `any`,
  prefers `type` over `interface`, and keeps imports at the top.
- NF-2. All filenames are kebab-case. Component and service files
  use the bare name without suffixes. Test files use `.spec.ts`.
- NF-3. All artifacts (specs, docs, comments, identifiers, commit
  messages, UI copy, test names) are in English. Translations flow
  through `messages.xlf` / `messages.es.xlf`.
- NF-4. The pre-commit hook (`lint-staged`, affected lint, affected
  unit, affected E2E) must run green on every slice. No
  `--no-verify`.
- NF-5. The `/auth/identity` route is reachable at
  `/app/en/auth/identity` (the SSR-localized URL). The Angular
  router pattern must accept both `/app/auth/identity` and
  `/app/en/auth/identity` for backward compatibility with deep links
  that omit the locale prefix.

## Acceptance

- A-1. The OpenAPI document declares only passwordless endpoints.
  All removed endpoints are absent and the API E2E suite asserts it.
- A-2. A fresh user can complete `/app/en/auth/identity` end-to-end
  with no password ever being created. The deterministic E2E suite
  (`auth/identity.spec.ts`) covers bootstrap, retry, and full-flow.
- A-3. The visual regression snapshots render the new chrome
  ("Visomi Stack" brand name, isotype/wordmark from
  `apps/web/app/public/`).
- A-4. Anonymous passkey registration returns 401
  `restricted_session_required`. The restricted-session E2E case
  asserts it.
- A-5. Sign-out still returns the user to `/app/en/auth/identity`.
  The sidebar spec asserts the new URL pattern.

## Verification

- V-1. `pnpm exec nx run app:lint --skip-nx-cache`
- V-2. `pnpm exec nx run app:typecheck --skip-nx-cache`
- V-3. `pnpm exec nx run app:vite:test --skip-nx-cache`
- V-4. `pnpm exec nx run api:lint --skip-nx-cache`
- V-5. `pnpm exec nx run api:test --skip-nx-cache`
- V-6. `pnpm exec nx run api-e2e:e2e --skip-nx-cache`
- V-7. `pnpm exec nx run app-e2e:e2e-ci--src/auth/identity.spec.ts --skip-nx-cache`
- V-8. `pnpm exec nx run app-e2e:e2e-ci--src/auth/visual.spec.ts --skip-nx-cache -- --update-snapshots`
- V-9. `pnpm exec nx run app-e2e:e2e-ci--src/auth/visual.spec.ts --skip-nx-cache`
- V-10. `pnpm exec nx run server-e2e:e2e --skip-nx-cache`
- V-11. `pnpm exec nx run app-e2e:lint --skip-nx-cache`
- V-12. `pnpm exec nx run api-e2e:lint --skip-nx-cache`
- V-13. `git diff --check`
- V-14. `pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production --skip-nx-cache`

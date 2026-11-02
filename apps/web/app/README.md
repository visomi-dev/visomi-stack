# Web application

`web-app` is an Angular 22.2 standalone, zoneless application with SSR, hydration,
native compile-time localization and cookie-backed authentication through the
Express gateway. The gateway serves the compiled application at `/app/en/` and
`/app/es/`. The root directs the current session to sign-in, email verification,
restricted recovery enrollment or the private home page.

## Run and verify

Run from the workspace root:

```sh
pnpm nx serve web-app
pnpm nx serve web-app --configuration=development-es
pnpm nx build web-app
pnpm nx run web-app:preview
pnpm nx run web-app:extract-i18n
pnpm nx test web-app
pnpm nx e2e web-app-e2e
pnpm nx e2e web-app-e2e --configuration=auth
```

The Angular development server and standalone preview do not own an auth runtime.
They keep the public `/app/en/foundations` and `/app/es/foundations` demonstrations
available; sign-in shows an unavailable state. Use the configured gateway for
complete authentication. No frontend server opens another database or SMTP pool.

Authentication E2E uses a dedicated configuration, an isolated PostgreSQL database,
a synthetic SMTP mailbox, the compiled gateway, and Chromium/Firefox/WebKit. Its
resources belong to the test run and are closed on termination. It never reads a
developer database URL. Select `VISOMI_TEST_COMPOSE=podman-compose` when Docker's
compatibility wrapper delegates to an older Compose implementation. Use localhost
for browser passkey tests: a WebAuthn RP ID must be a valid domain, not a loopback
IP address. Chromium uses a virtual authenticator; physical passkeys and actual
Google accounts require separate manual validation.

## Authentication composition

The root owns the router outlet and global infrastructure. `AuthLayout` supplies
the centered access composition; `AuthenticatedLayout` composes the existing
`AppShell`. Guards enforce the session access level independently of the chosen
visual layout. Backend authorization remains authoritative.

The `auth/` domain groups session, passkeys, password, email, Google, TOTP, recovery
and device approval capabilities. Views use Signal Forms and native controls with
the existing UI adapters. Page-scoped HTTP clients cancel work when their view is
destroyed. A scoped journey retains only pending challenge metadata between auth
pages; it is destroyed when leaving the access layout. Passwords and codes are
not stored in URLs, browser storage or transferred SSR state.

`Session` shares reads, rejects responses older than a later session transition,
retains rotated CSRF tokens in memory and revalidates on focus. Cross-tab messages
contain only a fixed invalidation signal. Temporary failures lock private content
without asserting that the server has revoked the identity.

The owning auth runtime creates a public snapshot for each render request. The
host passes it through Angular's request context; hydration reuses the same initial
view. No SID, CSRF token, proof or permission grant enters that snapshot. HTTP auth
responses are excluded from the hydration transfer cache, and documents remain
`no-store`. All mutations obtain a CSRF token through `/api/auth/session` and send
it only to the same-origin API. Sensitive mutations are never retried automatically.

## Routes and recovery behavior

- `auth/sign-in`, `auth/sign-in/password`, `auth/sign-in/verify`: direct passkey or
  Google entry, password entry and its mandatory second factor.
- `auth/sign-up`, `auth/sign-up/password`, `auth/verify-email`: registration and
  pending email verification, including older identities without an email.
- `auth/forgot-password`, `auth/reset-password`: uniform reset request and completion
  without automatically signing in.
- `auth/google/verify-email`, `auth/reauthenticate`: provider verification and recent
  proof before sensitive changes.
- `auth/recovery`, `auth/recovery/verify`, `auth/recovery/enroll`: recovery proof and
  restricted replacement enrollment. A replacement passkey must authenticate;
  a replacement password must prove its required second factor.
- `auth/device-approval`: browser-bound pairing request. `security/devices/review`
  lets a different full session approve or deny it with recent authentication.
  Approval grants enrollment, not application access. Pairing codes stay out of links.
- `home`, `account`, `security` and its capability pages: minimal private home,
  verified email, passkeys, password, Google linking, authenticator, backup codes
  and session revocation.

Pending challenge metadata remains in memory. Reloading a password factor, Google
verification, reset or recovery proof requires restarting that step. A valid
unverified or restricted server session is still restored and directed to its
permitted task. Switching language uses a stable route and does not carry proofs.

TOTP QR codes are generated locally in a lazily loaded module. The manual key is
also available. Backup codes are displayed only immediately after creation and
can be copied or downloaded explicitly. They are cleared on departure; a reload
requires generating a replacement set. The client never sends QR content to an
external service.

Google uses its official button and a session-bound nonce. The gateway enables its
CSP sources and popup policy only on Angular documents when Google is configured;
the API and public website retain their existing policy. Other sign-in methods
remain available if Google's library cannot load.

## Localization and validation limits

English messages are extracted into `src/locales/messages.xlf`; Spanish translations
live in `src/locales/messages.es.xlf`. Missing production translations fail the build.
New passwords follow the backend's 12–128 Unicode-character policy after NFC
normalization; login does not impose the new-password policy.

Automated tests cover native forms, keyboard behavior, screenshots, real SSR,
virtual passkeys, TOTP and backup codes, recovery and two-browser approval. They do
not establish screen-reader conformance or replace manual checks of real password
managers, mobile keyboards, physical authenticators and Google provider behavior.
See [Web foundations](../../../docs/web-foundations.md) for the shared UI contract.

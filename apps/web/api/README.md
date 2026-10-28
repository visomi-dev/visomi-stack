# API authentication and persistence

Authentication uses Express 5, Passport, PostgreSQL-backed sessions, Drizzle and
SimpleWebAuthn. The application factory is import-safe. The standalone executable
and gateway each own their database pool, SMTP transport, listener and shutdown.

## Configuration and ownership

Supply configuration to the owning executable; imports do not load environment
files, connect resources, migrate schemas or create seeds.

| Variable                     | Purpose                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | PostgreSQL connection. Without it, public routes remain available and `/auth` returns 503.      |
| `AUTH_ORIGIN`                | Exact browser origin, without a trailing slash; HTTPS except loopback development.              |
| `AUTH_RP_ID`                 | WebAuthn relying party host or permitted parent domain.                                         |
| `SESSION_SECRET`             | Shared high-entropy session/HMAC secret, at least 32 bytes.                                     |
| `AUTH_TRUST_PROXY`           | Optional explicit proxy addresses/CIDRs, comma separated.                                       |
| `SMTP_HOST`, `SMTP_PORT`     | SMTP server; port defaults to 587.                                                              |
| `SMTP_SECURE`                | `true` for implicit TLS, usually port 465; otherwise STARTTLS is required.                      |
| `SMTP_FROM`                  | Sender address.                                                                                 |
| `SMTP_USER`, `SMTP_PASSWORD` | Optional paired SMTP credentials.                                                               |
| `SMTP_ALLOW_INSECURE_LOCAL`  | Test/development exception for loopback hosts only.                                             |
| `GOOGLE_AUTH_CLIENT_ID`      | Optional Google Identity Services client ID.                                                    |
| `AUTH_TOTP_ENCRYPTION_KEY`   | Optional dedicated 32-byte key encoded as 43 base64url characters. Required to enroll/use TOTP. |

Keep the TOTP key stable while enrollments exist. It is independent of the session
secret; replacing it requires an explicit re-enrollment/key migration procedure.
Changing the session secret also changes challenge, backup-code and rate-limit HMAC
verifiers and invalidates existing sessions/proofs. Do not rotate either casually.

SMTP construction does not connect. The owning executable closes its transport
and database after draining HTTP work, then flushes telemetry. Missing mail
configuration never substitutes an in-memory production transport. Email-dependent
operations fail closed; public recovery responses intentionally hide delivery and
account-existence differences. Security changes report `notificationSent` when
notification delivery is attempted after the committed change.

Production cookies are secure, HttpOnly, host-only `__Host-visomi.sid`, with
SameSite=Strict and path `/`. Loopback HTTP uses `visomi.sid`. Only configured
proxy addresses may influence forwarded-protocol handling.

## Identity and authorization

Registration asks for email before creating the initial passkey or password.
A completed credential registration establishes an `unverified` session. It can
inspect its state, request verification, verify its email and log out, but cannot
enter protected account routes. Email verification enables a `full` session.
Existing reboot users retain their passkeys and must add/verify an email. Sessions
serialized in the previous format require a new login. Legacy reference databases
are not imported.

`GET /auth/session` retains `authenticated`, `user` and `csrfToken`, and adds
`access`, `method` and `nextStep`. A non-anonymous session is not necessarily
fully authorized. Protected hosts should use the runtime's
`requireVerifiedSession` guard rather than relying on `isAuthenticated()` alone.
Passport rechecks the user's security version and current authentication method
against PostgreSQL on every request.

Passkeys are the primary method. Passwords are optional and use Argon2id, NFC
normalization and a 12–128 Unicode-character policy. Four concurrent derivations
per process bound memory usage; excess work receives a retryable 429. Password login always needs a
second step: email code, or TOTP/one-use backup when TOTP is active. Email cannot
bypass an active TOTP enrollment. TOTP secrets are authenticated-encrypted;
accepted time steps cannot be replayed, including across concurrent requests.
Ten high-entropy backup codes are displayed once; regeneration invalidates all
previous codes. TOTP and backups are not standalone primary login methods.

Google tokens are verified by `google-auth-library`, including audience, issuer,
expiry and a session-bound nonce. A linked `(issuer, subject)` always determines
the identity, even when Google changes its email. Otherwise a proven matching
email automatically links Google to the existing account, retaining its ID and
verified methods. Gmail and Workspace may establish email ownership directly;
external addresses also need our SMTP code. A previously unverified signup has
its planted credentials and sessions revoked before Google enables access.
A revoked Google identity requires explicit authenticated relinking; it cannot be
silently transferred to another user.

Security changes require authentication within five minutes. Management changes
retain the timestamp and factor evidence of the last authentication proof. Reauthenticate with
a passkey assertion, linked Google, or password plus the configured second factor.
Removing the last usable primary method is rejected transactionally. Password,
email and factor changes invalidate stale proofs and other sessions. Credential
revocation immediately invalidates sessions authenticated with that credential.

Recovery proves the verified email and creates only a restricted enrollment
session. When TOTP is active, also prove TOTP/a backup, or use an authenticated
primary method or approved device. Losing every factor, backup and authenticated
device does not permit email-only bypass of TOTP. Recovery does not decrypt data.
A replacement password must be proved with its second factor; a replacement
passkey must sign an authentication assertion before activation. Completing
recovery invalidates previous sessions and pending permissions.

New-device requests are browser-bound and paired with a six-digit code. A different
full session reviews and approves with fresh authentication. Approval is one-use,
expires, and is rechecked against the approver's live session, method and security
version. It grants enrollment permission, never direct full access.

## HTTP contract

Paths below are relative to `/auth`; the gateway mounts the same API at `/api/auth`.
First fetch `/session`, retain its cookie and send its `csrfToken` as
`X-CSRF-Token`, together with the configured `Origin`, on every mutation. Replace
the CSRF token after session rotation. Responses disable caching. JSON is bounded
to 32 KiB and rejects unexpected fields.

| Method         | Path                                                                            | Input / result                                                                       |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| GET            | `/session`, `/providers`                                                        | Session state / public provider capabilities.                                        |
| POST           | `/passkeys/registration/options`                                                | `{email}` anonymously; `{}` for enrollment.                                          |
| POST           | `/passkeys/registration/verify`                                                 | `{challengeId,response,label?}`; session plus email challenge when unverified.       |
| POST           | `/passkeys/authentication/options`                                              | `{}`; discoverable WebAuthn options.                                                 |
| POST           | `/passkeys/authentication/verify`                                               | `{challengeId,response}`; rotated session. Also passkey reauthentication.            |
| GET            | `/passkeys`, `/methods`                                                         | Owned active public method metadata.                                                 |
| PATCH / DELETE | `/passkeys/:id`                                                                 | Rename with `{label}` / revoke.                                                      |
| POST           | `/password/sign-up`                                                             | `{email,password}`; unverified session and email challenge.                          |
| POST           | `/password/sign-in`                                                             | `{email,password}`; pending `{flowId,factor,expiresAt}`.                             |
| POST           | `/password/verify`                                                              | `{flowId,factor:{kind,code}}`; full session after proof.                             |
| POST           | `/email/request`, `/email/verify`                                               | `{email?}` / `{flowId,code}`. Existing passkey users can supply their missing email. |
| POST           | `/email/change/request`, `/email/change/verify`                                 | `{email}` / `{flowId,code}`. Notify the previous address.                            |
| POST           | `/challenges/resend`                                                            | `{flowId}`; replaces code without resetting attempt budget.                          |
| POST           | `/reauth/password/start`, `/reauth/password/complete`                           | `{password}` / `{flowId,factor:{kind,code}}`.                                        |
| POST           | `/password/add`, `/password/change`, `/password/remove`                         | `{password}` / `{password}` / `{}`.                                                  |
| POST           | `/google/start`                                                                 | `{intent?: 'login' \| 'link' \| 'reauth'}`; public client ID and nonce.              |
| POST           | `/google/complete`, `/google/email/verify`                                      | `{flowId,idToken}` / `{flowId,code}` for external email.                             |
| DELETE         | `/google/:id`                                                                   | Unlink owned provider identity.                                                      |
| POST           | `/totp/setup`, `/totp/confirm`                                                  | `{}` / `{enrollmentId,code}`; confirmation returns one-time backup codes.            |
| DELETE         | `/totp`                                                                         | Remove TOTP and invalidate backups.                                                  |
| POST           | `/recovery-codes/regenerate`                                                    | `{}`; replace backup set.                                                            |
| POST           | `/password/reset/request`, `/password/reset/complete`                           | `{email}` / `{flowId,code,password,factor?}`; reset does not sign in.                |
| POST           | `/recovery/request`, `/recovery/verify`                                         | `{email}` / `{flowId,code,factor?}`; restricted session.                             |
| POST           | `/recovery/password`, `/recovery/password/complete`                             | `{password}` / `{flowId,password,factor}`; stage then prove replacement.             |
| POST           | `/device-approval/request`                                                      | `{email}`; `{requestId,userCode,expiresAt}`.                                         |
| POST           | `/device-approval/status`, `/device-approval/review`                            | `{requestId}`; requester / authenticated owner.                                      |
| POST           | `/device-approval/approve`, `/device-approval/deny`, `/device-approval/consume` | `{requestId,userCode}`.                                                              |
| POST           | `/device-approval/cancel`                                                       | `{requestId}` from the requester.                                                    |
| GET / DELETE   | `/sessions`, `/sessions/:id`                                                    | Minimal sessions with opaque public handles / revoke selected session.               |
| POST           | `/sessions/revoke-others`, `/logout`                                            | `{}`.                                                                                |

Factor kinds are `email`, `totp`, and `recovery_code`. Public session handles are
not SIDs and cannot be used as cookies. No IP address or user agent is retained as
session metadata. Password/Google removal may end the current session.

## Service composition

`createAuthentication()` creates a separate `injection-js` graph per runtime using
only the DI exports from `backend-shared`. PostgreSQL, the pool, optional SMTP and
`AUTH_CONFIG` are explicit value providers. Passwords, email identity, sessions,
method discovery, passkeys, flows, factors, Google, recovery and devices resolve dependencies with
`inject()` during construction, sharing instances only within that graph.
Controller classes resolve only their own dependencies from the same graph.
`SessionResponses` owns HTTP session establishment, CSRF rotation and logout
responses. Controllers retain no request state. Imports do not construct services
or open resources, and standalone/gateway application exports remain unchanged. Service tests use provider overrides instead of positional constructors.

## HTTP composition

`createAuthRouter()` installs the common security middleware and composes one
router per authentication capability. Each capability keeps route registration in
`router.ts`, an injectable controller class in `controller.ts`, business operations
in `service.ts`, and the shared routing/validation/documentation contract in
`contract.ts`. Routers receive their controller explicitly and delegate with inline
callbacks, preserving `this`. Router construction has no process-wide state or
import-time resources.

| Directory        | Responsibility                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/password/` | Password registration, login, reauthentication, management and Argon2id.                                                                             |
| `auth/email/`    | Email normalization, verification and address changes.                                                                                               |
| `auth/passkeys/` | WebAuthn registration, login and credential management.                                                                                              |
| `auth/google/`   | Google verification, account linking and unlinking.                                                                                                  |
| `auth/totp/`     | Authenticator enrollment, replay protection, encrypted secrets and backup codes.                                                                     |
| `auth/recovery/` | Restricted recovery and replacement-method proofs.                                                                                                   |
| `auth/devices/`  | Pairing and approval from another authenticated session.                                                                                             |
| `auth/sessions/` | Current session, logout, session listing/revocation, HTTP session responses and the PostgreSQL session store.                                        |
| `auth/methods/`  | Overview of the account's usable authentication methods.                                                                                             |
| `auth/shared/`   | Configuration, principal/authorization invariants, proof lifecycle, HTTP parsing/session responses, request limits and common cryptographic helpers. |

Unit tests live beside the capability they verify. Cross-capability HTTP and
persistence scenarios stay in `tests/integration/`, with the existing E2E suites
covering standalone, inherited and compiled gateway hosting. The root `auth/`
contains only runtime and router composition and their tests.

SMTP, typed message content, rendering and MJML resources remain in
`backend-shared`. Auth's shared notification adapter chooses a security notice and
reports delivery success without owning the transport or duplicating mail content.

## Validated contracts and OpenAPI

Zod `4.6.6` and `zod-openapi` `6.0.2` are pinned dependencies. Each operation's
contract defines its method, path, request schema, documented responses and
security requirements. `registerRoute()` uses that same method/path and parses
one Zod object containing the configured `body`, `params`, `query` and `headers`.
The controller receives `result.data` with the schema's native output type:

```ts
async requestApproval(
  request: Request,
  response: Response,
  input: z.output<typeof devicesContracts.requestApproval.request>,
) {
  const pending = await this.devices.request(request.sessionID, input.body.email);
  response.status(201).json(pending);
}
```

Input and output may differ after normalization or coercion: use `z.input` for
unparsed contract input and `z.output` inside controllers. No cast, request-wide
validated-data bag or second parse is needed. Request bodies remain strict at
operation boundaries; parsed parameters/query/header values are passed separately
without mutating Express's query getter. Domain authorization, proof lifetimes,
password policy and cryptographic verification remain enforced by the services.
WebAuthn request schemas preserve extension fields and use `satisfies` to check
compatibility with SimpleWebAuthn's types; the SDK verifies signatures and claims.

The shared adapter maps only explicitly allowlisted validation codes to public
HTTP errors. It never returns or logs raw Zod issues, paths or input values.
Origin/CSRF checks and shared request limits run before operation validation;
route guards preserve anonymous and passkey authorization boundaries.

`GET /openapi.json` is available without database, SMTP or Google configuration.
The gateway serves the same compiled API at `/api/openapi.json`, with a server
base of `/api` and unchanged `/auth/...` operation paths. The document includes
cookie/CSRF schemes, provider capabilities, account access levels, payloads,
responses, proof restrictions and controlled errors. Document composition is
local to each application instance and does not inspect Express internals or
maintain a global mutable route registry. A documentation UI is not installed.

## Persistence and builds

`backend-shared` owns `authSchema` and the single migration history. Each owner
creates its own pool; imports never run migrations. Authentication and mutations
serialize on user/session/proof rows. Email and provider-subject claims also use
transaction advisory locks to prevent duplicate identities during concurrent
unification. Challenges and grants are scoped to a purpose, browser session and
security version. Six-digit codes expire in ten minutes, allow five attempts and
have a sixty-second resend cooldown, including replacement requests through the
email verification/change routes. Replacements retain the original attempt budget
and expiry; failed SMTP delivery permits immediate retry. Shared PostgreSQL limits supplement those
budgets. WebAuthn ceremonies expire after three minutes; sessions have an absolute
eight-hour limit. Revoked SID tombstones remain immutable and are not pruned.

The auth router uses `express-rate-limit` with an injected PostgreSQL store for
60 requests per exact address and 1,000 requests globally per minute. Addresses
are HMACed before reaching storage. Expiration resets counters during an atomic
upsert; no memory store, maintenance timer or database connection is created by
the middleware. Storage failures stop the request. Rate-limit diagnostics are
discarded because they can include client/database values; controlled failures
continue through the owning HTTP error boundary. The dependency is pinned to
`8.5.2`, whose request path has no environment-enabled debug output.

```sh
pnpm nx run backend-shared:db-generate -- --name describe-schema-change
DATABASE_URL=postgresql://localhost/visomi_stack_dev pnpm nx run backend-shared:db-migrate
pnpm nx run backend-shared:emails-build
pnpm nx run backend-shared:emails-check
```

Use an explicitly provisioned development database for migrations; tests never
use developer `DATABASE_URL`. `backend-shared` owns the SMTP adapter, authentication email content, MJML
templates, rendering and generation tooling. Auth selects typed message purposes
and translates delivery failures into controlled HTTP responses. MJML is a
development-only dependency. Its strict compiler embeds HTML in generated
TypeScript; runtime rendering escapes values and adds a plain-text alternative.
Templates contain no tracking pixels or remote fonts. Regenerate resources after
editing templates. The API build depends on the library's generation target.

Managed mode installs session and Passport middleware in the API. Inherited mode
installs the same runtime once on the real parent, before mounting the API, with
`authMode`, `helmetMode` and `errorMode` set to `inherited`. The runtime is exported
from compiled `app.js`. The gateway never imports API TypeScript or `main.js`.
Generated runtime manifests include external dependencies; retain complete output
directories and chunks when deploying the CommonJS API beside the ESM gateway.

## Verification and privacy

```sh
pnpm nx run-many -t lint typecheck typecheck-tests -p web-api web-gateway backend-shared dev-testing
pnpm nx run-many -t test -p web-api web-gateway backend-shared dev-testing
pnpm nx run-many -t build e2e -p web-api web-gateway
```

Integration uses isolated Compose PostgreSQL and loopback SMTP, real Argon2id,
real ES256 assertions and Google tokens signed with synthetic RSA keys. Only the
Google certificate retrieval boundary is replaced; token verification is real.
Container E2E uses a test-only loopback SMTP mailbox loaded by its preload; it is
absent from production startup. All identities, messages and credentials are
synthetic. These checks are not physical-authenticator or email-client certification.

The shared observability path remains the only operational telemetry. It excludes
bodies, email addresses, customer identifiers, credential material, codes, tokens,
SIDs, database values, raw errors and SMTP protocol traffic. The test mailbox is
stored separately from telemetry and must never receive production data.

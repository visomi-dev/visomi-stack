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

## Platform observability

The browser and server entrypoints merge their own platform configuration with
`app.config.ts`. `app.config.browser.ts` registers `BrowserErrors` as `ErrorHandler`,
Angular's global browser error listeners, the HTTP error interceptor and router
performance measurement. These services use explicit providers and are not created
during SSR. The browser entrypoint owns reporter initialization and shutdown.

`app.config.server.ts` registers `ServerErrors` as `ErrorHandler`. It emits only the
fixed `app.render_failed` event without inspecting or serializing exceptions, in
both development and production. Its HTTP pipeline retains the auth interceptor
without browser telemetry. Platform selection happens through DI configuration;
observability services contain no runtime platform checks. Existing capture and
privacy policies remain unchanged.

## Authentication composition

Services stay with their owning capability and use explicit lifetimes:

| Responsibility                   | Location                    | Scope                                        |
| -------------------------------- | --------------------------- | -------------------------------------------- |
| Route activity and heading focus | `shared/navigation.ts`      | Application; runs after browser rendering    |
| Theme                            | `ui/theme/theme.ts`         | Application                                  |
| Session                          | `auth/session/`             | Browser application or individual SSR render |
| Auth return navigation           | `auth/shared/navigation.ts` | Application                                  |
| Pending challenge journey        | `auth/shared/journey.ts`    | Access layout and its child pages            |
| Action progress and feedback     | `auth/shared/action.ts`     | Individual screen or control                 |
| Capability HTTP clients          | Their `auth/` capability    | Owning screen or control                     |

`Action` uses `@Service({ autoProvided: false })`; each consumer declares its own
provider and injects it. Nested controls, such as resend and backup-code actions,
own separate instances. Busy state, pending action names, errors and notices are
private writable signals exposed as read-only signals. The service owns state
changes, duplicate-action guards and completion/error handling; callers use its
methods instead of writing signals. `Journey` and auth notification state follow
the same read-only boundary. Native form models and presentation-only state stay
with their consuming views.

`Navigation` exposes a read-only `loading` signal derived from Angular Router's
current navigation. The root composes `PageLoader` as a thin, indeterminate bar at
the top of the viewport while guards, resolvers or lazy pages are pending. Router
completion, cancellation, errors and skipped navigations clear it automatically.
The service exposes a computed `headingFocus` request, derived from completed
page paths through `toSignal()`. Each page marks its owning `h1` with
`appNavigationHeading`; the directive binds focus attributes and applies the
necessary native focus call after rendering. Initial navigation and fragment-only
changes retain their existing focus. RxJS retains adjacent completed paths before
signal updates can be coalesced.
The loader announces page loading in the current language, respects reduced
motion and preserves identical initial SSR/hydration markup.

Effects and render hooks are named readonly properties, ordered after methods by
ESLint. Computed values derive state and bindings without side effects. Element
attributes belong to templates or directive host bindings, and view queries or
host references identify owned elements. Native focus, dialog methods, QR canvas
drawing and the fixed-URL Google SDK loader remain explicit browser integrations.
The theme uses Angular host bindings on `app-root`; CSS propagates the document
surface and color scheme. Backup-code downloads use a template-owned anchor and
revocable browser Blob URLs.

The root owns the router outlet and global infrastructure. `AuthLayout` supplies
the centered access composition; `AuthenticatedLayout` composes the existing
`AppShell`. Guards enforce the session access level independently of the chosen
visual layout. Backend authorization remains authoritative.

The `auth/` domain groups session, passkeys, password, email, Google, TOTP, recovery
and device approval capabilities. Views use Signal Forms and native controls with
the existing UI adapters. Auth components keep templates in adjacent `.html` files;
the Nx and Angular component generators default to external HTML and CSS. Shared
visual recipes stay in the UI library. Access and fallback pages share its Card
surface; forms, methods and return navigation use explicit vertical gaps. Inline
security confirmations retain their disclosure trigger and return focus to it on
cancellation. The current language is marked as text; the alternate language uses
a native link with a comfortable touch target. Form submissions use Signal Forms' `onInvalid`
and bound-control focus; feedback owns its alert focus after rendering. Browser SDK
and QR work use view queries and lifecycle cleanup. Page-scoped HTTP clients cancel
work when their view is destroyed. A scoped journey retains only pending challenge metadata between auth
pages; it is destroyed when leaving the access layout. Passwords and codes are
not stored in URLs, browser storage or transferred SSR state.

`Session` is the shared contract consumed by pages, guards and capability services.
The browser configuration provides `BrowserSession`; the server configuration
overrides it with `ServerSession`, both through `useExisting` aliases. Common
derived access signals stay on the contract without platform checks. This follows
[Angular's platform-specific provider pattern](https://angular.dev/best-practices/performance/ssr#providing-platform-specific-implementations).

`BrowserSession` shares reads, rejects responses older than a later session transition,
retains rotated CSRF tokens in memory and revalidates on focus. Cross-tab messages
contain only a fixed invalidation signal. Temporary failures lock private content
without asserting that the server has revoked the identity.

`ServerSession` reads only the current `REQUEST_CONTEXT`, with no HTTP or browser
dependencies. Its render state is isolated per injector, and browser mutations are
rejected. It transfers an allowlisted public snapshot; the browser consumes and
removes that initial state before obtaining a CSRF token through the API.

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
  proof before sensitive changes. Google reauthentication also accepts an email
  challenge, verifies it on the same page and returns to the requested task.
- `auth/recovery`, `auth/recovery/verify`, `auth/recovery/enroll`: recovery proof and
  restricted replacement enrollment. A replacement passkey must authenticate;
  a replacement password must prove its required second factor. Enrollment codes
  cannot use generic resend; restarting password preparation requests a new code
  without losing a valid restricted session and clears the previous password.
- `auth/device-approval`: browser-bound pairing request. `security/devices/review`
  lets a different full session approve or deny it with recent authentication.
  Approval grants enrollment, not application access. Pairing codes stay out of links.
  Changing the review request within the same route clears the pairing field and
  cancels the previous request; obsolete results cannot update the next review.
  Cancelling or restarting a requesting device also aborts its pending status
  query, so a late result cannot block polling the replacement request.
- `home`, `account`, `security` and its capability pages: minimal private home,
  verified email, passkeys, password, Google linking, authenticator, backup codes
  and session revocation.

Pending challenge metadata remains in memory. Reloading a password factor, Google
verification, reset or recovery proof requires restarting that step. A valid
unverified or restricted server session is still restored and directed to its
permitted task. Switching language uses a stable route and does not carry proofs.

Password management keeps a submitted password only in its owning component while
an in-place identity check is pending. Successful proof completes that requested
save automatically. Cancellation, departure, a changed account or session
invalidation clears the draft; it never enters URLs or browser storage. Other
security pages continue using the routed reauthentication flow and review step.

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
virtual passkeys, TOTP and backup codes, recovery and two-browser approval. The
CI browser job runs both foundations and the `auth` configuration whenever
`web-app-e2e` is affected, installing Chromium, Firefox and WebKit. The auth step
fails if a test needs a retry, so an intermittent failure cannot produce a green check. The
presentation cases exercise both themes at 320, 390 and 1280 CSS pixels, including
Spanish password controls, code/resend spacing, security actions and confirmations
above the mobile navigation. They do
not establish screen-reader conformance or replace manual checks of real password
managers, mobile keyboards, physical authenticators and Google provider behavior.
See [Web foundations](../../../docs/web-foundations.md) for the shared UI contract.

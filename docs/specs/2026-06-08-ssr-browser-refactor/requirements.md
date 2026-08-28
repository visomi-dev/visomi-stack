# Spec: SSR & Browser Refactor

Date: 2026-06-08
Branch: `feat/OC/ssr-browser-refactor`
Status: Approved for implementation

## Scope

### Includes

- Replace runtime `isPlatformBrowser` / `isPlatformServer` / `PLATFORM_ID` checks across `apps/web/app/src/app/` with **platform-specific provider implementations** following the Angular SSR guide.
- Refactor three domain services into abstract contracts plus `Browser*` / `Server*` implementations:
  - `Auth` → `BrowserAuth` + `ServerAuth`
  - `Realtime` → `BrowserRealtime` + `ServerRealtime`
  - `Settings` → `BrowserSettings` + `ServerSettings`
- Type `REQUEST_CONTEXT` with a shared `AuthRequestContext` token so `server.ts` no longer performs local casts and `Auth` does not declare ad-hoc request types.
- Replace `Activation` page direct `navigator.clipboard` access with a `Clipboard` service that exposes availability through `afterNextRender`.
- Add explicit `withHttpTransferCacheOptions` to `provideClientHydration` excluding endpoints that carry cookies.
- Avoid a `GET /api/auth/session` HTTP call on hydrate when the browser knows there is no session, using a non-sensitive `themis.hasSession` cookie marker rather than `TransferState`.
- Keep auth routes on `RenderMode.Server`; defer prerender for those pages until a strategy is defined for the authenticated-user redirect path.
- Bump `apps/web/app/version.json` (the file is created as part of this spec).

### Excludes

- New product UX, copy, or visual changes.
- Refactoring components that do not touch browser globals (e.g. `Layout`, `SidebarMenu`, `Topbar`).
- Splitting `httpInterceptor` into multiple interceptors (single functional interceptor is preserved; the cast is removed).
- Changing `outputMode` in `project.json` or build infrastructure.
- Adding new dependencies.
- Prerender of auth pages (`sign-in`, `sign-up`, `forgotten-password`, `verify-email`, `verify-device`). Documented as a follow-up in this spec.

## Decisions

### Service abstraction per domain, not a generic `Browser` service

The Angular SSR guide points to **one abstract service per domain** with a `Browser*` and `Server*` implementation. The refactor follows that exact pattern. A generic `Browser` capability service is explicitly rejected.

### File layout

- Abstract service: `<domain>/<domain>.ts` exports the `abstract class`.
- Browser impl: `<domain>/browser-<domain>.ts`.
- Server impl: `<domain>/server-<domain>.ts`.
- Each impl has a sibling `<domain>.spec.ts` covering its behaviour.
- `AuthRequestContext` token lives in `shared/auth/auth-request-context.token.ts` (single source of truth for `REQUEST_CONTEXT` typing).

### Provider registration

- `app.config.ts` registers the `Browser*` implementations with `{ provide: Auth, useClass: BrowserAuth }`, etc.
- `app.config.server.ts` overrides with `{ provide: Auth, useClass: ServerAuth }`, etc.
- `AuthRequestContext` is provided in `app.config.server.ts` via `useFactory` reading the existing `REQUEST_CONTEXT` (which the engine still injects) and normalising its shape.

### Avoiding `/api/auth/session` on hydrate (no `TransferState`)

A non-sensitive cookie marker is set by the API on successful sign-in / sign-up verification and cleared on sign-out:

| Cookie              | Value | HttpOnly | Secure (prod) | SameSite | Path |
| ------------------- | ----- | -------- | ------------- | -------- | ---- |
| `themis.hasSession` | `1`   | `false`  | `true`        | `Lax`    | `/`  |

The cookie carries no user, account, role, or token data. It is purely a "session _may_ exist" hint that the browser can read.

Behaviour:

- `BrowserAuth.ensureSessionLoaded()` returns `null` and marks `sessionLoaded` without an HTTP call when `themis.hasSession` is absent.
- `ServerAuth.ensureSessionLoaded()` returns the user from `AuthRequestContext` (no HTTP) when present, or `null` (no HTTP) when no `connect.sid` cookie is present in the SSR `REQUEST`.
- If the marker is stale (cookie says yes, session is gone), `/api/auth/session` resolves `null` and `BrowserAuth` clears the marker.
- A follow-up ADR documents the API contract change for `themis.hasSession`. (Out of scope for this spec to implement; tracked in validation.md.)

### HTTP transfer cache

- `provideClientHydration(withHttpTransferCacheOptions({ filter: (req) => !req.url.includes('/api/auth/') }))` is added to `app.config.ts`.
- The filter is exclusionary and explicit. Defaults remain: `includePostRequests: false`, `includeRequestsWithAuthHeaders: false`.

### Render modes

- `app.routes.server.ts` keeps the current `RenderMode.Server` catch-all.
- The earlier plan to prerender `/sign-in`, `/sign-up`, `/forgotten-password` is **deferred**. The reason: with the cookie marker, server-side auth-state cannot be resolved at build-time, and an authenticated user opening a prerendered auth page would render the unauthenticated HTML before client-side hydration redirects them. We accept SSR for these routes for now.
- `verify-email` and `verify-device` stay on SSR because they need request-time challenge state.

### DOM side effects in `Settings`

- The mutation of `document.documentElement.classList` is moved out of `Settings`'s own signal updates and exposed as `Settings.applyTheme()`.
- `BrowserSettings.applyTheme()` is the single browser-side implementation: it toggles the `dark` class on `document.documentElement` based on the current `isDark()` signal. It reads the signal so callers do not need to pass the theme.
- `ServerSettings.applyTheme()` is a no-op because the server never paints a DOM tree.
- `Layout` injects `Settings` and keeps `readonly applyThemeEffect = effect(() => settings.applyTheme())` as a `readonly` class field. The effect tracks `isDark()` through `applyTheme()` and re-runs on every theme change; on the server the call is a no-op.
- No dedicated renderless controller component is introduced. `ThemeInit` is not part of the architecture.

## Context

- Stack: Angular 22 (zoneless), PrimeNG 21, Nx 22, Express 5 gateway.
- Conventions enforced by `AGENTS.md`:
  - Standalone components, `inject()`, signals, no `Component` / `Service` suffixes.
  - Effects declared as `readonly` class properties (never inside the constructor).
  - Type-only imports where appropriate.
  - File names `kebab-case`, classes `PascalCase`.
  - No barrel re-exports.
  - `effect` in service classes is fine; `afterNextRender` is preferred for one-shot DOM work.
- Server wiring: `apps/web/server/src/gateway.ts` mounts `angularHandler` at `/app`. `apps/web/app/src/server.ts` exports `reqHandler` for the gateway to load. The `angularApp.handle(req, context)` second parameter carries the auth user; today it is `{ user: AuthUser | undefined }` and the type is duplicated in `Auth`.
- Test runner: Jest (Vitest-style globals via `vi` from `jest-preset-angular`'s vitest bridge in this repo). Specs sit next to the file under test.
- Spec directory: `docs/specs/2026-06-08-ssr-browser-refactor/`.

## Follow-ups (out of scope for this spec)

- API: set / clear `themis.hasSession` cookie on sign-in, sign-up verification, and sign-out. (Tracked in `validation.md` as a coordination item.)
- ADR for the cookie marker contract.
- Prerender of anonymous auth pages, gated on the API cookie work landing first.

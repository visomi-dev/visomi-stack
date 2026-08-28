# Implementation Plan

## Group 1 — Auth domain (abstract + browser + server)

1. Create `shared/auth/auth.ts` as `export abstract class Auth` with all current public surface (signals + methods).
2. Create `shared/auth/browser-auth.ts` with `@Injectable() class BrowserAuth implements Auth`. Uses `sessionStorage` for the pending challenge, reads `themis.hasSession` cookie, calls `/api/auth/session` only when the cookie is present.
3. Create `shared/auth/server-auth.ts` with `@Injectable() class ServerAuth implements Auth`. Reads `connect.sid` from `REQUEST` and `AuthRequestContext` for a pre-resolved user; never writes to `sessionStorage`; calls `/api/auth/session` only as a fallback.
4. Create `shared/auth/auth-request-context.token.ts` exporting `AUTH_REQUEST_CONTEXT` typed `{ user: AuthUser | null } | null`.
5. Update `shared/auth/auth.spec.ts` to cover:
   - `BrowserAuth` skips `/api/auth/session` without `themis.hasSession`.
   - `BrowserAuth` calls `/api/auth/session` with `themis.hasSession=1`.
   - `ServerAuth` skips `/api/auth/session` without `connect.sid`.
   - `ServerAuth` uses the user from `AuthRequestContext` without HTTP.
   - `ServerAuth` falls back to HTTP when cookie is present but context is null.

## Group 2 — Realtime domain (abstract + browser + server)

1. Create `shared/realtime/realtime.ts` as `export abstract class Realtime` with `connected`, `lastEvent`, `authEffect`, and lifecycle hooks (`connect`, `disconnect`) made internal to subclasses.
2. Create `shared/realtime/browser-realtime.ts` with `io()` connection setup.
3. Create `shared/realtime/server-realtime.ts` as a no-op: `connect()` and `disconnect()` are empty; the auth effect is a no-op.
4. Update `shared/realtime/realtime.spec.ts` to use the new abstract + browser implementation under test, and add a server-side test confirming no `io()` is invoked.

## Group 3 — Settings / theme domain (abstract + browser + server)

1. Create `shared/settings.ts` as `export abstract class Settings` with `theme`, `isDark`, `setTheme`, `toggleTheme`, and `applyTheme`.
2. Create `shared/browser-settings.ts` with `localStorage` / `matchMedia` logic and an `applyTheme()` that toggles the `dark` class on `document.documentElement`.
3. Create `shared/server-settings.ts` as a no-op with a stable default of `'light'` and an `applyTheme()` that does nothing on the server.
4. Have `Layout` inject `Settings` and declare `readonly applyThemeEffect = effect(() => settings.applyTheme())`. The effect tracks `isDark()` through `applyTheme()` and re-runs on every theme change; the server call is a no-op.
5. Mount `<app-layout />` in `app.html` (no `<app-theme-init />`).
6. Update `shared/settings.spec.ts` to inject the abstract + browser impl and assert behaviour; add a server-side test asserting no DOM access; add coverage for `applyTheme()` on both impls.

## Group 4 — Clipboard capability for the activation page

1. Create `shared/clipboard/clipboard.ts` as `export abstract class Clipboard` with `readonly available: Signal<boolean>` and `writeText(value: string): Promise<boolean>`.
2. Create `shared/clipboard/browser-clipboard.ts` using `afterNextRender` to resolve `navigator.clipboard` availability.
3. Create `shared/clipboard/server-clipboard.ts` with `available = signal(false)` and a `writeText` that resolves `false`.
4. Update `activation/activation.ts` to inject `Clipboard`; remove `PLATFORM_ID` and direct `navigator.clipboard` usage.
5. Update `activation/activation.spec.ts` to provide a mock `Clipboard`.

## Group 5 — App configuration & routes

1. `app.config.ts`:
   - Register `BrowserAuth`, `BrowserRealtime`, `BrowserSettings`, `BrowserClipboard` with `useClass`.
   - Add `withHttpTransferCacheOptions({ filter: (req) => !req.url.includes('/api/auth/') })` to `provideClientHydration`.
   - Drop the `withI18nSupport()` and `withEventReplay()` arguments if unused; keep them if needed.
2. `app.config.server.ts`:
   - Override the four services with `ServerAuth`, `ServerRealtime`, `ServerSettings`, `ServerClipboard`.
   - Provide `AUTH_REQUEST_CONTEXT` with a `useFactory` that reads the existing `REQUEST_CONTEXT` and extracts `user` (typed as `AuthUser | null`).
3. `app.routes.server.ts`: leave as-is for this iteration. Add a `// TODO(spec: 2026-06-08-ssr-browser-refactor)` comment noting deferred prerender.
4. `app.ts`: keep `Layout` as the only mounted shell component. Update providers list (no concrete class — the abstract is bound through the providers above).

## Group 6 — Server wiring

1. `apps/web/app/src/server.ts`:
   - Import `AuthRequestContext` shape.
   - Pass `{ user: (request.user as AuthUser | null) ?? null }` to `angularApp.handle()`.
   - The local `AuthenticatedRequest` interface is removed; rely on the augmented `Request` type from the gateway (or cast once at the boundary).
2. `apps/web/app/src/main.server.ts` and `main.ts`: no changes.

## Group 7 — Tests & verification

1. Run `pnpm nx run app:lint`.
2. Run `pnpm nx run app:test`.
3. Run `pnpm nx run app:build --configuration=production`.
4. Run `pnpm nx run-many -t lint -t test -p app`.
5. Inspect the build output: `dist/apps/web/app/server/server.mjs` exists; no `TransferState` keys leaked into HTML.
6. Manual smoke (gated on API cookie work landing): sign-in, refresh dashboard, observe no `/api/auth/session` request in the Network panel when no session is present.

## Group 8 — Versioning & roadmap

1. Create `apps/web/app/version.json` with `{ "version": "1.1.0" }`.
2. Update `docs/constitution/roadmap.md` to mark `### Phase 1: Task Definition Core` and add a new section "SSR Compatibility Hardening" linking to this spec.

## Group 9 — Cleanup

1. Remove `isPlatformBrowser` / `isPlatformServer` / `PLATFORM_ID` references from `apps/web/app/src/app/` (except the `httpInterceptor` which keeps `PLATFORM_ID` if needed for the server-only path; if a token covers it, remove there too).
2. Remove direct `window.*`, `navigator.*`, `document.*` references from `Auth`, `Realtime`, `Settings`, `Activation`, and any service constructors/effects.
3. Delete obsolete files (`server-auth` server impl replaces old `Auth`, but old file is moved, not duplicated).

## Order of execution

Groups are independent enough to be done in order, with each group leaving the build green. Group 1 is the keystone because guards and layout depend on `Auth` being injectable.

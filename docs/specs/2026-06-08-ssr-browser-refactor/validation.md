# Validation

## Automated

- `pnpm nx run app:lint` exits with status `0` and emits no new warnings.
- `pnpm nx run app:test` exits with status `0`.
- `pnpm nx run app:build --configuration=production` exits with status `0`.
- `pnpm nx run-many -t lint -t test -p app` exits with status `0`.
- Grep invariants (run from repo root):
  - `rg "isPlatformBrowser|PLATFORM_ID" apps/web/app/src/app` returns **0** matches.
  - `rg "isPlatformServer" apps/web/app/src/app` returns matches only inside `http-interceptor.ts` and its spec (the interceptor legitimately needs to distinguish server-side URL rewriting from browser-side pass-through).
  - `rg "window\.|navigator\.|document\." apps/web/app/src/app` returns matches only inside `browser-*.ts` (no `theme-init` file exists; theme application lives in `BrowserSettings.applyTheme()` and is invoked by `Layout`).
- `apps/web/app/src/server.ts` no longer contains `as unknown as`.
- `apps/web/app/src/app/shared/http-interceptor.ts` no longer contains `as unknown as`.

## Manual

- Hydration smoke (requires the API cookie work to be in place; tracked below):
  - Cold load `/app/sign-in` while signed out → no `GET /api/auth/session` in the Network panel.
  - Sign in, refresh `/app/dashboard` → `GET /api/auth/session` fires only on the first navigation; subsequent in-app navigations skip it.
  - Sign out, refresh → no `GET /api/auth/session`; `themis.hasSession` cookie is absent in DevTools.
- Theme smoke:
  - Toggle theme in the topbar → `dark` class is added to `<html>` post-hydration, no flash, no hydration warning in the console.
  - Refresh → the persisted theme is applied after hydration; initial HTML is the `light` default.
- Realtime smoke:
  - With a signed-in user, the browser console shows a single socket connect; no errors.
  - Sign out → the socket disconnects.
- Clipboard smoke:
  - On `/app/activation`, "Copy API key" writes to the clipboard in the browser.
  - SSR / prerender does not attempt to access `navigator.clipboard` (verifiable by inspecting the server log).

## Definition of Done

- 0 occurrences of `isPlatformBrowser` or `PLATFORM_ID` inside `apps/web/app/src/app/`.
- `isPlatformServer` is allowed only in `http-interceptor.ts` (and its spec) where the interceptor legitimately needs to distinguish the server-side URL rewrite path.
- 0 direct `window.*`, `navigator.*`, `document.*` reads outside of:
  - `browser-*.ts` files (the `BrowserSettings.applyTheme()` toggle lives here).
- 0 `as unknown as` casts in `apps/web/app/src/server.ts` and `shared/http-interceptor.ts`.
- `provideClientHydration` is called with `withHttpTransferCacheOptions` and an explicit filter excluding `/api/auth/`.
- `AUTH_REQUEST_CONTEXT` token exists, is registered in `app.config.server.ts`, and is consumed by `ServerAuth`.
- `Layout` is mounted in `app.html`, injects `Settings`, and keeps `readonly applyThemeEffect = effect(() => settings.applyTheme())` so the `dark` class stays in sync with the theme.
- `apps/web/app/version.json` exists with `version: 1.1.0`.
- `docs/constitution/roadmap.md` links to this spec.
- All tests pass; build succeeds.

## Coordination items (not blocking this spec)

- API must set `themis.hasSession=1; Path=/; SameSite=Lax; Secure` on successful sign-in and sign-up verification.
- API must clear `themis.hasSession` on sign-out and session expiry.
- These are required for the manual smoke steps to pass end-to-end. They live in `apps/web/api` and are tracked in a follow-up.

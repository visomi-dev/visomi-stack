# Post-Refactor UI Review — Implementation Plan

The work is split into four PRs. Each PR is independently reviewable and verifiable. The capture scripts + recordings (PR4) can land last so the visual evidence matches the source state.

## PR1 — Auth heading utility alignment

Replace `font-display` with `font-heading` across the auth surface, the brand wordmark, and the recipes doc. This is the smallest possible PR that fixes the most visible contract drift.

### Tasks

1. Edit `apps/web/app/src/app/auth/sign-in/sign-in.html`: replace `font-display` with `font-heading` on the `<h1>` (line 13).
2. Same edit in:
   - `apps/web/app/src/app/auth/sign-up/sign-up.html` (line 13)
   - `apps/web/app/src/app/auth/verify-email/verify-email.html` (line 13)
   - `apps/web/app/src/app/auth/verify-device/verify-device.html` (line 13)
   - `apps/web/app/src/app/auth/forgotten-password/forgotten-password.html` (lines 7 and 35)
   - `apps/web/app/src/app/auth/reset-password/reset-password.html` (lines 6 and 31)
3. Edit `apps/web/app/src/app/shared/layout/logo/logo.html`: replace `font-display` with `font-heading` on the wordmark (line 32).
4. Edit `docs/design-system/recipes.md`: update the three `font-display` references in the auth-shell recipe (lines 20, 26, 43) to `font-heading`.
5. Run `rg "font-display" apps/web app docs/design-system` to confirm zero matches.
6. Run `pnpm nx run app:lint`, `pnpm nx run app:typecheck`, `pnpm nx run app:vite:test`.

### Acceptance

- `rg "font-display" apps/web app docs/design-system` returns zero matches.
- `pnpm nx run app:lint`, `pnpm nx run app:typecheck`, `pnpm nx run app:vite:test` all pass.
- The existing auth e2e specs (`apps/web/app-e2e/src/auth/*`) stay green.

## PR2 — `app-auth-layout` shell tightening

Drop the duplicate background utilities in the sticky header, replace the magic `min-h-[calc(100vh-64px)]` with `min-h-dvh`, and add the missing `data-od-id="brand"` hook.

### Tasks

1. Edit `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.html`:
   - Drop `sm:bg-white` from the sticky header class list (collapse `bg-white sm:bg-white` to `bg-white`).
   - Collapse `dark:bg-zinc-950 dark:bg-zinc-950/85` to `dark:bg-zinc-950/85` (keep the translucent backdrop; drop the opaque duplicate).
   - Replace `relative border-b ... sm:relative sm:sticky sm:top-0 sm:z-20 ...` with `sticky top-0 z-20 border-b ...` so the sticky behavior is on at every breakpoint (currently the layout is only sticky at `sm+`, leaving the chrome to scroll away on mobile which is jarring).
   - Add `data-od-id="brand"` to the brand link.
   - Replace `font-display` with `font-heading` on the brand link.
   - Replace `min-h-[calc(100vh-64px)]` with `min-h-dvh` on `<main>`.
2. Run `rg "sm:bg-white|dark:bg-zinc-950 dark:bg-zinc-950|min-h-\[calc\(100vh-64px\)\]" apps/web/app/src/app/shared/ui/layout` to confirm zero matches.
3. Run `pnpm nx run app:lint`, `pnpm nx run app:typecheck`, `pnpm nx run app:vite:test`.
4. Run the existing site-e2e and app-e2e suites that touch the auth routes (or, if the gateway is not available, run unit tests only and note the manual visual check in the PR description).

### Acceptance

- Static guards pass (zero matches).
- Unit tests pass.
- Manual visual check at 375px and 1280px confirms the auth card still centers vertically and the sticky header remains visible after scroll.

## PR3 — Auth card mobile padding + submit hook

Tighten the `app-auth-card` mobile padding so the smallest viewports (360px) keep a safe gutter, and add a stable `data-od-id="submit"` hook to each auth route's primary button.

### Tasks

1. Edit `apps/web/app/src/app/shared/ui/layout/auth-card/auth-card.ts`: change the padding scale from `px-5 py-6 sm:px-8 sm:py-8 md:px-10 md:py-10` to `px-6 py-6 sm:px-8 sm:py-8 md:px-10 md:py-10`. The `px-5` floor becomes `px-6` to match the design-system mobile-first baseline.
2. Edit `apps/web/app/src/app/auth/sign-in/sign-in.html`: add `data-od-id="submit"` to the submit `<app-button>` (alongside the existing `data-slot="submit"`).
3. Same edit in:
   - `apps/web/app/src/app/auth/sign-up/sign-up.html` (line 80)
   - `apps/web/app/src/app/auth/forgotten-password/forgotten-password.html` (line 73)
   - `apps/web/app/src/app/auth/reset-password/reset-password.html` (two buttons: Verify code on line 76 and Update password on line 120)
4. Run the lint + typecheck + test targets again.
5. Run the existing auth e2e specs.

### Acceptance

- Static guard: `rg "data-od-id=\"submit\"" apps/web/app/src/app/auth` returns the expected count (sign-in: 1, sign-up: 1, verify-email: 0, verify-device: 0, forgotten-password: 1, reset-password: 2).
- Unit tests + auth e2e specs pass.

## PR4 — Capture scripts + recordings

Add the structured snapshot script, update the auth-flow README, and regenerate the auth flow recordings. This PR depends on PR1 + PR2 + PR3 being merged.

### Tasks

1. Author `scripts/capture-ui-snapshots.cjs`:
   - Site routes: `/en/`, `/es/`, `/docs/` at viewports `375`, `768`, `1280`, light + dark. Output to `media/ui-snapshots/site-<route>-<width>-<theme>.png`.
   - Auth routes: `/app/en/sign-in`, `/app/en/sign-up`, `/app/en/forgotten-password`, `/app/en/verify-email`, `/app/en/verify-device`, `/app/en/reset-password`. Reuse the viewport matrix from `scripts/snapshot-auth-phase10.cjs` (360/390/520/768/1280). Output to `media/ui-snapshots/auth-<route>-<width>-<theme>.png`.
   - The script detects whether the gateway at `${BASE_URL:-http://localhost:8082}` (or `http://localhost:8081` for auth) is reachable. If unreachable, it logs a clear message and skips that half; it does not crash the other half.
   - The script uses `waitUntil: 'domcontentloaded'` plus a 400ms settle timeout so SSR-rendered HTML is captured correctly.
2. Author `media/ui-snapshots/README.md` describing the directory layout and the script.
3. Update `media/auth-flow-videos/README.md` to mention the new snapshot script as the companion artifact.
4. Regenerate `media/auth-flow-videos/auth-flow-iphone-13-mini.webm` and `media/auth-flow-videos/auth-flow-hd-1920x1080.webm` via `node scripts/capture-auth-flow.cjs` once the gateway is up.
5. Bump `apps/web/app/version.json` from `1.2.0` to `1.5.0`.
6. Edit `docs/constitution/roadmap.md`: add a "## Post-Refactor UI Review" entry pointing at `docs/specs/2026-06-27-post-refactor-ui-review/`.

### Acceptance

- `scripts/capture-ui-snapshots.cjs` runs without uncaught errors and produces the expected files in `media/ui-snapshots/`.
- `media/ui-snapshots/README.md` documents the artifact.
- `media/auth-flow-videos/auth-flow-iphone-13-mini.webm` and `media/auth-flow-videos/auth-flow-hd-1920x1080.webm` are present and playable.
- `apps/web/app/version.json` is `1.5.0`.
- `docs/constitution/roadmap.md` lists the new phase.

## Cross-PR Verification

After all four PRs land:

```bash
pnpm nx run-many -t lint,typecheck --projects=app,site,ui-designer
pnpm nx run app:vite:test
pnpm nx run app:build --skip-nx-cache
pnpm nx run site:build --skip-nx-cache
pnpm nx run ui-designer:build --skip-nx-cache

# Visual evidence
pnpm nx serve site &
sleep 3
node scripts/capture-ui-snapshots.cjs

# Gateway boot (skip if Redis is not reachable in this environment)
pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production
node dist/apps/web/server/main.js &
sleep 6
node scripts/capture-ui-snapshots.cjs   # auth half
node scripts/capture-auth-flow.cjs      # recordings
```

Manual review: walk the audit checklist in `sdd.md`, tick each row when the corresponding screenshot matches the expected post-fix state. Record any remaining issues as P3 follow-ups for the next spec.

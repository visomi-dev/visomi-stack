# Post-Refactor UI Review — Software Design Document

## Decision

Run a **design polish + mobile-first UX/UI review** pass on top of the recent utility-first and Catalyst refactor (`2026-06-22-catalyst-angular-ui-foundation/`, `2026-06-23-catalyst-pure-tokens-alignment/`, `2026-06-26-site-utility-first-migration/`, `2026-06-26-ui-designer-app/`). The review follows the [`web-design-reviewer`](../../../.opencode/skills/web-design-reviewer/SKILL.md) workflow: capture a baseline of screenshots and an auth flow recording, audit visual issues at the source, apply focused fixes, re-capture, and ship the recordings as evidence.

The scope is intentionally narrow:

1. Replace the non-canonical `font-display` utility across the auth routes with the canonical `font-heading` utility declared in `styles.base.css` and documented in `tokens.md` / `recipes.md`.
2. Remove duplicate background utilities in the `app-auth-layout` sticky header and tighten the `min-h-[calc(100vh-64px)]` so the auth card clears the header at every viewport.
3. Tighten the `app-auth-card` mobile padding so the smallest viewports (360px) keep a safe 16px outer gutter.
4. Add a `data-od-id` hook to the brand link and to each auth route's submit button so visual e2e suites can target the chrome without depending on `getByRole`.
5. Add `scripts/capture-ui-snapshots.cjs` to capture a structured before/after snapshot grid for the site (`/en/`, `/es/`, `/docs/`) and the auth routes at the Phase 10 viewport matrix (360/390/520/768/1280) x light/dark.
6. Regenerate the existing `media/auth-flow-videos/auth-flow-{iphone-13-mini,hd-1920x1080}.webm` recordings through the unchanged `scripts/capture-auth-flow.cjs` flow.

No new tokens, no new primitives, no redesign of routes or sections. The fix is structural alignment with the already-shipped token foundation.

## Why now

The previous refactor series standardized the token layer and the visual primitives but left a few surfaces inconsistent with the documented contract:

| Surface                                 | Current state                                                                     | Documented contract (tokens.md / recipes.md)               |
| --------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 10 `font-display` usages (auth + brand) | `font-display` (non-canonical alias, no Tailwind utility)                         | `font-heading` (canonical, wired through `--font-heading`) |
| `app-auth-layout` sticky header         | `bg-white sm:bg-white`, `dark:bg-zinc-950 dark:bg-zinc-950/85` (duplicates)       | one background per mode, gradient-free                     |
| `app-auth-layout` main height           | `min-h-[calc(100vh-64px)]` (assumes fixed 64px header)                            | responsive header height via flex layout                   |
| `app-auth-card` mobile padding          | `px-5 py-6` on 360px viewports (15px gutters inside the 16px page gutter)         | at least `p-4` page gutter, `px-6 py-6` card minimum       |
| `data-od-id` chrome hooks               | only on `auth-shell`, `auth-card`, `pending-email`; missing on brand + submit btn | brand, lang, theme, submit, footer                         |
| Auth flow + UI snapshots                | manual, ad-hoc, no shared script for site                                         | shared `scripts/capture-*.cjs` artifact                    |

The site and the ui-designer prototype already follow the canonical contract. The Angular app's auth surface drifted because the migration series updated tokens and primitives first and left the route templates untouched. This spec closes the drift with the smallest correct change set.

## Goals

1. Every text style that the design system documents as a heading utility uses the canonical name (`font-heading`). `font-display` no longer appears in `apps/web/app/src/**` or `apps/web/ui-designer/src/**`.
2. The `app-auth-layout` sticky header has exactly one background utility per mode (no duplicates, no gradient).
3. The `app-auth-layout` main area clears the responsive header height at every viewport without a magic constant.
4. The `app-auth-card` keeps a 16px outer gutter at the 360px viewport (matches the design system mobile-first baseline).
5. Every auth route exposes a stable `data-od-id` hook on the submit button and the brand link, in addition to the existing `auth-shell` and `auth-card` hooks.
6. `scripts/capture-ui-snapshots.cjs` exists and produces a structured snapshot grid for the site and the auth routes (one image per route x viewport x theme).
7. `media/auth-flow-videos/auth-flow-iphone-13-mini.webm` and `media/auth-flow-videos/auth-flow-hd-1920x1080.webm` are regenerated and load correctly.

## Non-Goals

1. No redesign of any auth route copy, layout, or section order.
2. No new design tokens, no new primitives, no new shared/ui components.
3. No changes to the backend, the API, or the worker.
4. No introduction of new e2e specs. The site smoke spec and the existing auth route specs stay unchanged.
5. No introduction of automated visual regression tests. The snapshot grid is a manual artifact, committed under `media/ui-snapshots/`, not asserted in CI.
6. No migration of the `DESIGN.md` manuscript. The brand-level manuscript is documented as out of scope in `2026-06-26-site-utility-first-migration/sdd.md`.
7. No new dependency. Playwright is already a workspace dev dependency.

## Audit Findings (Baseline)

The audit walked the same six surfaces the screenshot script will capture. Findings are grouped by severity. Only the `P1` and `P2` items are in scope for this spec; `P3` items are documented as follow-up.

### P1 — Visual contract drift

| ID   | Surface                                                                  | Issue                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 | `apps/web/app/src/app/auth/sign-in/sign-in.html:13`                      | `font-display` on the page `<h1>`. The canonical heading utility is `font-heading` per `tokens.md` and `recipes.md`.                                                                                                                                       |
| P1-2 | `apps/web/app/src/app/auth/sign-up/sign-up.html:13`                      | Same as P1-1.                                                                                                                                                                                                                                              |
| P1-3 | `apps/web/app/src/app/auth/verify-email/verify-email.html:13`            | Same as P1-1.                                                                                                                                                                                                                                              |
| P1-4 | `apps/web/app/src/app/auth/verify-device/verify-device.html:13`          | Same as P1-1.                                                                                                                                                                                                                                              |
| P1-5 | `apps/web/app/src/app/auth/forgotten-password/forgotten-password.html:7` | Same as P1-1, plus `:35` (the success state also has its own `<h1>`).                                                                                                                                                                                      |
| P1-6 | `apps/web/app/src/app/auth/reset-password/reset-password.html:6,31`      | Same as P1-1 (two `<h1>` instances for the success state and the form state).                                                                                                                                                                              |
| P1-7 | `apps/web/app/src/app/shared/layout/logo/logo.html:32`                   | `font-display` on the wordmark. Brand uses the same heading family everywhere else.                                                                                                                                                                        |
| P1-8 | `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.html:3`   | Sticky header carries `bg-white sm:bg-white` and `dark:bg-zinc-950 dark:bg-zinc-950/85`. Duplicate utilities resolve to the same value and inflate the generated class list; the `bg-white` (without opacity) is the intentional choice for the chrome.    |
| P1-9 | `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.html:23`  | `min-h-[calc(100vh-64px)]` hard-codes a 64px header height. On mobile (375px) the header collapses to `py-2.5` (about 52px), so the main area leaves a visible gap; on desktop with the language menu open it can grow taller than 64px and clip the card. |

### P2 — Mobile polish

| ID   | Surface                                                                      | Issue                                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 | `apps/web/app/src/app/shared/ui/layout/auth-card/auth-card.ts:21-22`         | On a 360px viewport the page gutter is `px-4` (16px) and the card starts at `px-5 py-6` (20px). Tight on small phones; tighten to `px-6` floor on the smallest viewports.                   |
| P2-2 | `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.html:6`       | The brand link has `routerLink="/"` but the `app-logo` mark-name already carries the brand mark. The `routerLink` is harmless but the `data-od-id="brand"` hook is missing.                 |
| P2-3 | `apps/web/app/src/app/auth/sign-in/sign-in.html:78-80`                       | `app-button` submit is the only primary CTA without a `data-od-id` hook. Visual e2e snapshots cannot target it from the chrome.                                                             |
| P2-4 | `apps/web/app/src/app/auth/sign-up/sign-up.html:80-82`                       | Same as P2-3.                                                                                                                                                                               |
| P2-5 | `apps/web/app/src/app/auth/forgotten-password/forgotten-password.html:73-80` | Same as P2-3.                                                                                                                                                                               |
| P2-6 | `apps/web/app/src/app/auth/reset-password/reset-password.html:76-83,120-127` | Same as P2-3 (two submit buttons: Verify code + Update password).                                                                                                                           |
| P2-7 | `docs/design-system/recipes.md:20,26,43`                                     | The auth-shell recipe in `recipes.md` uses `font-display`. Update to `font-heading` so the example matches the Angular app after the fix.                                                   |
| P2-8 | `apps/web/site/src/components/landing-page.astro:145`                        | Sticky `<nav>` uses `transition-colors duration-200` but the theme switcher script toggles `<html class="dark">` synchronously; no animation issue, just a consistency note for the review. |

### P3 — Follow-ups (not in scope)

| ID   | Surface                                                                | Note                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-1 | `apps/web/site/src/components/landing-page.astro:202-211`              | The "4 Agents Active" pill uses a hard-coded count and would benefit from a data slot for copy variant testing. Future work.                                                       |
| P3-2 | `apps/web/app/src/app/shared/layout/sidebar-menu/sidebar-menu.html:34` | The sidebar wordmark uses `focus:outline-primary`; `outline-primary` is not a Tailwind utility. Replace with `focus-visible:outline-blue-600 dark:focus-visible:outline-blue-500`. |
| P3-3 | `apps/web/site/src/pages/docs/index.astro`                             | The docs index still references the old `bg-slate-*` page surface in its hero card per `migrate-design-system.cjs`. Re-verify after a build.                                       |

## Implementation Strategy

### Slice 1 — Auth heading utility alignment

Touch every `font-display` in the Angular app and the recipes doc; replace with `font-heading`. Single PR. Reviewable in isolation.

**Files:**

- `apps/web/app/src/app/auth/sign-in/sign-in.html` (1)
- `apps/web/app/src/app/auth/sign-up/sign-up.html` (1)
- `apps/web/app/src/app/auth/verify-email/verify-email.html` (1)
- `apps/web/app/src/app/auth/verify-device/verify-device.html` (1)
- `apps/web/app/src/app/auth/forgotten-password/forgotten-password.html` (2)
- `apps/web/app/src/app/auth/reset-password/reset-password.html` (2)
- `apps/web/app/src/app/shared/layout/logo/logo.html` (1)
- `docs/design-system/recipes.md` (3)

Static guard: `rg "font-display" apps/web app docs/design-system` returns zero matches after the slice lands.

### Slice 2 — `app-auth-layout` shell tightening

Single PR. Fixes the duplicate background utilities, replaces the magic header height with a flex layout, and adds the missing `data-od-id` hooks.

**Files:**

- `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.html`
- `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.ts` (only if the layout needs a structural change to drop the `min-h-[calc(100vh-64px)]` magic number)
- `apps/web/app/src/app/shared/ui/layout/auth-card/auth-card.ts` (mobile padding tightening)

Proposed `auth-layout.html`:

```html
<header
  data-od-id="auth-shell"
  class="sticky top-0 z-20 border-b border-zinc-950/10 bg-white/85 backdrop-blur-md dark:border-white/10 dark:bg-zinc-950/85"
>
  <div class="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
    <a
      data-od-id="brand"
      routerLink="/"
      class="font-heading inline-flex items-center gap-2 font-bold tracking-tight text-zinc-950 sm:gap-2.5 dark:text-zinc-50"
      aria-label="Themis home"
    >
      <app-logo variant="mark-name" size="sm" />
    </a>

    <div class="flex items-center gap-1.5 sm:gap-2">
      <app-lang-switcher [options]="languages" />
      <app-theme-switcher variant="toggle" />
    </div>
  </div>
</header>

<main class="grid min-h-dvh place-items-center bg-white px-4 py-8 sm:py-10 md:px-6 md:py-14 dark:bg-zinc-950">
  <ng-content />
</main>
```

Notes:

- Drops the `bg-white sm:bg-white` and `dark:bg-zinc-950 dark:bg-zinc-950/85` duplicates.
- Uses `min-h-dvh` (dynamic viewport height) on `<main>` so the card always centers regardless of header height.
- Adds `data-od-id="brand"` for visual e2e.
- `font-display` → `font-heading` on the brand link.

### Slice 3 — Auth card mobile padding + submit hook

Single PR. Tightens the card padding at the 360px viewport and adds `data-od-id="submit"` to each auth route's primary button.

**Files:**

- `apps/web/app/src/app/shared/ui/layout/auth-card/auth-card.ts`
- `apps/web/app/src/app/auth/sign-in/sign-in.html`
- `apps/web/app/src/app/auth/sign-up/sign-up.html`
- `apps/web/app/src/app/auth/forgotten-password/forgotten-password.html`
- `apps/web/app/src/app/auth/reset-password/reset-password.html`

Proposed card classes:

```text
'mx-auto w-full max-w-[27.5rem] rounded-[var(--radius-panel)] border border-zinc-950/10 dark:border-white/10 px-6 py-6 shadow-sm sm:px-8 sm:py-8 md:px-10 md:py-10'
```

The `px-5 py-6` floor becomes `px-6 py-6` so the card has a uniform 24px gutter on phones, matching the design-system mobile-first baseline (`p-4` page gutter + `p-4` card inner gutter rounds to `p-6` when stacked).

Submit hook: add `data-od-id="submit"` alongside the existing `data-slot="submit"` so visual e2e suites can locate the CTA without relying on the accessible name.

### Slice 4 — Capture scripts and recordings

Single PR. Adds the structured snapshot script and regenerates the auth flow recordings.

**Files added:**

- `scripts/capture-ui-snapshots.cjs` — drives Playwright across the site (`/en/`, `/es/`, `/docs/`) and the auth routes at the Phase 10 viewport matrix, light + dark, full-page PNGs into `media/ui-snapshots/<route>-<width>-<theme>.png`. The script is resilient to a missing gateway: when `BASE_URL` is unreachable it skips the auth routes and logs a clear message instead of failing the whole run.
- `media/ui-snapshots/README.md` — explains the directory layout, the script, and how to refresh it.
- `media/auth-flow-videos/README.md` — update the regenerate instructions to note that the gateway must be up first (no new behavior, just clarity).

**Files touched:**

- `docs/constitution/roadmap.md` — add a "## Post-Refactor UI Review" entry pointing at this spec.

## Verification

### Static

```bash
rg "font-display" apps/web app docs/design-system
# expected: 0 matches

rg "sm:bg-white|dark:bg-zinc-950 dark:bg-zinc-950" apps/web/app/src/app/shared/ui/layout
# expected: 0 matches

rg "min-h-\[calc\(100vh-64px\)\]" apps/web/app/src/app/shared/ui/layout
# expected: 0 matches
```

### Unit + Lint + Typecheck

```bash
pnpm nx run app:lint
pnpm nx run app:typecheck
pnpm nx run app:vite:test
pnpm nx run site:lint
pnpm nx run site:typecheck
pnpm nx run ui-designer:lint
pnpm nx run ui-designer:build
```

### Visual (manual evidence)

```bash
# Boot the site alone
pnpm nx run site:build --skip-nx-cache
pnpm nx serve site &
# Snapshot matrix into media/ui-snapshots/
node scripts/capture-ui-snapshots.cjs

# Boot the full gateway for the auth half
pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production
node dist/apps/web/server/main.js &
node scripts/capture-ui-snapshots.cjs  # now writes the auth half too
node scripts/capture-auth-flow.cjs    # regenerates media/auth-flow-videos/*.webm
```

Manual review of the snapshot grid + the videos against the audit checklist. The reviewer ticks each P1 / P2 row when the corresponding screenshot shows the expected post-fix state.

## Risks

| Risk                                                             | Mitigation                                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `font-heading` resolves differently than `font-display` in build | The alias is defined in `styles.base.css` as `--font-family-display: var(--font-heading)` and `theme-replace font-heading → ...`. After the rename both classes resolve to the same family (Manrope). Visual diff confirms parity. |
| Removing `min-h-[calc(100vh-64px)]` breaks the centered card     | `min-h-dvh` + `grid place-items-center` keeps the centering. Spot-check the auth card at 360px (mobile) and 1280px (desktop) to confirm.                                                                                           |
| Gateway cannot boot in this turn (Redis unavailable)             | The snapshot script tolerates a missing gateway and skips the auth routes with a clear log. The auth video capture is documented as a follow-up command; the recordings are not required to land this spec.                        |
| `data-od-id` collides with existing e2e selectors                | The hooks are additive (`data-od-id="submit"` alongside `data-slot="submit"`). Existing `getByRole` selectors continue to work.                                                                                                    |

## Alternatives Considered

1. **Land only the snapshot/video scripts, no source fixes.** Rejected: the audit identified concrete drift that the script will surface; landing the scripts without the fixes would create a baseline that immediately needs a follow-up.
2. **Redesign the auth card padding scale from scratch.** Rejected: the design system already documents the mobile-first baseline; the fix is a one-line scale adjustment.
3. **Replace `font-display` with `font-heading` everywhere via a build-time alias.** Rejected: the alias already exists in `styles.base.css`; replacing the class names in source removes ambiguity for future readers and matches the recipes doc.
4. **Replace `app-auth-layout` with a CDK overlay shell.** Rejected: out of scope for a polish pass.

## Success Criteria

- `rg "font-display" apps/web app docs/design-system` returns zero matches.
- `rg "sm:bg-white|dark:bg-zinc-950 dark:bg-zinc-950" apps/web/app/src/app/shared/ui/layout` returns zero matches.
- `rg "min-h-\[calc\(100vh-64px\)\]" apps/web/app/src/app/shared/ui/layout` returns zero matches.
- `pnpm nx run app:lint`, `pnpm nx run app:typecheck`, `pnpm nx run app:vite:test`, `pnpm nx run site:lint`, `pnpm nx run site:typecheck`, `pnpm nx run ui-designer:lint`, `pnpm nx run ui-designer:build` all pass.
- `scripts/capture-ui-snapshots.cjs` produces one PNG per (route x viewport x theme) in `media/ui-snapshots/` for the site half, and the auth half when the gateway is reachable.
- `scripts/capture-auth-flow.cjs` regenerates `media/auth-flow-videos/auth-flow-iphone-13-mini.webm` and `media/auth-flow-videos/auth-flow-hd-1920x1080.webm` after the gateway is up.
- `apps/web/app/version.json` bumps to `1.5.0`.
- `docs/constitution/roadmap.md` lists this spec under a new "Post-Refactor UI Review" entry.

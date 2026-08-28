# Post-Refactor UI Review — Requirements

## Functional Requirements

### FR-1 — Heading utility alignment

Every heading in the auth surface and the brand wordmark uses the canonical `font-heading` utility. The non-canonical `font-display` alias does not appear in source.

- **Where:** `apps/web/app/src/app/auth/**/*.html`, `apps/web/app/src/app/shared/layout/logo/logo.html`, `docs/design-system/recipes.md`.
- **Acceptance:** `rg "font-display" apps/web app docs/design-system` returns zero matches.
- **Verification:** visual diff of sign-in/sign-up/verify-email/verify-device/forgotten-password/reset-password at 375px and 1280px confirms the heading family matches the ui-designer seed prototype (`apps/web/ui-designer/src/prototypes/app-auth-shell.html`).

### FR-2 — `app-auth-layout` sticky header

The auth shell sticky header carries exactly one background utility per mode. The duplicate `bg-white sm:bg-white` and `dark:bg-zinc-950 dark:bg-zinc-950/85` collapse to `bg-white/85` and `dark:bg-zinc-950/85`.

- **Where:** `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.html`.
- **Acceptance:** `rg "sm:bg-white|dark:bg-zinc-950 dark:bg-zinc-950" apps/web/app/src/app/shared/ui/layout` returns zero matches.
- **Verification:** rendered sticky header has a translucent backdrop blur in both light and dark modes; the opaque value does not flash in.

### FR-3 — `app-auth-layout` responsive height

The auth shell main area uses `min-h-dvh` instead of a magic `min-h-[calc(100vh-64px)]` so the card centers regardless of header height.

- **Where:** `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.html`.
- **Acceptance:** `rg "min-h-\[calc\(100vh-64px\)\]" apps/web/app/src/app/shared/ui/layout` returns zero matches.
- **Verification:** auth card centers vertically at 360px, 375px, 768px, and 1280px; no clipping when the language menu opens at desktop.

### FR-4 — Auth card mobile padding

The auth card padding scale starts at `px-6 py-6` on the smallest viewports. The `px-5` floor is replaced with `px-6`.

- **Where:** `apps/web/app/src/app/shared/ui/layout/auth-card/auth-card.ts`.
- **Acceptance:** the `px-5` literal does not appear in `auth-card.ts`; the scale reads `px-6 py-6 sm:px-8 sm:py-8 md:px-10 md:py-10`.
- **Verification:** rendered card at 360px viewport keeps a 24px outer gutter; no clipping of the heading or the submit button.

### FR-5 — Visual e2e chrome hooks

Every auth route exposes `data-od-id="submit"` on its primary submit button. The brand link exposes `data-od-id="brand"`.

- **Where:** `apps/web/app/src/app/auth/sign-in/sign-in.html`, `apps/web/app/src/app/auth/sign-up/sign-up.html`, `apps/web/app/src/app/auth/forgotten-password/forgotten-password.html`, `apps/web/app/src/app/auth/reset-password/reset-password.html` (two buttons), `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.html`.
- **Acceptance:** `rg "data-od-id=\"submit\"" apps/web/app/src/app/auth` returns 5 matches (sign-in: 1, sign-up: 1, forgotten-password: 1, reset-password: 2). `rg "data-od-id=\"brand\"" apps/web/app/src/app/shared/ui/layout` returns 1 match.
- **Verification:** snapshot script locates every submit button without falling back to `getByRole`.

### FR-6 — Capture scripts and recordings

A `scripts/capture-ui-snapshots.cjs` script exists and produces a structured snapshot grid for the site routes (`/en/`, `/es/`, `/docs/`) and the auth routes. The existing `scripts/capture-auth-flow.cjs` script regenerates the auth flow recordings.

- **Where:** `scripts/capture-ui-snapshots.cjs`, `media/ui-snapshots/`, `media/auth-flow-videos/`.
- **Acceptance:** the snapshot script writes one PNG per (route x viewport x theme) to `media/ui-snapshots/`. The auth flow recordings are present at `media/auth-flow-videos/auth-flow-iphone-13-mini.webm` and `media/auth-flow-videos/auth-flow-hd-1920x1080.webm`.
- **Verification:** the script handles a missing gateway gracefully (skips the auth half with a clear log).

### FR-7 — Documentation accuracy

The auth shell recipe in `docs/design-system/recipes.md` matches the rendered Angular app.

- **Where:** `docs/design-system/recipes.md`.
- **Acceptance:** the recipe uses `font-heading`, `min-h-dvh`, `data-od-id="brand"`, `data-od-id="submit"`, and the `px-6 py-6` mobile padding floor.
- **Verification:** line-by-line diff of the recipe against `apps/web/app/src/app/auth/sign-in/sign-in.html` and `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.html` confirms parity.

### FR-8 — Roadmap entry

`docs/constitution/roadmap.md` lists this spec under a new "Post-Refactor UI Review" entry.

- **Where:** `docs/constitution/roadmap.md`.
- **Acceptance:** the section exists and points at `docs/specs/2026-06-27-post-refactor-ui-review/`.
- **Verification:** `rg "Post-Refactor UI Review" docs/constitution/roadmap.md` returns one match.

## Non-Functional Requirements

### NFR-1 — Accessibility

- WCAG AA contrast holds for every text/background pair after the fixes:
  - `zinc-950` on `white/85` (light header) ≥ 4.5:1 for body text.
  - `zinc-50` on `zinc-950/85` (dark header) ≥ 4.5:1 for body text.
  - `zinc-950` on `zinc-50` (light card surface) ≥ 4.5:1.
  - `zinc-50` on `zinc-900` (dark card surface) ≥ 4.5:1.
- Every interactive element keeps its focus ring (the `ui-focus-ring` utility still resolves to `var(--color-blue-500)` in dark mode and `var(--color-blue-600)` in light mode).
- Touch targets remain at least 44px (`ui-touch-target` is unchanged).
- `prefers-reduced-motion` continues to be honored through the existing `@media (prefers-reduced-motion: reduce)` block in `styles.base.css`.

### NFR-2 — Mobile-first

- All spacing scales start at the smallest viewport and grow at `sm:` / `md:` / `lg:`.
- The auth card padding starts at `px-6 py-6` (24px gutter) on the smallest viewport, matching the design-system baseline.
- The sticky header is sticky at every breakpoint (not just `sm+`), so the chrome does not disappear on mobile after scrolling.

### NFR-3 — Performance

- No new CSS bundle weight. The duplicate utilities in the sticky header collapse to a single utility each; the rendered class list is shorter.
- No new JS dependencies. Playwright is already a workspace dev dependency.

### NFR-4 — Internationalization

- No new copy. The existing i18n markers in the auth templates are unchanged.
- `pnpm nx run app:extract-i18n` continues to produce the same `messages.es.xlf` (no new strings, no removed strings).

### NFR-5 — Tenant isolation

- Not applicable. This spec touches presentation layer only.

## Out of Scope

- No redesign of any auth route copy, layout, or section order.
- No new design tokens, no new primitives, no new shared/ui components.
- No changes to the backend, the API, or the worker.
- No introduction of automated visual regression tests in CI.
- No migration of `DESIGN.md` (documented as out of scope in the previous site spec).

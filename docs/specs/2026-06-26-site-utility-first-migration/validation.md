# Site Utility-First Migration — Validation

## Status

Pending. Updated after the PR lands.

## Automated

### Static validation (grep guards)

All of these must return **zero matches** under `apps/web/site/src`:

```bash
# Legacy Material 3 utility classes.
rg "bg-surface|bg-on-surface|text-on-surface|text-on-surface-variant|border-outline-variant|border-outline|bg-primary-container|text-on-primary-container|bg-primary|text-primary|text-on-primary|bg-tertiary|text-tertiary|bg-tertiary-container|text-on-tertiary-container|border-primary|border-primary-dim|border-tertiary-dim|text-outline|bg-error|focus-visible:outline-primary|--color-surface|--color-primary|--color-tertiary|--color-outline" apps/web/site/src

# Hard-coded colors that drifted from the workspace palette.
rg "text-sky|text-slate|bg-slate|border-slate|text-yellow-400" apps/web/site/src
```

### Nx targets

```bash
pnpm nx run site:lint                # expected: 0 errors, 0 new warnings
pnpm nx run site:typecheck           # expected: 0 errors
pnpm nx run site:test                # expected: existing tests pass
pnpm nx run site:build --skip-nx-cache   # expected: builds dist/apps/web/site
pnpm nx run site-e2e:e2e             # expected: site-smoke.spec.ts passes against both /en/ and /es/
```

The smoke e2e test (`apps/web/site-e2e/src/site-smoke.spec.ts`) must pass without modification. It asserts `response.ok()` is true, `<main>` is visible, and the first `<h1>` is visible.

## Token Usage Validation

- `landing-page.astro` uses raw Tailwind v4 utilities for every color reference.
- `theme-switcher.astro` uses raw Tailwind v4 utilities (`text-zinc-500 dark:text-zinc-400`, `hover:bg-zinc-100 dark:hover:bg-zinc-800`, `focus-visible:outline-blue-600 dark:focus-visible:outline-blue-500`).
- `locale-switcher.astro` uses raw Tailwind v4 utilities (`text-zinc-500 dark:text-zinc-400`, `hover:text-blue-600 dark:hover:text-blue-500`).
- `pages/docs/index.astro` uses raw Tailwind v4 utilities (`text-blue-600 dark:text-blue-400`, `bg-white dark:bg-zinc-900`, `border-zinc-950/10 dark:border-white/10`).
- No raw hex colors (`bg-[#...]`, `text-[#...]`) appear in any site component.
- No `var(--color-*)` references to non-standard custom properties.

## Documentation Validation

### `docs/design-system/tokens.md`

- Token table describes raw Tailwind v4 utilities (no `--color-bg`, `--color-panel`, `--color-accent`).
- "Compatibility Aliases" table is removed.
- Reusable utilities section (`ui-focus-ring`, `ui-panel`, `ui-panel-raised`, `ui-touch-target`, `ui-text-rhythm`) is preserved.
- Dark mode section keeps the `@custom-variant dark (&:where(.dark, .dark *))` reference.
- Fonts, radii, and shadow tables stay identical.

### `docs/design-system/recipes.md`

- Every HTML snippet uses raw Tailwind v4 utilities.
- The Angular `app-*` recipes stay byte-identical where they already use raw utilities.
- The "Tonal Section Band" / "Surface Hierarchy" prose references `bg-zinc-50` / `dark:bg-zinc-900`, not `surface-container-low`.
- The "Buttons" section clarifies that `tone="blue"` resolves to `bg-blue-600` / `text-white`.

### `docs/agents/design-system.md`

- The "Preserve the surface hierarchy" bullet lists the raw zinc ladder, not `surface-container-*` names.
- The "Use ghost borders" bullet lists `border-zinc-950/10` / `dark:border-white/10`, not `outline-variant`.
- Mobile-first, accessibility, and visual quality sections are unchanged.

## Accessibility Validation

- WCAG AA contrast for all visible text:
  - `text-zinc-950` on `bg-white` ≈ 19.3:1 (AAA).
  - `text-zinc-50` on `bg-zinc-950` ≈ 18.9:1 (AAA).
  - `text-zinc-500` on `bg-white` ≈ 4.6:1 (AA body text).
  - `text-zinc-400` on `bg-zinc-950` ≈ 8.2:1 (AAA body text).
  - `text-white` on `bg-blue-600` ≈ 4.6:1 (AA).
  - `text-green-700` on `bg-green-100` ≈ 4.7:1 (AA).
  - `text-green-300` on `dark:bg-green-500/20` over `dark:bg-zinc-950` ≈ 9.1:1 (AAA).
- Focus states:
  - Theme switcher: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-500`.
  - Locale switcher links: inherit the existing browser underline-on-focus behavior plus the new color change.
  - CTAs: native focus rings from the browser.
- Semantic HTML5 structure (`<main>`, `<nav>`, `<section>`, `<footer>`, `<article>`, `<header>`, `<h1>`–`<h5>`) is preserved.
- `prefers-reduced-motion` is honored through the existing `@media (prefers-reduced-motion: reduce)` block in `styles.base.css`.

## Code Quality Checks

- No `var(--color-surface)`, `var(--color-primary)`, `var(--color-on-surface)`, `var(--color-tertiary)`, etc. references in the site. — verified by the grep guard.
- No dynamic class strings (string interpolation that builds Tailwind class names) in any site component.
- No new dependencies added to `package.json` or `pnpm-lock.yaml`.
- No changes to `astro.config.mjs`, `project.json`, `tsconfig.json`, `vitest.config.ts`, or `eslint.config.mjs` for the site.
- No changes to `styles.base.css` (kept as-is).
- No changes to `apps/web/site-e2e/src/site-smoke.spec.ts` (existing test must pass unchanged).

## Visual Check

### Light mode

- Page background: `bg-white`.
- Sticky nav: `bg-white/80` with `backdrop-blur-md`.
- Hero section: zinc-950 title text, zinc-500 body text.
- Primary CTA: `bg-blue-600 text-white`.
- Secondary CTA: `border-zinc-950/20` with `hover:bg-zinc-100`.
- Projects overview card: `bg-white` outer, `bg-zinc-50` inner.
- Project card with "Active" badge: green badge `bg-green-100 text-green-700`.
- Project card with "Stale" badge: neutral badge `bg-zinc-100 text-zinc-500`.
- Insights dots: `bg-red-600` (error) and `bg-blue-600` (primary).
- Decisions panel: `border-l-2 border-green-600/40` rail.
- Methodology section: `bg-zinc-50` with `border-y border-zinc-950/10`, left blue rail.
- Detail features list: `bg-zinc-50` items with `border-l-4 border-blue-600`.
- Task card: `bg-white` with `bg-zinc-50` rows.
- Closing CTA stack: blue primary, outline secondary.
- Footer: `bg-zinc-50` with `text-zinc-500` labels.

### Dark mode

- Page background: `dark:bg-zinc-950`.
- Sticky nav: `dark:bg-zinc-950/80` with `backdrop-blur-md`.
- Hero section: zinc-50 title text, zinc-400 body text.
- Primary CTA: `dark:bg-blue-500 text-white`.
- Secondary CTA: `dark:border-white/20` with `dark:hover:bg-zinc-800`.
- Projects overview card: `dark:bg-zinc-900` outer, `dark:bg-zinc-900/50` inner.
- Project card with "Active" badge: green badge `dark:bg-green-500/20 dark:text-green-300`.
- Project card with "Stale" badge: neutral badge `dark:bg-zinc-800 dark:text-zinc-400`.
- Insights dots: `dark:bg-red-500` (error) and `dark:bg-blue-500` (primary).
- Decisions panel: `dark:border-blue-400/40` rail.
- Methodology section: `dark:bg-zinc-900` with `dark:border-y dark:border-white/10`.
- Detail features list: `dark:bg-zinc-900` items with `dark:border-l-4 dark:border-blue-500`.
- Task card: `dark:bg-zinc-900` with `dark:bg-zinc-800` rows.
- Closing CTA stack: blue primary, outline secondary.
- Footer: `dark:bg-zinc-900` with `dark:text-zinc-400` labels.

### Docs page (`/docs/`)

- Light mode: zinc-950 title, blue-600 eyebrow, zinc-500 body, white cards, zinc-950/10 borders.
- Dark mode: zinc-50 title, blue-400 eyebrow, zinc-400 body, zinc-900 cards, white/10 borders.

### Responsive

- Mobile (375), tablet (768), desktop (1280): layout, breakpoints, and content remain identical to the pre-migration baseline.
- Touch targets remain ≥ 44px where they were before (theme switcher, locale switcher, CTA buttons).

## Definition of Done

The migration is complete when:

1. All grep guards return zero matches under `apps/web/site/src`.
2. `pnpm nx run site:lint`, `pnpm nx run site:typecheck`, `pnpm nx run site:test`, `pnpm nx run site:build --skip-nx-cache`, and `pnpm nx run site-e2e:e2e` all pass.
3. The existing `apps/web/site-e2e/src/site-smoke.spec.ts` passes without modification.
4. `docs/design-system/tokens.md` describes raw Tailwind v4 utilities and drops the obsolete "Compatibility Aliases" table.
5. `docs/design-system/recipes.md` HTML snippets use raw Tailwind v4 utilities.
6. `docs/agents/design-system.md` points at the workspace's raw-utility pattern.
7. `/en/`, `/es/`, and `/docs/` render with the intended light/dark theme palette in a browser.
8. Theme switching, locale switching, and responsive behavior are preserved.
9. Browser console reports zero errors and zero hydration warnings.
10. `DESIGN.md` at the repo root is unchanged (intentionally out of scope; documented as a known follow-up).

## Notes

- The `2026-06-22-website-design-system-color-migration/` spec becomes obsolete once this migration lands. The spec directory stays in git history but is no longer the source of truth for site colors.
- A follow-up spec should align `DESIGN.md` with the actual token contract. That manuscript currently recommends `var(--color-surface)`, `var(--color-primary)`, etc., which have not existed in `@theme` since `52fba16 refactor(design-system): drop all custom semantic color tokens`.
- A follow-up spec should add visual snapshot tests for the site (e.g. `pnpm nx run site-e2e:e2e -- --grep visual`). The smoke test catches structural breakage but not visual regression.
- The `apps/web/ui-designer/src/prototypes/` folder is the canonical reference for "raw Tailwind v4 utility pattern" in HTML surfaces. The migrated site should match that vocabulary byte-for-byte at the utility level.

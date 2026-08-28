# Site Utility-First Migration — Implementation Plan

The migration ships as a single PR. The blast radius is bounded to the Astro site + design system docs; no Angular changes are required.

## PR1 — Site Utility-First Migration

### Step 1 — Token audit

Run the grep guards before touching any file. Confirm the count and locations of the legacy utility classes so we know what is in scope.

```bash
rg -n "bg-surface|bg-on-surface|text-on-surface|text-on-surface-variant|border-outline-variant|border-outline|bg-primary-container|text-on-primary-container|bg-primary|text-primary|text-on-primary|bg-tertiary|text-tertiary|bg-tertiary-container|text-on-tertiary-container|border-primary|border-primary-dim|border-tertiary-dim|text-outline|bg-error|focus-visible:outline-primary|--color-surface|--color-primary|--color-tertiary|--color-outline" apps/web/site/src

rg -n "text-sky|text-slate|bg-slate|border-slate|text-yellow-400" apps/web/site/src
```

Expected surface: 71+ matches in `apps/web/site/src/components/landing-page.astro`, 6+ in `theme-switcher.astro`, 3+ in `locale-switcher.astro`, 8+ in `pages/docs/index.astro`.

### Step 2 — Migrate `landing-page.astro`

Edit `apps/web/site/src/components/landing-page.astro` end-to-end using the token mapping in `sdd.md`. Apply replacements in top-to-bottom order so each section is reviewable in isolation:

1. Sticky `<nav>` (transparent white/dark with backdrop blur).
2. Hero `<section>` (centered title, body, primary + secondary CTAs).
3. Projects overview `<section>` (outer card with zinc-50 fill; inner cards with white/zinc-50 fills; "Active" badge; "Stale" badge; insights dots; decisions panel).
4. Methodology `<section id="methodology">` (three-up grid with left blue rail).
5. Detail `<section>` (context-window badge, features list with blue icons, task card with "View visual" and "Passed" rows).
6. System `<section>` (two-up card grid).
7. Closing `<section>` (centered CTA stack).
8. `<footer>` (copyright + four-link row).

Preserve every non-color class exactly. Do not change spacing, layout, ordering, copy, or breakpoints. The migration is strictly a color class replacement.

### Step 3 — Migrate `theme-switcher.astro`

Edit `apps/web/site/src/components/theme-switcher.astro` to use raw utilities:

- Replace `text-on-surface-variant` with `text-zinc-500 dark:text-zinc-400`.
- Replace `hover:bg-surface-container-high` with `hover:bg-zinc-100 dark:hover:bg-zinc-800`.
- Replace `hover:text-primary` with `hover:text-blue-600 dark:hover:text-blue-500`.
- Replace `focus-visible:outline-primary` with `focus-visible:outline-blue-600 dark:focus-visible:outline-blue-500`.
- Replace `hover:bg-surface-container/90` with `hover:bg-zinc-100/90 dark:hover:bg-zinc-800/90`.
- Replace `text-on-surface` with `text-zinc-950 dark:text-zinc-50`.
- Replace `text-yellow-400` (sun icon) with `text-amber-500 dark:text-amber-400`.
- Replace `text-white` (moon icon) with `text-zinc-50` (still readable on the dark surface).

The `theme-switcher.ts` script is not touched.

### Step 4 — Migrate `locale-switcher.astro`

Edit `apps/web/site/src/components/locale-switcher.astro`:

- Replace `text-on-surface-variant` with `text-zinc-500 dark:text-zinc-400`.
- Replace `hover:text-primary` with `hover:text-blue-600 dark:hover:text-blue-500`.
- Replace `text-on-surface` (active state) with `text-zinc-950 dark:text-zinc-50`.

### Step 5 — Migrate `pages/docs/index.astro`

Edit `apps/web/site/src/pages/docs/index.astro`:

- Replace `text-sky-300` (eyebrow) with `text-blue-600 dark:text-blue-400`.
- Replace `text-slate-300` (body) with `text-zinc-500 dark:text-zinc-400`.
- Replace `text-white` (title, card headings) with `text-zinc-950 dark:text-zinc-50`.
- Replace `bg-slate-950/60` (card surface) with `bg-white dark:bg-zinc-900`.
- Replace `border-slate-800` (card border) with `border-zinc-950/10 dark:border-white/10`.

The page keeps its `bg-zinc-950` page background (already in light/dark via `html.dark`).

### Step 6 — Rewrite `docs/design-system/tokens.md`

Replace the semantic-token table in `docs/design-system/tokens.md` with a **palette cheatsheet** that documents the raw Tailwind v4 utilities actually used by the workspace:

- Light surface ladder: `bg-white` → `bg-zinc-50` → `bg-zinc-100`.
- Dark surface ladder: `dark:bg-zinc-950` → `dark:bg-zinc-900` → `dark:bg-zinc-800`.
- Text ladder: `text-zinc-950` / `dark:text-zinc-50`, `text-zinc-500` / `dark:text-zinc-400`.
- Accents: `bg-blue-600` / `dark:bg-blue-500`, `bg-blue-600/10` / `dark:bg-blue-400/10`.
- Success: `bg-green-100 text-green-700` / `dark:bg-green-500/20 dark:text-green-300`.
- Danger: `bg-red-600` / `dark:bg-red-500`.
- Borders: `border-zinc-950/10` / `dark:border-white/10`, `border-blue-600/40` / `dark:border-blue-400/40`.
- Fonts (keep): `font-sans` (Inter), `font-heading` (Manrope), `font-mono` (JetBrains Mono).
- Radii (keep): `radius-sm` (0.5rem), `radius-control` (0.5rem), `radius-panel` (0.75rem).
- Shadows (keep): `shadow-sm`, `shadow-md`, `shadow-panel`.

Drop the **Compatibility Aliases** table entirely. Keep the **Reusable Utilities** section (`ui-focus-ring`, `ui-panel`, `ui-panel-raised`, `ui-touch-target`, `ui-text-rhythm`).

### Step 7 — Update `docs/design-system/recipes.md`

Walk through each HTML snippet in `docs/design-system/recipes.md` and replace any reference to a legacy utility (`bg-surface-container-low`, `border-outline-variant`, etc.) with the raw Tailwind v4 utility equivalent. The Angular `app-*` recipes that use raw utilities stay byte-identical. Focus edits on:

- The "Surface Hierarchy" / "Tonal Section Band" prose callouts — replace the `surface-container-low` reference with `bg-zinc-50` / `dark:bg-zinc-900`.
- The "Mobile-First Layout" prose callouts — keep them; they already use the right vocabulary.
- The "Buttons" section — keep the existing `tone="blue"` references; clarify that `blue` resolves to `bg-blue-600` / `text-white`.

### Step 8 — Update `docs/agents/design-system.md`

Edit `docs/agents/design-system.md`:

- Replace the "Preserve the surface hierarchy: `surface`, `surface-container-low`, ..." bullet with the raw ladder: `bg-white` → `bg-zinc-50` → `bg-zinc-100` (light), `dark:bg-zinc-950` → `dark:bg-zinc-900` → `dark:bg-zinc-800` (dark).
- Replace "Use ghost borders with `outline-variant` at low opacity" with "Use ghost borders with `border-zinc-950/10` (light) / `dark:border-white/10` (dark)".
- Keep the rest of the file (mobile-first, accessibility, visual quality) intact.

### Step 9 — Verify

```bash
# Static validation — these must return zero matches.
rg "bg-surface|bg-on-surface|text-on-surface|text-on-surface-variant|border-outline-variant|border-outline|bg-primary-container|text-on-primary-container|bg-primary|text-primary|text-on-primary|bg-tertiary|text-tertiary|bg-tertiary-container|text-on-tertiary-container|border-primary|border-primary-dim|border-tertiary-dim|text-outline|bg-error|focus-visible:outline-primary|--color-surface|--color-primary|--color-tertiary|--color-outline" apps/web/site/src

rg "text-sky|text-slate|bg-slate|border-slate|text-yellow-400" apps/web/site/src

# Nx targets.
pnpm nx run site:lint
pnpm nx run site:typecheck
pnpm nx run site:test
pnpm nx run site:build --skip-nx-cache
pnpm nx run site-e2e:e2e
```

### Step 10 — Manual visual check

```bash
pnpm nx serve site
```

- `/en/` and `/es/` in light mode: white page, blue CTAs, blue accent borders, green success badge, neutral surface ladder.
- `/en/` and `/es/` in dark mode: deep zinc-950 background, blue-500 accents, blue-400/40 borders, green-300 text on green-500/20 badge.
- `/docs/` in both modes: same zinc/blue palette.
- Theme toggle, locale switcher, responsive breakpoints (375 / 768 / 1280): all preserved.
- Browser console: zero errors, zero hydration warnings.

### PR acceptance

- All grep guards return zero matches.
- All Nx targets pass.
- The site smoke e2e (`pnpm nx run site-e2e:e2e`) passes without modification.
- Manual visual check confirms light/dark parity with the seed prototype at `apps/web/ui-designer/src/prototypes/app-auth-shell.html`.
- `DESIGN.md` at the repo root is unchanged (out of scope).

## Nx Verification Commands

```bash
pnpm nx run site:lint
pnpm nx run site:typecheck
pnpm nx run site:test
pnpm nx run site:build --skip-nx-cache
pnpm nx run site-e2e:e2e
```

If a target is missing or changes, inspect it first with:

```bash
pnpm nx show project site --json
pnpm nx show project site-e2e --json
```

## Out of Scope (Reminder)

- Reintroducing semantic tokens in `styles.base.css`.
- Changing Angular components in `apps/web/app` or `shared/ui`.
- Updating `DESIGN.md` at the repo root.
- Visual snapshot tests for the site (follow-up spec).
- Reauthoring `apps/web/site/src/components/landing-page.astro` to follow the seed prototype's composition (different layout).
- New i18n strings or copy changes in English or Spanish.

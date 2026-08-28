# Site Utility-First Migration — Software Design Document

## Decision

Migrate `apps/web/site` from the legacy Material 3 token vocabulary to **raw Tailwind v4 utility classes** (`bg-white`, `bg-zinc-50`, `bg-blue-600`, `text-zinc-950`, `border-zinc-950/10`, etc.) so the public website shares the same token source as the Angular app and the ui-designer prototypes. No semantic color tokens (`--color-bg`, `--color-panel`, `--color-accent`) are reintroduced into `styles.base.css` — they were deliberately removed in `52fba16 refactor(design-system): drop all custom semantic color tokens`, and `shared/ui`, `apps/web/ui-designer/src/prototypes/app-auth-shell.html`, and every other Tailwind v4 surface in the workspace now consume the standard Tailwind palette directly.

This migration unblocks the website (which is currently visually broken because the legacy utility classes it relies on no longer exist in the token layer) and aligns it with the rest of the workspace's "utility-first, no semantic shim" posture.

## Why now

Three prior specs landed and changed the token contract underneath the website without updating it:

| Spec                                                                     | What it changed                                                                                                          | Impact on the site                                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `2026-06-22-catalyst-angular-ui-foundation/`                             | Introduced a thin Catalyst-style alias layer on top of Material 3 tokens.                                                | Site kept using Material 3 names.                                                                                                                |
| `2026-06-23-catalyst-pure-tokens-alignment/`                             | Retired Material 3 names; documented semantic Catalyst tokens (`--color-bg`, `--color-panel`, `--color-accent`).         | Site kept using Material 3 names. The semantic tokens it points to in `tokens.md` were never actually exposed in `@theme`.                       |
| `52fba16 refactor(design-system): drop all custom semantic color tokens` | Removed the `ui-*` utilities' dependency on semantic tokens and dropped the `@theme` color block.                        | Site's `bg-surface`, `text-on-surface`, `bg-primary`, etc. stopped resolving entirely. The site is currently rendering with **no theme colors**. |
| `2026-06-26-ui-designer-app/`                                            | Shipped a seed prototype that uses raw Tailwind v4 utilities (`bg-white`, `bg-zinc-50`, `text-zinc-950`, `bg-blue-600`). | Established the canonical "no semantic shim" pattern for any HTML surface outside the Angular app.                                               |

The site has been left in an inconsistent state: `tokens.md` documents tokens that don't exist in `@theme`, `landing-page.astro` references utility classes that don't generate any CSS, and the only working reference for "what to write" is the seed prototype in `apps/web/ui-designer/src/prototypes/app-auth-shell.html`.

## Goals

1. Replace every legacy utility class in `apps/web/site/src/**` with the equivalent raw Tailwind v4 utility so the public website renders with the intended light/dark theme.
2. Replace hard-coded `sky-*`, `slate-*` colors in `apps/web/site/src/pages/docs/index.astro` with the same `zinc`/`blue` palette the rest of the workspace uses.
3. Update `docs/design-system/tokens.md` to describe the actual token layer (raw Tailwind v4 utilities, no semantic shim) and remove the obsolete "Compatibility Aliases" table.
4. Update `docs/design-system/recipes.md` so every `html` snippet uses raw Tailwind v4 utilities instead of semantic tokens.
5. Update `docs/agents/design-system.md` so it points at the new pattern (raw Tailwind v4 utilities, no semantic tokens) and removes the "preserve the surface hierarchy" advice that referenced the retired `surface-container-*` ladder.
6. Keep `styles.base.css` minimal: fonts, radii, shadows, and the existing `ui-*` utilities. **Do not** reintroduce semantic color tokens in `@theme`.
7. Preserve the page structure, section order, layout, responsive behavior, content, copy, routing, localization, theme switching, and locale switching exactly as they are today.

## Non-Goals

1. No redesign of the landing page. Section order, copy, layouts, and breakpoints stay byte-for-byte identical.
2. No new sections, removed sections, or reordered sections.
3. No new illustrations, icons, images, or decorative assets.
4. No new i18n strings or copy changes in English or Spanish.
5. No reintroduction of Material 3 token names (`--color-surface`, `--color-primary`, `--color-on-primary`, `--color-tertiary`, `--color-outline`, `--color-outline-variant`, `--color-error`) or Catalyst semantic tokens (`--color-bg`, `--color-panel`, `--color-accent`, `--color-fg`, `--color-muted-fg`, `--color-danger`, `--color-border`, `--color-border-subtle`) in `styles.base.css`.
6. No changes to Angular components in `apps/web/app` or `shared/ui`. The migration is scoped to the Astro site + design system docs.
7. No new Nx targets or new ESLint rules.
8. No new dependencies. The migration uses utilities that Tailwind v4 already exposes.
9. No e2e test changes beyond keeping the existing `apps/web/site-e2e/src/site-smoke.spec.ts` green. Visual snapshot tests for the site are a follow-up.

## Token Mapping

The site currently uses these legacy utility classes. Every entry maps to the raw Tailwind v4 utility that replaces it.

| Legacy class                                       | Replacement (light)              | Replacement (dark)                      | Notes                                                       |
| -------------------------------------------------- | -------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `bg-surface`                                       | `bg-white`                       | `dark:bg-zinc-950`                      | Page background and section canvas                          |
| `bg-surface-container-lowest`                      | `bg-white`                       | (omit, fall back to `dark:bg-zinc-950`) | White cards in dark mode inherit the page background        |
| `bg-surface-container-low`                         | `bg-zinc-50`                     | `dark:bg-zinc-900`                      | Tonal section bands and panel fills                         |
| `bg-surface-container`                             | `bg-zinc-100`                    | `dark:bg-zinc-800`                      | Nested panels                                               |
| `bg-surface-container-high`                        | `bg-zinc-100`                    | `dark:bg-zinc-800`                      | Raised/active surface treatments                            |
| `bg-surface-container-highest`                     | `bg-zinc-200`                    | `dark:bg-zinc-700`                      | Highest tonal surface (used for decorative accents only)    |
| `text-on-surface`                                  | `text-zinc-950`                  | `dark:text-zinc-50`                     | Primary text                                                |
| `text-on-surface-variant`                          | `text-zinc-500`                  | `dark:text-zinc-400`                    | Muted text and secondary labels                             |
| `border-outline-variant`                           | `border-zinc-950/10`             | `dark:border-white/10`                  | Subtle dividers                                             |
| `border-outline`                                   | `border-zinc-950/20`             | `dark:border-white/20`                  | Visible borders                                             |
| `bg-primary`                                       | `bg-blue-600`                    | `dark:bg-blue-500`                      | Primary action fill                                         |
| `text-primary`                                     | `text-blue-600`                  | `dark:text-blue-500`                    | Primary action text                                         |
| `text-on-primary`                                  | `text-white`                     | `text-white`                            | Text on primary fill                                        |
| `bg-primary-container` / `bg-primary/10`           | `bg-blue-600/10`                 | `dark:bg-blue-400/10`                   | Soft primary fill                                           |
| `bg-primary/20`                                    | `bg-blue-600/20`                 | `dark:bg-blue-400/20`                   | Soft primary fill (stronger)                                |
| `bg-primary/5`                                     | `bg-blue-600/5`                  | `dark:bg-blue-400/5`                    | Soft primary fill (faintest)                                |
| `text-on-primary-container`                        | `text-blue-700`                  | `dark:text-blue-300`                    | Text on soft primary fill                                   |
| `border-primary`                                   | `border-blue-600`                | `dark:border-blue-500`                  | Accent border                                               |
| `border-primary-dim`                               | `border-blue-600/40`             | `dark:border-blue-400/40`               | Accent border (left rail, decorative accent)                |
| `bg-tertiary`                                      | `bg-green-700`                   | `dark:bg-green-400`                     | Success/positive accent fill                                |
| `text-tertiary`                                    | `text-green-700`                 | `dark:text-green-400`                   | Success/positive accent text                                |
| `bg-tertiary/20`                                   | `bg-green-600/20`                | `dark:bg-green-400/20`                  | Success/positive fill (soft)                                |
| `bg-tertiary-container`                            | `bg-green-100`                   | `dark:bg-green-500/20`                  | Success badge fill                                          |
| `text-on-tertiary-container`                       | `text-green-700`                 | `dark:text-green-300`                   | Success badge text                                          |
| `border-tertiary-dim`                              | `border-green-600/40`            | `dark:border-green-400/40`              | Success accent border                                       |
| `text-outline`                                     | `text-zinc-500`                  | `dark:text-zinc-400`                    | Outline-level text                                          |
| `bg-error`                                         | `bg-red-600`                     | `dark:bg-red-500`                       | Error/destructive fill                                      |
| `focus-visible:outline-primary`                    | `focus-visible:outline-blue-600` | `dark:focus-visible:outline-blue-500`   | Focus outline                                               |
| `hover:text-primary`                               | `hover:text-blue-600`            | `dark:hover:text-blue-500`              | Hover state                                                 |
| `hover:bg-primary/90`                              | `hover:bg-blue-700`              | `dark:hover:bg-blue-500`                | Hover state on primary CTA                                  |
| `hover:bg-surface-container-high`                  | `hover:bg-zinc-100`              | `dark:hover:bg-zinc-800`                | Hover state on tonal surface                                |
| `hover:bg-surface-container/90`                    | `hover:bg-zinc-100/90`           | `dark:hover:bg-zinc-800/90`             | Hover state on tonal surface (translucent)                  |
| `hover:bg-surface-container`                       | `hover:bg-zinc-100`              | `dark:hover:bg-zinc-800`                | Hover state on tonal surface                                |
| `dark:bg-surface/80`                               | `bg-white/80`                    | `dark:bg-zinc-950/80`                   | Translucent header (keep `backdrop-blur-md`)                |
| `dark:bg-surface-container/50`                     | —                                | `dark:bg-zinc-800/50`                   | Translucent surface in dark mode                            |
| `dark:bg-surface-container-highest/30`             | —                                | `dark:bg-zinc-700/30`                   | Translucent surface in dark mode                            |
| `dark:bg-surface-container-highest`                | —                                | `dark:bg-zinc-700`                      | Decorative surface in dark mode                             |
| `dark:bg-surface-container`                        | —                                | `dark:bg-zinc-800`                      | Nested panel in dark mode                                   |
| `dark:bg-surface-container-low`                    | —                                | `dark:bg-zinc-900`                      | Section band in dark mode                                   |
| `dark:bg-primary/5`                                | —                                | `dark:bg-blue-500/5`                    | Decorative glow                                             |
| `dark:border-outline-variant/20`                   | —                                | `dark:border-white/10`                  | Border in dark mode                                         |
| `dark:border-slate-400/10`                         | —                                | `dark:border-white/10`                  | Stray slate border — collapse into the white/10 border rule |
| `text-yellow-400` (theme switcher sun icon)        | `text-amber-500`                 | `text-amber-400`                        | Sun icon uses amber                                         |
| `text-white` (theme switcher moon icon on dark bg) | —                                | `text-zinc-50`                          | Moon icon stays readable on dark surface                    |
| `text-sky-300` (docs page eyebrow)                 | `text-blue-600`                  | `dark:text-blue-400`                    | Docs page eyebrow                                           |
| `text-slate-300` (docs page body)                  | `text-zinc-500`                  | `dark:text-zinc-400`                    | Docs page body                                              |
| `text-white` (docs page title)                     | `text-zinc-950`                  | `dark:text-zinc-50`                     | Docs page title                                             |
| `bg-slate-950/60` (docs cards)                     | `bg-white`                       | `dark:bg-zinc-900`                      | Docs page card surface                                      |
| `border-slate-800` (docs cards)                    | `border-zinc-950/10`             | `dark:border-white/10`                  | Docs page card border                                       |

Any legacy class not listed above maps through the same pattern: every `bg-{surface-ladder}-{shade}` becomes a `bg-zinc-{shade}` (with `dark:bg-zinc-{shade+1}` for the dark mode), every `text-{on-surface, on-surface-variant, primary, tertiary}` becomes the matching `text-{zinc|blue|green}-{shade}` (with `dark:` for the dark mode), and every `border-{outline-variant, outline, primary, tertiary}-{dim}` becomes the matching `border-{zinc|blue|green}-{shade}/{opacity}` (with `dark:` for the dark mode).

## Implementation Strategy

1. **Token audit.** Grep `apps/web/site/src` for the legacy class names listed in the token mapping. Confirm the count and locations before editing.
2. **Replace in dependency order.**
   1. `apps/web/site/src/components/landing-page.astro` first (largest surface, 71+ legacy classes).
   2. `apps/web/site/src/components/theme-switcher.astro` next (translucent hover states and focus outlines).
   3. `apps/web/site/src/components/locale-switcher.astro` (3 classes).
   4. `apps/web/site/src/pages/docs/index.astro` (replace `sky`/`slate` with `blue`/`zinc`).
3. **Align documentation.** Update `docs/design-system/tokens.md` to describe the actual token layer (raw Tailwind v4 utilities) and remove the "Compatibility Aliases" table. Update `docs/design-system/recipes.md` so HTML snippets use raw utilities. Update `docs/agents/design-system.md` to drop the `surface-container-*` references and point at the workspace pattern.
4. **Verify.** Run the existing site Nx targets (`pnpm nx run site:lint`, `pnpm nx run site:typecheck`, `pnpm nx run site:test`, `pnpm nx run site:build`) and the existing `pnpm nx run site-e2e:e2e` smoke suite. Manually verify `/en/`, `/es/`, and `/docs/` in light and dark mode.

## Component Guidance

### Sticky header (`landing-page.astro` `<nav>`)

```html
<nav
  class="sticky top-0 z-50 mx-auto flex w-full max-w-screen-2xl items-center justify-between border-b border-zinc-950/10 bg-white/80 px-4 py-3 backdrop-blur-md transition-colors duration-200 ease-in-out md:px-12 dark:border-white/10 dark:bg-zinc-950/80"
></nav>
```

### Primary CTA button

```html
<a
  href="{appHref}"
  class="rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white transition-all hover:bg-blue-700 active:scale-95"
>
  {content.headerCta}
</a>
```

### Secondary CTA button

```html
<a
  href="#methodology"
  class="w-full rounded-lg border border-zinc-950/20 px-6 py-2.5 text-center font-semibold transition-colors hover:bg-zinc-100 sm:w-auto md:px-8 md:py-3 md:font-bold dark:border-white/20 dark:hover:bg-zinc-800"
>
  {content.heroSecondary}
</a>
```

### Card / Panel

```html
<article
  class="overflow-hidden rounded-xl border border-zinc-950/10 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-900"
>
  <div class="bg-zinc-50 p-4 md:p-8 dark:bg-zinc-900/50">...</div>
</article>
```

### Status badge ("Active" / "Stale")

```html
<!-- Success -->
<span
  class="rounded bg-green-100 px-2 py-0.5 text-xs font-black text-green-700 uppercase dark:bg-green-500/20 dark:text-green-300"
>
  Active
</span>

<!-- Neutral -->
<span
  class="rounded bg-zinc-100 px-2 py-0.5 text-xs font-black tracking-wider text-zinc-500 uppercase dark:bg-zinc-800 dark:text-zinc-400"
>
  Stale
</span>
```

### Theme switcher

```html
<label
  for="theme-switch-input"
  tabindex="0"
  class="relative flex h-10 w-10 cursor-pointer items-center justify-center overflow-hidden rounded-md text-zinc-500 transition-colors outline-none hover:bg-zinc-100 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-blue-500 dark:focus-visible:outline-blue-500"
></label>
```

The sun/moon icons keep the same `amber` (light) and `zinc-50` (dark) colors but ride on `currentColor` instead of `text-yellow-400`/`text-white`.

### Locale switcher

```html
<div class="flex items-center gap-4 font-sans text-xs font-black tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
  <a
    href="/en/"
    class:list={[
      'no-underline hover:text-blue-600 dark:hover:text-blue-500',
      locale === 'en' && 'font-extrabold text-zinc-950 dark:text-zinc-50',
    ]}
  >
    EN
  </a>
  <span class="opacity-30">/</span>
  <a
    href="/es/"
    class:list={[
      'no-underline hover:text-blue-600 dark:hover:text-blue-500',
      locale === 'es' && 'font-extrabold text-zinc-950 dark:text-zinc-50',
    ]}
  >
    ES
  </a>
</div>
```

## Accessibility Requirements

- WCAG AA contrast for primary text, secondary text, buttons, and badges in both light and dark themes. The chosen `zinc-950` on `white`, `zinc-50` on `zinc-950`, `white` on `blue-600`, and `green-700` on `green-100` pairs all clear AA.
- Preserve visible keyboard focus states (`focus-visible:outline-2 focus-visible:outline-offset-2`) on links, buttons, language switcher entries, and the theme toggle.
- Do not rely on color alone for status. The existing "Active" / "Stale" badges already pair color with a text label.
- Keep the existing semantic HTML5 structure (`<main>`, `<nav>`, `<section>`, `<footer>`, `<article>`, `<header>`, `<h1>`–`<h5>`).
- `prefers-reduced-motion` continues to be honored through the existing `@media (prefers-reduced-motion: reduce)` block in `styles.base.css`.

## Verification

### Automated

```bash
pnpm nx run site:lint
pnpm nx run site:typecheck
pnpm nx run site:test
pnpm nx run site:build --skip-nx-cache
pnpm nx run site-e2e:e2e
```

### Static validation (grep guards)

```bash
# All of these must return zero matches.
rg "bg-surface|bg-on-surface|text-on-surface|text-on-surface-variant|border-outline-variant|border-outline|bg-primary-container|text-on-primary-container|bg-primary|text-primary|text-on-primary|bg-tertiary|text-tertiary|bg-tertiary-container|text-on-tertiary-container|border-primary|border-tertiary|text-outline|bg-error|focus-visible:outline-primary|--color-surface|--color-primary|--color-tertiary|--color-outline" apps/web/site/src
rg "text-sky|text-slate|bg-slate|border-slate" apps/web/site/src
rg "text-yellow-400" apps/web/site/src
```

`DESIGN.md` at the repo root keeps its legacy `var(--color-surface)` recommendations (it is the brand-level manuscript and is not part of this migration); only the design-system docs under `docs/design-system/**` and `docs/agents/design-system.md` are updated.

### Manual visual verification

- `/en/` and `/es/` in light mode: white page, blue CTAs, blue accent borders, green success badge, neutral surface ladder (zinc-50, zinc-100, white).
- `/en/` and `/es/` in dark mode: deep zinc-950 background, blue-500 accents, blue-400/40 borders, green-300 text on green-500/20 badge.
- `/docs/` in both modes: same zinc/blue palette as the landing; no stray `sky`/`slate` colors.
- Theme toggle: light → dark flips surfaces and accents without layout shift.
- Locale switcher: hover and active states remain legible in both modes.
- Mobile (375), tablet (768), desktop (1280): responsive structure unchanged.
- Browser console: zero errors, zero hydration warnings.

## Risks

| Risk                                                                        | Mitigation                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token-name changes drift into layout or content edits                       | Treat any non-color class change as out of scope. The grep guard catches accidental edits to the legacy vocabulary.                                                                                     |
| Dark-mode contrast fails for the new pairings                               | Verify the chosen zinc/blue/green/red pairs against the existing dark mode contract from `docs/design-system/recipes.md`. Fall back to `blue-400` / `zinc-300` if any pair fails AA.                    |
| `tokens.md` rewrite accidentally removes guidance the angular app relies on | The angular app uses raw Tailwind v4 utilities through `shared/ui` (no semantic tokens), so the rewrite is purely a doc accuracy fix. Update `shared/ui` consumers separately if they read `tokens.md`. |
| `DESIGN.md` keeps recommending `var(--color-surface)` etc.                  | Document the discrepancy in the spec validation. A follow-up spec can realign `DESIGN.md` once the Angular app's token contract is formalized.                                                          |
| Spec becomes a "redesign" instead of a migration                            | Hold the line on layout, copy, and section order. The only changes are color classes plus the documentation accuracy fixes.                                                                             |

## Alternatives Considered

1. **Reintroduce semantic tokens (`--color-bg`, `--color-panel`, `--color-accent`) in `@theme`.** Rejected: contradicts `52fba16 refactor(design-system): drop all custom semantic color tokens` and the working pattern in `shared/ui` and the ui-designer seed prototype. The Angular app does not depend on semantic tokens.
2. **Two-PR split (token audit + migration + docs).** Rejected: the user explicitly requested a single PR for this migration. The blast radius is bounded to the site + design-system docs, so the review surface stays manageable.
3. **Update `DESIGN.md` as part of this migration.** Deferred: `DESIGN.md` is the brand-level manuscript and its recommendations have drifted from the implementation for a long time. A separate brand-doc alignment spec is the right scope.

## Success Criteria

- `apps/web/site/src/**` contains zero legacy Material 3 utility classes (`bg-surface`, `text-on-surface`, `bg-primary`, etc.).
- `apps/web/site/src/**` contains zero hard-coded `sky-*` or `slate-*` colors.
- `/en/`, `/es/`, and `/docs/` render with the intended light and dark mode palette in a browser.
- `docs/design-system/tokens.md` describes raw Tailwind v4 utilities and removes the obsolete "Compatibility Aliases" table.
- `docs/design-system/recipes.md` HTML snippets use raw Tailwind v4 utilities.
- `docs/agents/design-system.md` no longer references the retired `surface-container-*` ladder or semantic tokens.
- `pnpm nx run site:lint`, `pnpm nx run site:typecheck`, `pnpm nx run site:test`, `pnpm nx run site:build`, and `pnpm nx run site-e2e:e2e` all pass.
- The existing `apps/web/site-e2e/src/site-smoke.spec.ts` passes without modification.
- `apps/web/site/astro.config.mjs`, the i18n config, the base layout SEO/OG block, the theme switcher script, and the SEO images all stay byte-identical.

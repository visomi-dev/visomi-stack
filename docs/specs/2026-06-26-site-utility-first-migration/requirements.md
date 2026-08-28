# Site Utility-First Migration — Requirements

## Context

The Themis public website at `apps/web/site` is the Astro app that serves the marketing landing page, the locale-prefixed English and Spanish variants (`/en/`, `/es/`), and the `/docs/` redirect page. Its component layer uses Astro templates, but its styling layer is consumed by Tailwind v4 + the workspace's `styles.base.css` token file. Both the Angular app and the Astro site are supposed to share the same token source.

The website's current styling was set by the [`2026-06-22-website-design-system-color-migration/`](./2026-06-22-website-design-system-color-migration/) spec, which migrated it to a Material 3 token vocabulary (`bg-surface`, `text-on-surface`, `bg-primary`, `bg-tertiary-container`, `border-outline-variant`, etc.). That spec is technically a color migration, not a redesign.

Two subsequent specs changed the token contract without updating the site:

1. [`2026-06-23-catalyst-pure-tokens-alignment/`](./2026-06-23-catalyst-pure-tokens-alignment/) retired the Material 3 tokens and replaced them with a documented Catalyst semantic set (`--color-bg`, `--color-panel`, `--color-accent`, etc.) plus Tailwind v4 utilities (`bg-bg`, `bg-panel`, `bg-accent`).
2. The merge commit `52fba16 refactor(design-system): drop all custom semantic color tokens` deleted the semantic tokens from `styles.base.css` and switched the `ui-*` utilities to read Tailwind's standard `zinc` colors directly. The Angular components were migrated to use raw Tailwind v4 utilities (`bg-blue-600`, `text-zinc-950`, `border-zinc-950/10`, etc.).

After those two changes, the website's Tailwind utility classes stop resolving. A class like `bg-surface` has no definition in `@theme`, no `--color-surface` custom property, and no `ui-surface` utility. The site renders with **no theme colors** — defaults to the browser's neutral palette — but the markup, layout, routing, content, and theme/locale switching all keep working because those don't depend on the broken classes.

The discrepancy is invisible until someone opens `/en/` or `/es/` in a browser. The smoke e2e test (`apps/web/site-e2e/src/site-smoke.spec.ts`) only checks that `main` and `h1` are visible; it does not assert any styling. The unit test (`site-content.spec.ts`) checks content strings. Neither catches the visual breakage.

## Goals

1. Migrate every legacy Material 3 utility class in `apps/web/site/src/**` to the equivalent raw Tailwind v4 utility so the public website renders with the intended light/dark theme.
2. Replace hard-coded `sky-*` and `slate-*` colors in `apps/web/site/src/pages/docs/index.astro` with the same `zinc`/`blue` palette the rest of the workspace uses.
3. Update `docs/design-system/tokens.md` to describe the actual token layer (raw Tailwind v4 utilities, no semantic shim) and remove the obsolete "Compatibility Aliases" table.
4. Update `docs/design-system/recipes.md` so every HTML snippet uses raw Tailwind v4 utilities instead of semantic tokens.
5. Update `docs/agents/design-system.md` so it points at the workspace's "raw utilities, no semantic shim" pattern and removes the "preserve the surface hierarchy" advice that referenced the retired `surface-container-*` ladder.
6. Preserve the page structure, section order, layout, responsive behavior, content, copy, routing, localization, theme switching, and locale switching exactly as they are today.

## Non-Goals

1. No redesign of the landing page. Section order, copy, layouts, and breakpoints stay byte-for-byte identical.
2. No new sections, removed sections, or reordered sections.
3. No new illustrations, icons, images, or decorative assets.
4. No new i18n strings or copy changes in English or Spanish.
5. No reintroduction of Material 3 token names or Catalyst semantic tokens in `styles.base.css`.
6. No changes to Angular components in `apps/web/app` or `shared/ui`. The migration is scoped to the Astro site + design system docs.
7. No new Nx targets or new ESLint rules.
8. No new dependencies.
9. No e2e test changes beyond keeping the existing `apps/web/site-e2e/src/site-smoke.spec.ts` green. Visual snapshot tests for the site are a follow-up spec.
10. No changes to `DESIGN.md` at the repo root. That manuscript is intentionally out of scope; aligning it with the new token contract is a separate spec.

## Decisions

### D1 — Raw Tailwind v4 utilities, no semantic shim

The site uses raw Tailwind v4 utility classes (`bg-white`, `bg-zinc-50`, `bg-blue-600`, `text-zinc-950`, `border-zinc-950/10`). We do **not** reintroduce semantic tokens in `@theme`. This matches the actual implementation pattern in:

- `apps/web/app/src/app/shared/ui/actions/button/button.ts` — uses `var(--color-blue-600)`, `var(--color-zinc-100)`, etc. directly.
- `apps/web/app/src/app/shared/ui/forms/switch/switch.ts` — uses `bg-accent` (a Tailwind v4 utility, not a semantic token) plus raw zinc utilities.
- `apps/web/ui-designer/src/prototypes/app-auth-shell.html` — the seed prototype uses raw `bg-white`, `bg-zinc-50`, `text-zinc-950`, `bg-blue-600`, etc.

The user explicitly rejected introducing semantic tokens as part of this work.

### D2 — Single PR

The user explicitly requested a single PR for this migration. The blast radius is bounded to:

- `apps/web/site/src/components/landing-page.astro` (459 lines, 71+ legacy classes)
- `apps/web/site/src/components/theme-switcher.astro` (42 lines, 6 legacy classes)
- `apps/web/site/src/components/locale-switcher.astro` (19 lines, 3 legacy classes)
- `apps/web/site/src/pages/docs/index.astro` (44 lines, hard-coded sky/slate)
- `docs/design-system/tokens.md` (95 lines, full rewrite of the token table)
- `docs/design-system/recipes.md` (289 lines, snippet updates)
- `docs/agents/design-system.md` (52 lines, surface hierarchy advice removal)

Total diff stays under 1000 changed lines because most edits are class replacements on existing lines. The single-PR shape matches the user's stated preference and the bounded scope.

### D3 — Don't touch `DESIGN.md`

`DESIGN.md` is the brand-level manuscript at the repo root. Its color recommendations (`var(--color-surface)`, `var(--color-primary)`, Material 3 palette names) have been stale since the Angular app switched to Catalyst tokens. Aligning it is out of scope for this spec and is deferred to a follow-up.

### D4 — Don't touch `apps/web/app` or `shared/ui`

The Angular app already uses raw Tailwind v4 utilities. The site migration is independent of any Angular change.

### D5 — Keep `styles.base.css` unchanged

`styles.base.css` already declares fonts, radii, shadows, and the `ui-*` utilities. The site consumes those utilities indirectly (via the `ui-focus-ring` and `ui-touch-target` references in its markup). No new tokens or utilities are needed.

## Context

### Tone

- All prose, identifiers, commit messages, and PR descriptions stay in English per workspace rules.
- The website's user-facing copy (English and Spanish) is unchanged.

### Stack

- Astro 5 (matches `apps/web/site`)
- Tailwind v4 (matches `apps/web/site`, `apps/web/app`, `apps/web/ui-designer`)
- `@tailwindcss/vite` plugin (matches `apps/web/site`)
- Node 24+ (matches the rest of the workspace)
- No new dependencies

### Existing patterns to follow

- The raw utility pattern from `apps/web/ui-designer/src/prototypes/app-auth-shell.html` is the canonical reference.
- The `shared/ui` Button tone API uses `--btn-bg` / `--btn-border` custom properties set as inline Tailwind arbitrary values (`[--btn-bg:var(--color-blue-600)]`) — same pattern works for any "one-off token" the site needs.
- Dark mode flips `html.dark` on the document element; the `:where(.dark, .dark *)` custom variant in `global.css` already covers it.

### Open questions

None at spec time.

# Themis UI Tokens

The Themis UI foundation uses **raw Tailwind v4 utilities** directly. There are no custom semantic color tokens (`--color-bg`, `--color-panel`, `--color-accent`) defined in `styles.base.css`. Components, templates, prototypes, and the public site compose their visual layer with the standard Tailwind v4 palette (`zinc-*` for neutrals, `blue-*` for accent, `green-*` for success, `red-*` for danger).

The `styles.base.css` file at the workspace root declares fonts, radii, shadows, and the reusable `ui-*` utility classes (`ui-focus-ring`, `ui-panel`, `ui-panel-raised`, `ui-touch-target`, `ui-text-rhythm`). The `ui-panel` family internally reads Tailwind's standard zinc utilities, so dark mode flips automatically when the `<html>` element carries the `dark` class.

## Surface Ladder

Surfaces stack with subtle tonal shifts. The light ladder climbs from a white canvas through progressively darker zinc tones; the dark ladder sinks the canvas and rises through progressively lighter zinc tones.

| Role                       | Light         | Dark                  |
| -------------------------- | ------------- | --------------------- |
| Page canvas                | `bg-white`    | `dark:bg-zinc-950`    |
| Section band / quiet panel | `bg-zinc-50`  | `dark:bg-zinc-900`    |
| Nested panel / raised card | `bg-zinc-100` | `dark:bg-zinc-800`    |
| Decorative accent surface  | `bg-zinc-200` | `dark:bg-zinc-700`    |
| Translucent overlay header | `bg-white/80` | `dark:bg-zinc-950/80` |

## Text Ladder

| Role              | Light            | Dark                  |
| ----------------- | ---------------- | --------------------- |
| Primary text      | `text-zinc-950`  | `dark:text-zinc-50`   |
| Secondary text    | `text-zinc-500`  | `dark:text-zinc-400`  |
| On accent fill    | `text-white`     | `text-white`          |
| On success fill   | `text-green-700` | `dark:text-green-300` |
| Destructive label | `text-red-600`   | `dark:text-red-400`   |

## Accent Palette

`blue-600` is the Themis brand accent in light mode. Dark mode shifts to `blue-500` for AA contrast on the zinc-950 canvas.

| Role                        | Light                | Dark                      |
| --------------------------- | -------------------- | ------------------------- |
| Primary action fill         | `bg-blue-600`        | `dark:bg-blue-500`        |
| Primary action fill (hover) | `hover:bg-blue-700`  | `dark:hover:bg-blue-400`  |
| Primary text accent         | `text-blue-600`      | `dark:text-blue-500`      |
| Soft accent fill            | `bg-blue-600/10`     | `dark:bg-blue-400/10`     |
| Stronger soft fill          | `bg-blue-600/20`     | `dark:bg-blue-400/20`     |
| Accent border               | `border-blue-600`    | `dark:border-blue-500`    |
| Soft accent border          | `border-blue-600/40` | `dark:border-blue-400/40` |
| Soft accent border (rail)   | `border-blue-600/30` | `dark:border-blue-400/30` |
| Focus outline               | `outline-blue-600`   | `dark:outline-blue-500`   |

## Status Palette

| Role                       | Light                 | Dark                       |
| -------------------------- | --------------------- | -------------------------- |
| Success fill (badge)       | `bg-green-100`        | `dark:bg-green-500/20`     |
| Success text               | `text-green-700`      | `dark:text-green-300`      |
| Success accent             | `text-green-700`      | `dark:text-green-400`      |
| Success soft fill          | `bg-green-600/20`     | `dark:bg-green-400/20`     |
| Success soft border (rail) | `border-green-600/40` | `dark:border-green-400/40` |
| Danger / error fill        | `bg-red-600`          | `dark:bg-red-500`          |
| Danger text                | `text-red-600`        | `dark:text-red-400`        |
| Amber icon (theme switch)  | `text-amber-500`      | `dark:text-amber-400`      |

## Borders

| Role             | Light                | Dark                   |
| ---------------- | -------------------- | ---------------------- |
| Quiet divider    | `border-zinc-950/10` | `dark:border-white/10` |
| Standard divider | `border-zinc-950/15` | `dark:border-white/15` |
| Visible border   | `border-zinc-950/20` | `dark:border-white/20` |

The `ui-panel` and `ui-panel-raised` utility classes apply `border-zinc-950/5` (light) and `dark:border-white/5` (dark) by default, mirroring Tailwind's standard subtle-border pattern.

## Soft Fills

Tailwind opacity utilities compose soft fills inline against any surface:

```html
<!-- Soft accent fill over a zinc surface -->
<div class="bg-blue-600/10 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300">Soft accent surface</div>
```

```html
<!-- Equivalent raw CSS, if you ever need it outside Tailwind -->
<div style="background: color-mix(in srgb, var(--color-blue-600) 10%, transparent)">Soft accent surface</div>
```

The `color-mix` form is documented for completeness; the workspace default is to reach for Tailwind opacity utilities first.

## Radius Tokens

| Token              | Value     | Use                |
| ------------------ | --------- | ------------------ |
| `--radius-sm`      | `0.5rem`  | Small controls     |
| `--radius-control` | `0.5rem`  | Inputs and buttons |
| `--radius-panel`   | `0.75rem` | Cards and panels   |

The Tailwind v4 `rounded-sm` / `rounded-md` / `rounded-lg` / `rounded-xl` families map onto these tokens through the `@theme` block in `styles.base.css`.

## Shadow Tokens

| Token            | Use                        |
| ---------------- | -------------------------- |
| `--shadow-sm`    | Cards above the canvas     |
| `--shadow-md`    | Popovers, command palettes |
| `--shadow-panel` | Dialogs, elevated panels   |

Tailwind v4 `shadow-sm`, `shadow-md`, and `shadow-2xl` map onto these tokens.

## Font Tokens

| Token            | Family         | Use                 |
| ---------------- | -------------- | ------------------- |
| `--font-sans`    | Inter          | Body text           |
| `--font-heading` | Manrope        | Display, headings   |
| `--font-mono`    | JetBrains Mono | IDs, commands, logs |

Components reach for these through Tailwind's `font-sans`, `font-heading`, and `font-mono` utilities (wired through the `@theme` block).

## Reusable Utilities

- `ui-focus-ring`: visible keyboard focus treatment driven by Tailwind's `blue-500` / `blue-600` outline halo.
- `ui-panel`: default panel surface with a `border-zinc-950/5` border.
- `ui-panel-raised`: elevated surface with shadow and a `border-zinc-950/5` border.
- `ui-touch-target`: 44px minimum interactive target.
- `ui-text-rhythm`: readable paragraph rhythm for long-form text.

## Dark Mode

Dark mode applies when the `<html>` element carries the `dark` class:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

Components and templates use the `dark:` variant on every utility that differs between modes (`dark:bg-zinc-950`, `dark:text-zinc-50`, `dark:border-white/10`, etc.). The shared `ui-*` utilities also respond to `html.dark` through their internal `html.dark &` selectors.

## Reference Components

- `apps/web/app/src/app/shared/ui/actions/button/button.ts` consumes Tailwind v4 colors directly via inline arbitrary values (`[--btn-bg:var(--color-blue-600)]`). Solid buttons follow the Catalyst optical-border pattern with `--btn-bg` and `--btn-border` custom properties.
- `apps/web/ui-designer/src/prototypes/app-auth-shell.html` is the canonical reference for composing raw Tailwind v4 utilities in a hand-authored HTML surface.
- `apps/web/site/src/components/landing-page.astro` is the canonical reference for raw Tailwind v4 utilities in Astro templates.

## Out Of Scope

- Reintroducing semantic color tokens (`--color-bg`, `--color-panel`, `--color-accent`, etc.) in `@theme`. The workspace explicitly retired this layer in the catalyst pure-tokens alignment work; reintroducing it would contradict the Angular app and the ui-designer prototypes.
- A custom Themis palette. The workspace uses the standard Tailwind v4 `zinc`/`blue`/`green`/`red`/`amber` scale. A bespoke palette is a follow-up decision.
- Translating this contract into a separate brand skill. The Themis brand contract lives in this file and in `DESIGN.md`; no Anthropic-derived brand skill is vendored.

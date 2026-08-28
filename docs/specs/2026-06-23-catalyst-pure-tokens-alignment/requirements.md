# Catalyst Pure Tokens Alignment — Requirements

## Context

The previous spec, [`2026-06-22-catalyst-angular-ui-foundation/`](./2026-06-22-catalyst-angular-ui-foundation/), introduced Catalyst-inspired Angular primitives under `apps/web/app/src/app/shared/ui`. The visual foundation was implemented as a **hybrid**:

- The actual `@theme` tokens in `styles.base.css` are Material 3 names (`--color-surface`, `--color-surface-container-low`, `--color-primary`, `--color-on-primary`, `--color-tertiary`, etc.) with a Material 3 blue palette (`#1b4490`).
- A thin Catalyst-style semantic layer (`--color-bg`, `--color-panel`, `--color-accent`, `--color-ring`) is aliased **on top of** the Material 3 values at the bottom of `styles.base.css`.
- Components like `Button` use Catalyst-style class names (`bg-accent`, `text-accent-fg`, `bg-panel-raised`) but the resolved colors still come from Material 3.
- The Open Design / Claude Design package at `~/.od/projects/ds-themis-is-a-developer-native-design-system/` uses a separate, third palette (`--tm-bg`, `--tm-primary` = `#3b82f6`, `--tm-ai` = `#8b5cf6`) that is not shared with the app.

The user prefers Catalyst's visual language and wants the Themis app to use **pure Catalyst tokens, styles, and Tailwind patterns** end-to-end, with only a blue brand adjustment. The Open Design package must be aligned to the same direction so it does not drift from the app.

## Goals

1. Replace the Material 3 token block in `styles.base.css` with a **pure Catalyst `@theme` token block** that uses Tailwind v4 standard color names (`zinc-*` for neutrals, `blue-*` for accent) directly.
2. Drop the dual Material 3 + Catalyst naming. The only public token names exposed in `styles.base.css` should be the Catalyst semantic set: `--color-bg`, `--color-panel`, `--color-panel-raised`, `--color-fg`, `--color-muted-fg`, `--color-accent`, `--color-accent-fg`, `--color-danger`, `--color-ring`, plus Catalyst-style radius, font, and shadow tokens.
3. Use Tailwind's `blue-600` (`#2563eb`) as the Themis brand accent, matching the standard Catalyst `blue` color class.
4. Update `shared/ui` components to consume the new tokens directly and to adopt Catalyst visual patterns the previous spec did not port: optical borders via `before/after` pseudo-elements, `--btn-bg` / `--btn-border` / `--btn-icon` custom properties, `data-*` state attributes, and inset highlight shadows.
5. Update the Open Design package (`~/.od/projects/ds-themis-is-a-developer-native-design-system/`) so its `colors_and_type.css`, `DESIGN.md`, `SKILL.md`, `ui_kits/app/`, and `preview/` files reflect the same Catalyst + Themis-blue direction. The package stops exposing a competing `--tm-*` palette.
6. Keep Tailwind v4, Angular 22, and signal-based component APIs untouched. The change is purely about token values, token names, and Catalyst visual patterns.
7. Preserve accessibility: focus rings, contrast, touch targets, and ARIA semantics must remain WCAG AA compliant in light and dark modes.

## Non-Goals

1. Do not redesign routes or screens in this spec. The Catalyst Foundation and Redesign specs already shipped the app on the new primitives; this spec is a token-level alignment of those primitives.
2. Do not introduce a second brand color (no separate AI/violet accent, no indigo operational accent). The Themis AI signal is `muted-fg` plus a `data-ai` attribute for now; future specs can re-introduce an explicit AI palette if needed.
3. Do not port every Catalyst TSX file literally. Only port the patterns that materially improve the current Themis primitives (Button, LinkButton, IconButton, Input, Field, Sidebar, Alert, Badge).
4. Do not move components out of `apps/web/app/src/app/shared/ui` into `libs/ui`. That is a separate refactor.
5. Do not touch the Astro `apps/web/site` app. It does not consume the app tokens and is out of scope.

## Token Mapping (Current → Catalyst)

| Current Themis token (Material 3)            | New Catalyst token (Tailwind v4)            | Tailwind utility                        |
| -------------------------------------------- | ------------------------------------------- | --------------------------------------- |
| `--color-background`                         | `--color-bg`                                | `bg-bg`                                 |
| `--color-surface-container-low`              | `--color-panel`                             | `bg-panel`                              |
| `--color-surface-container-high`             | `--color-panel-raised`                      | `bg-panel-raised`                       |
| `--color-on-surface`                         | `--color-fg`                                | `text-fg`                               |
| `--color-on-surface-variant`                 | `--color-muted-fg`                          | `text-muted-fg`                         |
| `--color-primary` (Material 3 blue)          | `--color-accent` (Tailwind `blue-600`)      | `bg-accent`, `text-accent`              |
| `--color-on-primary`                         | `--color-accent-fg`                         | `text-accent-fg`                        |
| `--color-error`                              | `--color-danger`                            | `bg-danger`, `text-danger`              |
| `--color-on-error`                           | `--color-danger-fg`                         | `text-danger-fg`                        |
| `--color-primary` (focus ring)               | `--color-ring`                              | `--color-ring` (used by utility)        |
| `--color-outline`, `--color-outline-variant` | `--color-border`, `--color-border-subtle`   | `border-border`, `border-border-subtle` |
| `--color-surface-dim` (dark mode)            | `--color-panel` (dark `zinc-900`)           | `dark:bg-panel`                         |
| `--color-primary-container`                  | removed — use `bg-accent/10` for soft fills | `bg-accent/10`                          |
| `--color-on-primary-container`               | removed — use `text-accent`                 | `text-accent`                           |
| `--color-tertiary`, `--color-success`        | removed — use `data-tone` attribute + style | `data-[tone=warning]:bg-amber-*`        |

The following Material 3 tokens are **removed** and replaced by either Tailwind utilities, Catalyst custom properties, or component-level `data-*` selectors:

- `--color-on-primary-container`
- `--color-primary-container`
- `--color-tertiary`, `--color-tertiary-container`, `--color-on-tertiary`, `--color-on-tertiary-container`
- `--color-secondary`, `--color-secondary-container`, `--color-on-secondary`, `--color-on-secondary-container`
- `--color-error-container`, `--color-on-error-container`
- `--color-success`, `--color-on-success`, `--color-success-container`, `--color-on-success-container`
- `--color-inverse-surface`, `--color-inverse-on-surface`
- All `*-fixed`, `*-fixed-dim`, `*-dim` variants

The following Material 3 tokens become **Catalyst custom properties** and are still defined in `@theme` for `ui-*` utilities:

- `--color-ring` (focus ring base)
- `--color-border` (subtle borders)
- `--shadow-panel` (elevated panels)

## Component Pattern Changes

| Component      | Current                                   | New Catalyst pattern                                                                                                                                                                                                              |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`       | `bg-accent text-accent-fg` direct classes | `--btn-bg` / `--btn-border` custom properties; optical border via `before:bg-(--btn-border)`; highlight shadow via `after:shadow-[inset_0_1px_--theme(--color-white/15%)]`; hover via `data-hover:after:bg-(--btn-hover-overlay)` |
| `LinkButton`   | Same as `Button`                          | Same as `Button`                                                                                                                                                                                                                  |
| `IconButton`   | Solid tone fill                           | Catalyst color names (`zinc`, `blue`, `red`); uses `--btn-bg/border/icon`                                                                                                                                                         |
| `Input`        | `border-outline/30`                       | `border-border data-invalid:border-danger focus:border-accent`                                                                                                                                                                    |
| `Badge`        | `bg-primary-container/40`                 | `data-tone` selector with `bg-accent/10 text-accent` and other Tailwind tones                                                                                                                                                     |
| `Alert`        | Material 3 container colors               | `data-tone` selector with `border-accent/20 bg-accent/5 text-fg`                                                                                                                                                                  |
| `Sidebar` item | `bg-primary-container/20` on active       | `data-current:bg-accent/10 data-current:text-accent`                                                                                                                                                                              |
| `Field`        | Explicit description slots                | `data-invalid:data-[invalid]` attribute plumbing for ARIA                                                                                                                                                                         |

## External Package Changes

`~/.od/projects/ds-themis-is-a-developer-native-design-system/`:

- `colors_and_type.css` — replace the `--tm-*` palette with the new Catalyst token set, exposing them as a `themis-tokens.css` shim. The original Tailwind `blue-600` / `zinc-*` utilities remain the implementation source of truth.
- `DESIGN.md` — rewrite the color, typography, and component sections to describe the Catalyst-aligned visual language. Drop AI-violet as a primary signal.
- `SKILL.md` — update the description and the "How to use" section to point at the Catalyst token file.
- `ui_kits/app/components/*.jsx` — port the React components to use the new tokens. Drop the AI-violet chip style in favor of a Catalyst-blue AI marker.
- `ui_kits/app/index.html` — keep loading the renamed `colors_and_type.css` from the new path.
- `preview/*.html` — update palette, theme, and component preview cards to reflect the new tokens. The brand-assets preview keeps its "no real source assets" status.
- `provenance.md` — add a note that the package was realigned to Catalyst on 2026-06-23.
- `README.md` — update the package overview, the preview manifest, and the "Reuse Workflow" to point at the new token file.

## Light/Dark Color Pairs

Light mode (default `:root`):

| Token                   | Value (Tailwind) |
| ----------------------- | ---------------- |
| `--color-bg`            | `white`          |
| `--color-panel`         | `zinc-50`        |
| `--color-panel-raised`  | `zinc-100`       |
| `--color-fg`            | `zinc-950`       |
| `--color-muted-fg`      | `zinc-500`       |
| `--color-accent`        | `blue-600`       |
| `--color-accent-fg`     | `white`          |
| `--color-danger`        | `red-600`        |
| `--color-ring`          | `blue-600`       |
| `--color-border`        | `zinc-950/10`    |
| `--color-border-subtle` | `zinc-950/5`     |

Dark mode (`html.dark`):

| Token                   | Value (Tailwind) |
| ----------------------- | ---------------- |
| `--color-bg`            | `zinc-950`       |
| `--color-panel`         | `zinc-900`       |
| `--color-panel-raised`  | `zinc-800`       |
| `--color-fg`            | `zinc-50`        |
| `--color-muted-fg`      | `zinc-400`       |
| `--color-accent`        | `blue-500`       |
| `--color-accent-fg`     | `white`          |
| `--color-danger`        | `red-500`        |
| `--color-ring`          | `blue-500`       |
| `--color-border`        | `white/10`       |
| `--color-border-subtle` | `white/5`        |

## Scope Summary

- **In scope:** `styles.base.css`, `apps/web/app/src/app/shared/ui/**`, `docs/design-system/tokens.md`, `docs/design-system/components.md`, `docs/design-system/recipes.md`, the Open Design package files at `~/.od/projects/ds-themis-is-a-developer-native-design-system/**`.
- **Out of scope:** routes, services, forms data layer, marketing site, AI/violet accent, `libs/ui` extraction, dark mode for `html.dark` on legacy PrimeNG pages (PrimeNG is already removed in the app).

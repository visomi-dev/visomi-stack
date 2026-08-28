# Website Design System Color Migration — Software Design Document

## Decision

Refactor the existing Themis public website as a design-system color migration only. The implementation will replace the old website color palette with the current Themis design system tokens while preserving the existing page structure, section order, layout, responsive behavior, content, routing, localization, and theme switching.

This is not a redesign. The website should remain recognizably the same page with an upgraded visual language: cleaner light surfaces, blue primary actions, cooler slate structure, and restrained high-contrast dark mode.

## Scope

In scope:

- Global website token values used by `apps/web/site`.
- Tailwind color utility usage in `apps/web/site/src/components/landing-page.astro`.
- Tailwind color utility usage in website shell components such as `locale-switcher.astro`, `theme-switcher.astro`, and `base-layout.astro` only where needed to align states with the new tokens.
- Background, surface, text, muted text, border, divider, button, link, badge, status, hover, focus, and decorative accent colors.
- Light and dark mode color mappings.

Out of scope:

- New sections, removed sections, or reordered sections.
- Copy changes in English or Spanish.
- Route changes for `/`, `/en`, `/es`, `/docs`, or `/app` links.
- Navigation, language switching, or theme switching behavior changes.
- Layout, spacing, typography scale, responsive breakpoints, and component structure changes unless a class is strictly color-only.
- New illustrations, images, icons, or decorative assets.

## Source Of Truth

Use the Themis design system token references as the color source of truth:

- `docs/design/design-system-reference.md`
- `styles.base.css`
- `docs/design-system/tokens.md`

The website must consume the token names already available through Tailwind, not introduce a parallel page-local color system.

## Token Contract

The migration should align `styles.base.css` with the new clean blue-and-white Themis palette.

Light mode mapping:

| Token                                    | Value     | Usage                                  |
| ---------------------------------------- | --------- | -------------------------------------- |
| `--color-primary`                        | `#385ca9` | Brand, primary actions, active accents |
| `--color-on-primary`                     | `#f9f8ff` | Text/icons on primary actions          |
| `--color-primary-container`              | `#a8c0ff` | Soft primary fills and selected states |
| `--color-on-primary-container`           | `#063884` | Text on soft primary fills             |
| `--color-tertiary`                       | `#006d4e` | Success/positive secondary accents     |
| `--color-on-tertiary`                    | `#e5fff0` | Text/icons on tertiary fills           |
| `--color-tertiary-container`             | `#8dfece` | Soft success/status fills              |
| `--color-on-tertiary-container`          | `#006146` | Text on soft success/status fills      |
| `--color-background` / `--color-surface` | `#faf8ff` | Page background and base surfaces      |
| `--color-surface-container-lowest`       | `#ffffff` | Highest-contrast cards and panels      |
| `--color-surface-container-low`          | `#f2f3ff` | Section bands and quiet panels         |
| `--color-surface-container`              | `#e9edff` | Nested panels                          |
| `--color-surface-container-high`         | `#e1e7ff` | Raised or active surface treatments    |
| `--color-surface-container-highest`      | `#d9e2ff` | Highest tonal surface                  |
| `--color-on-surface`                     | `#213156` | Primary text                           |
| `--color-on-surface-variant`             | `#4e5e86` | Muted text and secondary labels        |
| `--color-outline`                        | `#6a7aa3` | Visible borders and outlines           |
| `--color-outline-variant`                | `#a1b1dd` | Subtle dividers and ghost borders      |
| `--color-error`                          | `#ac3434` | Error or alert accents                 |

Dark mode mapping:

| Token                                    | Value     | Usage                                  |
| ---------------------------------------- | --------- | -------------------------------------- |
| `--color-primary`                        | `#7bd0ff` | Brand, primary actions, active accents |
| `--color-on-primary`                     | `#004560` | Text/icons on primary actions          |
| `--color-primary-container`              | `#004c69` | Soft primary fills and selected states |
| `--color-on-primary-container`           | `#97d8ff` | Text on soft primary fills             |
| `--color-tertiary`                       | `#c6fff3` | Success/positive secondary accents     |
| `--color-on-tertiary`                    | `#003827` | Text/icons on tertiary fills           |
| `--color-tertiary-container`             | `#005e54` | Soft success/status fills              |
| `--color-on-tertiary-container`          | `#65fde6` | Text on soft success/status fills      |
| `--color-background` / `--color-surface` | `#070d1f` | Page background and base surfaces      |
| `--color-surface-container-lowest`       | `#000000` | Deepest card/background contrast       |
| `--color-surface-container-low`          | `#09122b` | Section bands and quiet panels         |
| `--color-surface-container`              | `#0a1839` | Nested panels                          |
| `--color-surface-container-high`         | `#0b1d48` | Raised or active surface treatments    |
| `--color-surface-container-highest`      | `#0a2257` | Highest tonal surface                  |
| `--color-on-surface`                     | `#dfe4ff` | Primary text                           |
| `--color-on-surface-variant`             | `#96a9e6` | Muted text and secondary labels        |
| `--color-outline`                        | `#6073ad` | Visible borders and outlines           |
| `--color-outline-variant`                | `#32457c` | Subtle dividers and ghost borders      |
| `--color-error`                          | `#ee7d77` | Error or alert accents                 |

Derived component tokens must continue to map to the canonical tokens:

- `--color-bg` → `--color-background`
- `--color-panel` → `--color-surface-container-low`
- `--color-panel-raised` → `--color-surface-container-high`
- `--color-fg` → `--color-on-surface`
- `--color-muted-fg` → `--color-on-surface-variant`
- `--color-accent` → `--color-primary`
- `--color-accent-fg` → `--color-on-primary`
- `--color-danger` → `--color-error`
- `--color-ring` → `--color-primary`

## Implementation Strategy

1. Update the global token values first so existing semantic Tailwind utilities inherit the new palette.
2. Review website components for hard-coded or legacy color utilities such as `slate`, opacity-heavy dark overrides, or dim accent aliases.
3. Replace visual-only color classes with semantic token utilities such as `bg-surface`, `bg-surface-container-low`, `text-on-surface`, `text-on-surface-variant`, `border-outline-variant`, `bg-primary`, `text-primary`, and `bg-tertiary-container`.
4. Preserve all non-color utilities exactly unless a class combines color and opacity in a way that must be adjusted for contrast.
5. Keep hover and focus states token-based and consistent across light/dark themes.
6. Verify the same structure renders for English and Spanish routes.

## Component Guidance

Navigation:

- Use `bg-surface` or a transparent `bg-surface/80` treatment for the sticky header.
- Use `text-primary` for the brand mark in both themes unless contrast requires `text-on-surface` in a specific state.
- Keep CTA buttons blue through `bg-primary text-on-primary`.

Hero and content sections:

- Use `text-on-surface` for headings and key labels.
- Use `text-on-surface-variant` for body copy and secondary labels.
- Use `bg-surface` for page background and `bg-surface-container-low` for tonal section bands.

Panels and cards:

- Use `bg-surface-container-lowest` for white/light cards.
- Use `bg-surface-container-low`, `bg-surface-container`, and `bg-surface-container-high` for nested panels and progress backgrounds.
- Use `border-outline-variant` at low opacity for subtle borders, and `border-outline` only when stronger separation is needed.

Actions and links:

- Primary actions use `bg-primary text-on-primary` with token-based hover states.
- Secondary actions use `border-outline text-on-surface` and surface-container hover fills.
- Links use `text-on-surface-variant` with `hover:text-primary` or `hover:text-on-surface` depending on context.

Statuses and accents:

- Active/success status uses `bg-tertiary-container text-on-tertiary-container` in light mode and a readable dark equivalent from tertiary tokens.
- Error or attention dots use `bg-error`.
- Decorative accents should prefer `primary`, `primary-container`, `tertiary`, or surface hierarchy tokens rather than arbitrary color families.

## Accessibility Requirements

- Maintain WCAG AA contrast for primary text, secondary text, buttons, and badges in both light and dark themes.
- Preserve visible keyboard focus states for links, buttons, theme switching, and language switching.
- Do not rely on color alone for status where existing text labels already provide context.
- Keep the current semantic HTML structure unchanged.

## Verification

Run website checks through Nx:

- `pnpm nx lint site`
- `pnpm nx test site`
- `pnpm nx build site`

Manual visual verification:

- Confirm `/`, `/en`, and `/es` keep the same content and section order.
- Confirm light mode uses bright white/cool slate surfaces with blue primary actions.
- Confirm dark mode remains high-contrast and restrained.
- Confirm language switching still changes locale routes.
- Confirm theme switching still toggles the `dark` class and persists behavior.
- Confirm responsive behavior is unchanged at mobile, tablet, and desktop widths.

## Risks

| Risk                                                          | Mitigation                                                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token updates affect both site and app unexpectedly           | Limit implementation review to shared token changes already intended by the design system and verify app-sensitive aliases remain mapped correctly |
| Existing opacity combinations reduce contrast with new colors | Inspect low-opacity borders, muted labels, buttons, and badges in both themes                                                                      |
| Dark mode inherits old ad hoc overrides                       | Replace hard-coded dark color overrides with semantic token utilities where possible                                                               |
| Visual migration drifts into layout redesign                  | Treat non-color class changes as out of scope unless required for contrast or focus visibility                                                     |
| Localization or route behavior changes accidentally           | Avoid content and routing edits; manually verify English and Spanish pages                                                                         |

## Success Criteria

- Website color styling uses the new Themis design system palette.
- Light mode feels cleaner, brighter, and more blue-and-white without changing layout or content.
- Dark mode remains clean, restrained, and high contrast.
- Existing language switching and theme switching behavior is preserved.
- Existing responsive structure is preserved.
- No new sections, copy, routes, assets, or interaction changes are introduced.

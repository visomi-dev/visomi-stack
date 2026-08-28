# Catalyst Pure Tokens Alignment — Validation Plan

## Status

Pending. Will be updated after PR1 and PR2 land.

## Static Validation (per PR)

```text
pnpm nx run app:lint                                → expected: 0 errors, 0 new warnings
pnpm nx run app:vite:test                           → expected: 35+ tests pass, 0 regressions
pnpm nx run app:build --skip-nx-cache               → expected: builds dist/apps/web/app (browser + server bundles)
```

## Token Validation

- `rg "color-surface-container|color-primary-container|color-tertiary|color-on-primary-container|color-on-tertiary" apps/web/app/src` returns zero matches.
- `rg "color-surface-container|color-primary-container|color-tertiary|--tm-" apps/web/app/src` returns zero matches.
- `rg "border-outline|bg-primary-container/20|hover:bg-surface-container-highest" apps/web/app/src/app/shared/ui` returns zero matches.
- `styles.base.css` defines only Catalyst-style tokens in `@theme`: `bg`, `panel`, `panel-raised`, `fg`, `muted-fg`, `accent`, `accent-fg`, `danger`, `danger-fg`, `ring`, `border`, `border-subtle`, plus `font-*`, `radius-*`, and `shadow-panel`.
- `html.dark` block defines the dark mode equivalents of the same set.
- The four `@utility` blocks (`ui-focus-ring`, `ui-panel`, `ui-panel-raised`, `ui-touch-target`, `ui-text-rhythm`) all reference only Catalyst tokens.

## Component Pattern Validation

- `Button`, `LinkButton`, `IconButton`, `Input`, `Badge`, `Alert`, `Sidebar`, `Switch`, `Checkbox`, `RadioGroup`, `RadioCard`, `PinInput`, `Select`, `Textarea`, `Dropdown`, `Listbox`, `Combobox`, `Avatar`, `Container`, `AuthLayout`, `PageLoader`, `Loader`, `Topbar`, `Link` all consume the new tokens through Tailwind utilities or `data-*` selectors.
- No `bg-primary-container/40`, `bg-tertiary-container/20`, `border-outline/30`, `color-on-primary-container` references remain in `shared/ui`.
- Button tone API uses Catalyst color names: `zinc`, `blue`, `red`, `green`, `amber`. Legacy `accent`/`danger`/`success`/`warning` names are removed.
- Badge tone API uses `data-tone` attributes that map to Tailwind color utilities.

## Accessibility Validation

- Focus rings are visible in light and dark mode (`ui-focus-ring` still resolves to `var(--color-ring)`).
- Touch targets remain at least 44×44 px where applicable (`ui-touch-target`).
- Color contrast: `blue-600` on `white` ≥ 4.5:1; `blue-500` on `zinc-950` ≥ 4.5:1.
- ARIA: `data-invalid` plumbing keeps `aria-invalid` correct on `Field`, `Input`, `Select`, `Textarea`, `PinInput`.
- Run `pnpm nx run app:vite:test` and any Playwright accessibility specs to confirm no regression.

## External Package Validation

- `~/.od/projects/ds-themis-is-a-developer-native-design-system/colors_and_type.css` no longer exposes a `--tm-*` palette.
- `ui_kits/app/index.html` renders in a browser with blue accent and zinc surfaces.
- The four `preview/colors-*.html` files show the new palette.
- `DESIGN.md`, `SKILL.md`, `README.md`, `provenance.md` all reference the new tokens and the realignment date.

## Code Quality Checks

- No `primeng/*` imports in `shared/ui`. — verified by `rg "primeng" apps/web/app/src/app/shared/ui` returning zero matches.
- No React, Headless UI, or Motion React dependencies. — verified by `rg "headlessui|@headlessui|from 'react'" apps/web/app` returning zero matches.
- No inline dynamic `import()` outside `Deps`. — already verified by the foundation spec.
- No `@Input()`, `@Output()`, `@HostBinding()`, or `@HostListener()`. — verified by `rg "@Input\(\)|@Output\(\)|@HostBinding\(\)|@HostListener\(\)" apps/web/app/src/app/shared/ui` returning zero matches.
- No `standalone: true` in component decorators. — verified by `rg "standalone: true" apps/web/app/src/app/shared/ui` returning zero matches.
- No `ngClass`, `ngStyle`, `*ngIf`, `*ngFor`, `*ngSwitch`. — already verified by the foundation spec.
- Effects declared as `readonly` properties. — already verified.

## Visual Check (per PR)

Light mode:

- App background is `zinc-50` (`bg-bg`).
- Panels are `zinc-50` (`bg-panel`).
- Raised panels are `zinc-100` (`bg-panel-raised`).
- Primary buttons are `blue-600` with `white` text.
- Focus rings are `blue-600` with the existing `ui-focus-ring` halo.

Dark mode:

- App background is `zinc-950`.
- Panels are `zinc-900`.
- Raised panels are `zinc-800`.
- Primary buttons are `blue-500`.
- Focus rings are `blue-500`.

## Completion Checklist

- PR1 token foundation lands. `styles.base.css`, `tokens.md`, `components.md`, `recipes.md` reflect the new tokens.
- PR2 component pattern alignment lands. `shared/ui` consumes the new tokens and the new `data-*` patterns.
- External package files are updated.
- `apps/web/app/version.json` is bumped to `1.3.0`.
- This validation plan is updated to "Completed" with the verification log.
- `docs/constitution/roadmap.md` is updated to mark the alignment phase as complete.

## Notes

- The previous foundation spec left the Material 3 tokens in place as a "compatibility shim". This spec retires that shim; the only token names that survive are the Catalyst ones.
- A future spec may reintroduce an AI/provenance accent (e.g. `blue-500` plus a soft fill) if the product needs to distinguish agent-authored content visually. This spec does not add that signal.
- The Astro marketing site (`apps/web/site`) is out of scope; its own token decisions can be revisited in a follow-up spec.

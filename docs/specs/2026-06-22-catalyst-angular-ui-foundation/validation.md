# Catalyst Angular UI Foundation — Validation Plan

## Status

Completed on 2026-06-23. The shared UI foundation is implemented under `apps/web/app/src/app/shared/ui`, the design system docs are in place, and the app builds, lints, and tests clean on the `main` branch.

## Validation Run

```text
pnpm nx run app:lint   → ✔ All files pass linting
pnpm nx run app:vite:test → 19 files, 35 tests passed
pnpm nx run app:build --skip-nx-cache → built dist/apps/web/app (browser + server bundles)
```

## Static Validation

1. `pnpm nx lint app` — passed with no warnings introduced by the foundation.
2. `pnpm nx test app` — 19 spec files / 35 tests pass (`pnpm nx run app:vite:test`).
3. `pnpm nx build app` — production build succeeds; SSR bundle and browser bundle are emitted.

## Code Quality Checks

- No `primeng/*` imports in new UI primitives. — verified by `rg "primeng" apps/web/app/src/app/shared/ui` returning zero matches.
- No React, Headless UI React, or Motion React dependencies. — verified by `rg "headlessui|@headlessui|from 'react'" apps/web/app` returning zero matches.
- No inline dynamic `import()` outside `Deps`. — only TypeScript type-position `import('…')` references remain in `shared/realtime`; no runtime dynamic imports.
- No `@Input()`, `@Output()`, `@HostBinding()`, or `@HostListener()`. — verified by `rg "@Input\(\)|@Output\(\)|@HostBinding\(\)|@HostListener\(\)" apps/web/app/src/app/shared/ui` returning zero matches.
- No `standalone: true` in component decorators. — verified by `rg "standalone: true" apps/web/app/src/app/shared/ui` returning zero matches.
- No inline templates/styles in Angular components. — components use external `templateUrl` and `styleUrl` (e.g. `button.ts`, `input.ts`).
- No `ngClass` or `ngStyle`. — verified by `rg "ngClass|ngStyle" apps/web/app/src/app/shared/ui` returning zero matches.
- No `*ngIf`, `*ngFor`, or `*ngSwitch`. — verified by `rg "\*ngIf|\*ngFor|\*ngSwitch" apps/web/app/src/app/shared/ui` returning zero matches.
- Effects declared as `readonly` properties. — `dialog.ts` and `pin-input.ts` declare `readonly scrollLockEffect` / `readonly valueEffect` as class properties.
- Tailwind classes remain literal in templates or static maps. — class composition is done via static maps returned by computed signals.
- `shared/ui` must not import domain services from auth, activation, projects, or dashboard. — verified by `rg "from.*auth|from.*activation|from.*projects|from.*dashboard" apps/web/app/src/app/shared/ui` returning zero matches.

## Accessibility Validation

- Buttons and links have accessible names. — `IconButton` requires `aria-label`; `Button` and `LinkButton` project label content.
- Inputs, selects, checkboxes, radios, and switches expose labels and error descriptions. — form primitives support `id`, `aria-describedby`, and `aria-invalid` via `Field`/`Fieldset`/`Label`/`Description`/`ErrorMessage`.
- Focus ring is visible in light and dark mode. — `ui-focus-ring` utility plus `apps/web/app/src/styles.css` `@custom-variant dark (&:where(.dark, .dark *));`.
- Touch targets meet the 44x44 px target where applicable. — `TouchTarget` primitive plus `ui-touch-target` utility.
- Dialog/dropdown behavior supports keyboard navigation before route migration uses them. — `Dialog` uses Angular CDK focus trap; `Dropdown`/`Listbox`/`Combobox` use Angular CDK connected overlays.

## Completion Checklist

- Token docs exist. — `docs/design-system/tokens.md` is in place.
- Component docs exist. — `docs/design-system/components.md` is in place.
- At least actions, typography, forms, and layout primitives are implemented before the app redesign starts. — all six groups (actions, forms, layout, data, overlays, typography) are implemented; the app redesign has already consumed them.
- PrimeNG remains allowed only for legacy screens until the second spec migrates them. — the second spec (`2026-06-22-themis-web-app-redesign`) has migrated all routes; PrimeNG, PrimeIcons, and `tailwindcss-primeui` are no longer present in `apps/web/app/src` or `package.json`.

## Notes

- The redesign spec's "Implementation Outcome" describes the final route migration and PrimeNG cleanup that consumed this foundation.
- `Deps.cls()` was replaced by a small local `uiClass(...values)` helper in `apps/web/app/src/app/shared/ui/classes.ts`.

# Catalyst Angular UI Foundation — Requirements

## Context

Themis needs a local, copyable Angular UI foundation before the application redesign begins. This first spec is limited to creating the shared UI primitives under `apps/web/app/src/app/shared/ui` and the Tailwind token/utilities layer they need.

Reviewed sources:

- Current Themis app: `apps/web/app/src/app/shared`, `apps/web/app/src/styles.css`, `styles.base.css`.
- Catalyst UI Kit: `~/Downloads/catalyst-ui-kit/typescript`.
- Nive legacy: `~/Projects/GitHub/visomi-dev/.legacy/nive-v4/projects/webapp/src/app/shared/ui` and `shared/layout`.
- Angular AI guide: `https://angular.dev/ai`, `https://angular.dev/ai/develop-with-ai`, `https://angular.dev/ai/design-patterns`.

Project status:

- Themis is already on Angular 22. The package update was completed manually with `ncu` because `nx migrate --run-migrations` did not update all packages as expected.

## Goals

1. Build an Angular 22 UI foundation in `apps/web/app/src/app/shared/ui`.
2. Port Catalyst's visual patterns into Angular-native primitives without React or Headless UI React.
3. Reuse the strongest Nive ideas: small components, signal-first APIs, class maps, slots, and optimized table/layout patterns.
4. Keep components copyable, shadcn-like, and minimally coupled to Themis domain code.
5. Create enough primitives to support a later full app redesign without using PrimeNG for new UI.
6. Preserve performance, accessibility, SSR safety, and Tailwind CSS v4 compatibility.

## Non-Goals

1. Do not redesign Themis routes in this spec.
2. Do not remove every PrimeNG dependency yet; removal happens after migrated routes no longer need it.
3. Do not create a public package or move components into `libs/ui` in the first iteration.
4. Do not port Catalyst literally when an Angular-native API is simpler.

## Required Components

| Group      | Components                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Actions    | `Button`, `LinkButton`, `IconButton`, `TouchTarget`                                                                                          |
| Forms      | `Field`, `Fieldset`, `Label`, `Description`, `ErrorMessage`, `Input`, `InputGroup`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch` |
| Layout     | `AppShell`, `Sidebar`, `SidebarItem`, `Topbar`, `StackedLayout`, `AuthLayout`, `PageHeader`, `Container`                                     |
| Data       | `Table`, `Pagination`, `DescriptionList`, `Badge`, `Avatar`                                                                                  |
| Overlay    | `Dialog`, `Dropdown`, `Combobox`, `Listbox`, `Alert`                                                                                         |
| Typography | `Heading`, `Text`, `Divider`                                                                                                                 |

## Angular Requirements

- Use `input()` and `output()` for component APIs.
- Use `signal()` for local mutable state.
- Use `computed()` for derived state and class composition.
- Declare `effect()` as `readonly` class properties only.
- Use Angular 22 Signal Forms for new form primitives where the API fits; typed Reactive Forms may remain where incremental migration is safer.
- Use external `templateUrl` and `styleUrl` files.
- Use native control flow in templates.
- Do not use `@Input()`, `@Output()`, `@HostBinding()`, `@HostListener()`, `ngClass`, or `ngStyle`.

## Styling Requirements

- Define tokens in Tailwind CSS v4 `@theme` and reusable patterns in `@utility`.
- Keep component classes literal in maps/templates so Tailwind can detect them.
- Preserve Catalyst patterns such as `data-slot`, expanded touch targets, pseudo-element rings, optical borders, and density.
- Do not use direct raw CSS variables in templates for design tokens.
- Keep dark mode compatible with `@custom-variant dark (&:where(.dark, .dark *))`.

## Accessibility Requirements

- Interactive primitives must have accessible names.
- Touch targets must meet the 44x44 px target where applicable.
- Focus indicators must be visible and keyboard-friendly.
- Overlay primitives must handle focus, escape, ARIA roles, and keyboard navigation.
- Components must be suitable for AXE validation in downstream route specs.

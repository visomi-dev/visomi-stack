# Catalyst Angular UI Foundation — Implementation Plan

## Phase 0 — Inventory And Setup

1. Audit current PrimeNG imports and `.p-*` dependencies in `apps/web/app`.
2. Inventory Catalyst components to port for V1.
3. Inventory Nive components that inform Angular structure.
4. Record Angular 22 assumptions and follow-ups from the manual `ncu` package update.
5. Decide whether `Deps.cls()` remains the official class helper or is replaced by a smaller local utility.
6. Define initial public APIs for each primitive group.

## Phase 1 — Token Foundation

1. Extract existing Themis tokens from `styles.base.css`, `apps/web/app/src/styles.css`, and `docs/design/design-system-reference.md`.
2. Define the Catalyst/Open Design token taxonomy in Tailwind `@theme`.
3. Create reusable `@utility` helpers for focus rings, panel surfaces, touch targets, and text rhythm.
4. Ensure new primitives do not depend on `tailwindcss-primeui`.
5. Document tokens in `docs/design-system/tokens.md`.

## Phase 2 — Actions And Typography

1. Implement `Button`, `IconButton`, `LinkButton`, and `TouchTarget`.
2. Implement `Heading`, `Text`, and `Divider`.
3. Add smoke tests for class variants, disabled state, loading state, and projected icon slots.
4. Validate keyboard focus and touch target behavior.

## Phase 3 — Forms

1. Implement `Field`, `Fieldset`, `Label`, `Description`, and `ErrorMessage`.
2. Implement `Input`, `InputGroup`, `Textarea`, and native `Select`.
3. Implement `Checkbox`, `RadioGroup`, and `Switch`.
4. Replace `app-form-field` usage internally with the new field primitives where low-risk.
5. Document where Signal Forms are used immediately and where typed Reactive Forms remain for incremental migration.

## Phase 4 — Layout Primitives

1. Implement `AppShell`, `Sidebar`, `SidebarSection`, `SidebarItem`, `SidebarHeading`, `SidebarDivider`, and `SidebarSpacer`.
2. Implement `Topbar`, `Container`, `PageHeader`, `AuthLayout`, and `StackedLayout`.
3. Validate mobile menu focus, escape behavior, backdrop behavior, and close-on-navigation.

## Phase 5 — Data Primitives

1. Implement `Badge`, `Avatar`, `DescriptionList`, and `Pagination`.
2. Evolve the Nive-style `Table` with Catalyst styling, projected cell templates, and optional mobile cards.
3. Add tests for table template mapping and responsive mode class composition.

## Phase 6 — Overlays

1. Confirm Angular CDK overlay/focus/a11y dependencies and imports.
2. Implement `Dialog` with focus trap, escape, backdrop, and scroll lock.
3. Implement `Dropdown` for navigation/account menus.
4. Implement `Alert` as a non-modal primitive.
5. Defer `Listbox` and `Combobox` unless required by the immediate redesign.

## Phase 7 — Documentation And Portability

1. Create `docs/design-system/components.md` with API tables and examples.
2. Create `docs/design-system/recipes.md` with copyable patterns.
3. Create `docs/design-system/accessibility.md`.
4. Create `docs/design-system/open-design-agent-rules.md`.
5. Add a checklist for copying the UI foundation into another Angular project.

## Nx Verification Commands

```bash
pnpm nx lint app
pnpm nx test app
pnpm nx build app
```

If a target is missing or changes, inspect it first with:

```bash
pnpm nx show project app --json
```

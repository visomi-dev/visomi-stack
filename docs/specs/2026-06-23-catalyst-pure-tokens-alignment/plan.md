# Catalyst Pure Tokens Alignment — Implementation Plan

## Phase 0 — External Package Realignment

The Open Design package at `~/.od/projects/ds-themis-is-a-developer-native-design-system/` is the source-of-truth for downstream design generation. It must be realigned **before** the Angular tokens change, so the package and the app stay consistent throughout the PR series.

Files touched (manual edits outside the Nx workspace):

1. `colors_and_type.css`
   - Drop the `--tm-*` palette.
   - Define the new Catalyst token set as a `@layer base` block, using the same names the app uses: `--color-bg`, `--color-panel`, `--color-panel-raised`, `--color-fg`, `--color-muted-fg`, `--color-accent`, `--color-accent-fg`, `--color-danger`, `--color-danger-fg`, `--color-ring`, `--color-border`, `--color-border-subtle`.
   - Reference Tailwind v4 colors directly through `var(--color-blue-600)` etc. so the file stays a documentation source, not a duplicate of the app's tokens.
2. `DESIGN.md`
   - Replace the `--tm-bg` / `--tm-primary` / `--tm-ai` sections with the Catalyst token table from `requirements.md`.
   - Remove the AI-violet signal and the indigo operational accent sections.
3. `SKILL.md`
   - Update the description and "How to use" steps to point at the renamed `colors_and_type.css`.
4. `ui_kits/app/index.html`
   - Keep loading `colors_and_type.css`. The path is unchanged.
5. `ui_kits/app/components/*.jsx`
   - Replace `--tm-primary` / `--tm-surface` / `--tm-muted` usages with the Catalyst tokens.
   - Drop the AI-violet chip in `MessageBubble.jsx`; use a `data-ai` attribute plus the same accent blue.
6. `ui_kits/app/README.md`
   - Update the design notes section to reference the new tokens.
7. `preview/colors-primary.html`, `preview/colors-theme-light.html`, `preview/colors-theme-dark.html`, `preview/components-buttons.html`, `preview/components-workspace.html`
   - Regenerate the swatches and component previews to show the new palette and the new button classes.
8. `preview/brand-assets.html`
   - No content change beyond the doc link to the realigned `colors_and_type.css`.
9. `provenance.md`
   - Add a dated note: "Realigned to the Catalyst + Themis-blue token set on 2026-06-23. The `--tm-*` palette was retired."
10. `README.md`
    - Update the package overview, the preview manifest, the design notes, and the reuse workflow references.

External package verification:

- Open `ui_kits/app/index.html` in a browser; verify the workspace renders with the new blue accent and zinc surfaces.
- Open the four `preview/*.html` files; verify the swatches and component previews match the new token table.

## Phase 1 — PR1: Token Foundation in `eager-circuit`

This PR is **token-only**. It does not change component behavior. After this PR lands, the visual appearance of the app may shift slightly because `--color-surface-container-low` no longer exists and components fall back to Tailwind defaults; that drift is expected and corrected in PR2.

Files touched:

1. `styles.base.css`
   - Replace the entire `@theme` block with the Catalyst token set from `requirements.md`.
   - Drop the Material 3 `--color-surface-container-*` and `--color-primary-container` and `--color-tertiary` definitions.
   - Add the new `--color-border` and `--color-border-subtle` tokens.
   - Update `html.dark` with the dark mode table from `requirements.md`.
   - Keep `--shadow-panel`, `--radius-control`, `--radius-panel`, and the `ui-focus-ring`, `ui-panel`, `ui-panel-raised`, `ui-touch-target`, `ui-text-rhythm` utilities unchanged in name. Their internal color references move from Material 3 to the new tokens.
2. `apps/web/app/src/app/shared/ui/classes.ts`
   - No change. The `uiClass` helper stays.
3. `docs/design-system/tokens.md`
   - Replace the Material 3 mapping table with the Catalyst token table from `requirements.md`.
   - Update the utilities list to mention the new `--color-border` and `--color-border-subtle` usage in `ui-panel` and `ui-focus-ring`.
4. `docs/design-system/components.md`
   - Update the `Button`, `LinkButton`, `IconButton`, `Input`, `Badge`, `Alert`, and `Sidebar` sections to reference the new tokens and the new `data-*` state attributes introduced in PR2.
5. `docs/design-system/recipes.md`
   - Update recipe snippets so the Tailwind classes match the new tokens (no more `border-outline/30`, no more `bg-primary-container/20`).
6. `apps/web/app/version.json`
   - Bump version from `1.2.0` to `1.3.0` (token-level change is non-breaking but worth recording).

PR1 verification:

```bash
pnpm nx run app:lint
pnpm nx run app:vite:test
pnpm nx run app:build --skip-nx-cache
```

Manual visual check:

- `pnpm nx serve app`
- Confirm the light/dark themes render with blue accent and zinc surfaces.
- Confirm focus rings, shadows, and radii still match the previous spec's intent.

## Phase 2 — PR2: Component Pattern Alignment

This PR ports the Catalyst visual patterns the previous foundation spec did not implement. It depends on PR1.

Files touched (each is a small, focused change):

1. `apps/web/app/src/app/shared/ui/actions/button/button.ts`
   - Replace direct `bg-accent` classes with Catalyst custom properties: `--btn-bg`, `--btn-border`, `--btn-icon`, `--btn-hover-overlay`.
   - Add the `before` / `after` pseudo-element classes for the optical border and the inset highlight shadow.
   - Switch the `tone` API to Catalyst color names: `zinc` (default), `blue` (accent), `red` (danger), `green` (success), `amber` (warning).
   - Drop the `outlineTones` object; use `variant: 'outline' | 'plain'` only and resolve tones through the same `--btn-*` variables.
2. `apps/web/app/src/app/shared/ui/actions/button/button.html`
   - Add the `[attr.data-loading]` binding the new `loading` state needs.
3. `apps/web/app/src/app/shared/ui/actions/button/button.spec.ts`
   - Update the host template to use `tone="blue"` instead of `tone="accent"`.
4. `apps/web/app/src/app/shared/ui/actions/icon-button/icon-button.ts` and `icon-button.html`
   - Same change as `Button`. Add `aria-label` requirement in the type.
5. `apps/web/app/src/app/shared/ui/actions/link-button/link-button.ts`
   - Same change as `Button`. Add a `[attr.href]` host binding check.
6. `apps/web/app/src/app/shared/ui/forms/input/input.ts`
   - Replace `border-outline/30` with `border-border data-invalid:border-danger focus:border-accent`.
   - Remove the `field` wrapper dependency from `Input` (move it to `Field`).
7. `apps/web/app/src/app/shared/ui/forms/field/field.ts` and `field.html`
   - Add `[attr.data-invalid]` host binding for `aria-invalid` propagation.
8. `apps/web/app/src/app/shared/ui/forms/checkbox/checkbox.ts`
   - Replace `bg-panel text-accent` with `data-checked:bg-accent data-checked:text-accent-fg` on the inner span.
9. `apps/web/app/src/app/shared/ui/forms/switch/switch.ts`
   - Replace `bg-accent` with `data-checked:bg-accent`.
10. `apps/web/app/src/app/shared/ui/forms/radio-group/radio-group.ts` and `radio-group.html`
    - Use `data-checked:border-accent` on the radio control.
11. `apps/web/app/src/app/shared/ui/forms/radio-card/radio-card.ts`
    - Use `data-checked:border-accent data-checked:ring-ring/20`.
12. `apps/web/app/src/app/shared/ui/forms/pin-input/pin-input.ts`
    - Replace `border-outline/30 focus:border-accent` with the new `data-invalid` / `focus:border-accent` pattern.
13. `apps/web/app/src/app/shared/ui/forms/select/select.ts`
    - Use `data-invalid` plumbing.
14. `apps/web/app/src/app/shared/ui/forms/textarea/textarea.ts`
    - Same as `Input`.
15. `apps/web/app/src/app/shared/ui/data/badge/badge.ts`
    - Switch from `bg-primary-container/40 text-primary` to `data-tone:bg-accent/10 data-tone:text-accent` and similar for the other tones.
16. `apps/web/app/src/app/shared/ui/data/avatar/avatar.ts`
    - Update `bg-surface-container-low` references to `bg-panel`.
17. `apps/web/app/src/app/shared/ui/overlays/alert/alert.ts`
    - Replace `bg-primary-container/20` with `data-tone:bg-accent/5 data-tone:border-accent/20`.
18. `apps/web/app/src/app/shared/ui/overlays/dropdown/dropdown.ts`
    - Update the menu item active class to `data-active:bg-accent/10 data-active:text-accent`.
19. `apps/web/app/src/app/shared/ui/overlays/listbox/listbox.ts` and `combobox.ts`
    - Same as `Dropdown`.
20. `apps/web/app/src/app/shared/ui/typography/link/link.ts`
    - Use `text-accent` (already correct, but verify the new token resolves).
21. `apps/web/app/src/app/shared/ui/layout/sidebar/sidebar.ts`
    - Replace `bg-primary-container/20` with `data-current:bg-accent/10 data-current:text-accent`.
22. `apps/web/app/src/app/shared/ui/layout/topbar/topbar.ts`
    - Update any `border-outline` references to `border-border`.
23. `apps/web/app/src/app/shared/ui/layout/container/container.ts`
    - Update any surface references.
24. `apps/web/app/src/app/shared/ui/layout/auth-layout/auth-layout.ts`
    - Same as `Container`.
25. `apps/web/app/src/app/shared/ui/layout/page-loader/page-loader.html`
    - Update `bg-accent` to use the new token.
26. `apps/web/app/src/app/shared/ui/feedback/loader/loader.html`
    - Update `text-accent` to use the new token.
27. `apps/web/app/src/app/shared/ui/**/index.ts` (if present)
    - Export the renamed `tone` types from `Button` and `Badge`.

PR2 verification:

```bash
pnpm nx run app:lint
pnpm nx run app:vite:test
pnpm nx run app:build --skip-nx-cache
```

Manual visual checks:

- Login screen, sidebar, dashboard, settings, and any dialog examples in the app.
- Verify focus rings, hover states, loading state spinner, error states, and dark mode.
- Verify the AXE accessibility scan still passes (or document any regressions to fix in a follow-up spec).

## Phase 3 — Handoff and Roadmap Update

1. Update `docs/constitution/roadmap.md` to mark the alignment phase items as completed.
2. Mark the spec validation status in `docs/constitution/roadmap.md` or in a follow-up commit on top of the merged PRs.
3. Add a handoff note in the `agent-handoff` format describing what shipped, what was deferred, and the next recommended alignment slice (if any).

## Nx Verification Commands

```bash
pnpm nx run app:lint
pnpm nx run app:vite:test
pnpm nx run app:build --skip-nx-cache
```

If a target is missing or changes, inspect it first with:

```bash
pnpm nx show project app --json
```

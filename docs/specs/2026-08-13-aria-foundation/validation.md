# Aria Foundation — Validation

## Unit Tests

```
pnpm exec nx run app:vite:test
```

Result: **57 passed, 1 skipped** (the skipped test is a pre-existing placeholder in `activation.spec.ts`). The new `listbox.spec.ts` covers:

- `renders options with listbox semantics` — the wrapped `<ul cdkListbox>` exposes `role="listbox"` and the `<li cdkOption>` children expose `role="option"`.
- `attaches the Angular CDK listbox directive` — the `CdkListbox` is reachable from the host element's injector.
- `forwards writeValue to the cdk listbox selection` — the `ControlValueAccessor.writeValue` path lands on the cdk listbox.

## End-to-End Tests

```
pnpm exec nx e2e app-e2e
```

Result: **51 passed**. The new specs:

- `apps/web/app-e2e/src/app/sidebar.spec.ts` — sidebar renders, sign-out is visible, sign-out is hidden-text-when-collapsed, active section is highlighted, sign-out redirects to sign-in.
- `apps/web/app-e2e/src/app/gallery.spec.ts` — gallery renders, filter narrows results, listbox supports keyboard navigation and selection.

The pre-existing `signOutViaMenu` helper in `apps/web/app-e2e/src/support/auth.ts` was updated from "open dropdown, choose Sign out" to "click `[data-od-id="sidebar-sign-out"]`" so the projects, project-detail, and activation e2e specs keep passing without changes.

## Visual Evidence

```
node scripts/capture-aria-foundation.cjs
```

20 PNGs in `media/aria-foundation/`:

- sign-in × {mobile, desktop} × {light, dark} = 4
- dashboard × {mobile, desktop} × {light, dark} = 4
- projects × {mobile, desktop} × {light, dark} = 4
- gallery × {mobile, desktop} × {light, dark} = 4
- sidebar-collapsed × desktop × {light, dark} = 2 (mobile skipped: the collapse button is `hidden lg:flex`)

The script authenticates by signing up a fresh user through the public API and reading the OTP from `GET /api/test/mailbox/latest`. No test-only session bootstrap route is needed.

## Catalog Generation

```
node scripts/generate-component-catalog.mjs
```

Writes:

- `docs/design-system/components.json` — machine-readable index of 51 primitives.
- `docs/design-system/components.md` — human-readable index grouped by category.

The generator walks `apps/web/app/src/app/shared/ui` and extracts each primitive's `selector`, `input` / `model` declarations, `output` declarations, and whether it implements `ControlValueAccessor`. The catalog is the contract for the e2e suite's `[data-od-id="gallery-card-*"]` hooks and for any future AI agent composing new screens.

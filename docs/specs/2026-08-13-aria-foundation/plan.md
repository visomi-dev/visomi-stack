# Aria Foundation + Sidebar + Gallery

## Problem

Two related issues:

1. The `app-listbox` primitive hand-rolled its keyboard, focus, `aria-activedescendant`, and `aria-selected` state in 130 lines. The pattern does not generalize to Phase 1 screens (which need multiselect, async, typeahead) and it is the most likely surface for a11y regressions.
2. The `apps/web/app/src/app/shared/ui` library has 51 primitives but **no catalog and no live examples**. A new screen takes longer than it should because the author (or an agent) has to read every component file to learn its API.

The two are symptoms of the same gap: we have a custom UI library that pretends to be discoverable, but it is neither well-encapsulated behavior nor well-indexed.

## Decision

Adopt **option A** from the design options report (`docs/specs/2026-08-12-ui-library-strategy/decision.md`):

- **Behavior**: delegate listbox semantics to `@angular/cdk/listbox` (MIT, signal-based, already a peer of Angular). Keep the `app-listbox` selector and Catalyst styling as the public surface. The combobox is not migrated in this PR — it is not consumed by any route and the `@angular/aria` combobox requires a popup template with deferred content, which is a bigger refactor that does not yet earn its cost.
- **Discoverability**: add a generated catalog (`docs/design-system/components.json` + `docs/design-system/components.md`) that indexes every primitive with its selector, inputs, outputs, and CVA status, and a live `/app/en/gallery` route with one card per primitive.
- **Shell**: move the sidebar to a Nive-style "logo top, navigation middle, footer with user, theme toggle, and explicit `Sign out` button at the bottom" layout. The dropdown user menu is removed in favor of a direct `Sign out` action.

## Slice Plan

- [x] PR1: install `@angular/aria@22.1.2` and bump `@angular/cdk@22.1.2`. Migrate `app-listbox` to wrap `cdkListbox` + `cdkOption`. Add unit tests. Add `scripts/generate-component-catalog.mjs`.
- [x] PR2: redesign `app-sidebar-menu` to match the Nive layout with `Sign out` pinned at the bottom. Add `data-od-id` hooks for the e2e suite.
- [x] PR3: add `/app/en/gallery` route with one card per primitive. Add `apps/web/app-e2e/src/app/{sidebar,gallery}.spec.ts`. Add `scripts/capture-aria-foundation.cjs` and capture `media/aria-foundation/*` (20 PNGs).

## Risks

- The catalog generator uses regex parsing of the source. It will miss inputs declared with renamed aliases or destructuring; the gallery and the markdown are the source of truth for which API is advertised, and the e2e suite catches regressions. The generator must be re-run when primitives are added.
- The gallery is reachable at `/app/en/gallery` behind `authenticatedGuard`. It is gated by an authenticated session; non-authenticated visitors see the sign-in screen. This is intentional — the gallery is a developer tool, not a public surface — but it means the gallery does not show in unauthenticated snapshot runs.
- `@angular/aria` is at 22.1.2 with API still labelled "next" in some `llms.txt` entries. We do not yet use it directly; the cdk listbox carries the same behavior. If we later migrate the combobox to `@angular/aria` directly, the popup-template refactor is scoped to the combobox file and does not touch the rest of the library.
- Bumping `@angular/cdk` from 22.0.2 to 22.1.2 is a patch-level move, but the cdk `listbox` module is a new subpath export — it was not in 22.0.2. Anyone importing `@angular/cdk/listbox` outside of `app-listbox` will pull it from the workspace lockfile.

## Open Questions

- Should the gallery be a real route, a `ui-designer` prototype, or both? It currently lives at `/app/en/gallery` so the e2e suite can screenshot it. The `ui-designer` could also load it as a preview frame, but that is a follow-up.
- Should the catalog generator also generate an `llms.txt` for AI agents? The `components.json` is already a machine-readable index; an `llms.txt` would be a thin wrapper.

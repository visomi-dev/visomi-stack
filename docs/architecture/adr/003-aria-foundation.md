# ADR 0003: Aria / CDK Foundation for the UI Library

Status: Accepted
Date: 2026-08-13
Spec: `docs/specs/2026-08-13-aria-foundation/`
Supersedes: implicit decision in `2026-06-22-catalyst-angular-ui-foundation` to build every behavior from scratch.

## Context

The Themis UI library has 51 custom primitives under `apps/web/app/src/app/shared/ui`. The most behavior-heavy of them — the listbox, the dropdown, the dialog, the combobox, the menu — were hand-rolled: keyboard handling, ARIA, focus, and roving tabindex were written by hand, line by line, in each component. The listbox was the worst offender: 130 lines of code, no multiselect, no typeahead, no Home/End, and a public API that was almost-but-not-quite what the Angular CDK already provides.

A second, orthogonal problem: the library had no catalog and no live examples. Composing a new screen required reading every component file to learn its API, and an AI agent had no machine-readable index to consult. The cost of "what does this primitive look like" was high.

We evaluated four options in the design report (`docs/specs/2026-08-12-ui-library-strategy/decision.md`): keep the library custom and add CDK + a catalog; add CDK + adopt PrimeNG for the heavy widgets; replace everything with PrimeNG styled; or migrate to spartan-ng / ng-primitives.

PrimeNG v22 (the only version that supports Angular 22) is now under a PrimeUI dual license that requires a license key, ships compiled (no source), and deprecates the free-tier components (Chart, Editor, MultiSelect, Galleria) toward PRO. It is a poor fit for a project that may commercialize and a poor fit for a code base that has spent the last four months on a custom Catalyst layer.

## Decision

Adopt **option A**: keep the custom library, delegate behavior to `@angular/aria` (MIT, first-party) and `@angular/cdk` (MIT, already a dependency), and add a generated catalog plus a live `/app/en/gallery` route.

Specifically:

1. Add `@angular/aria@22.1.2` and bump `@angular/cdk` from 22.0.2 to 22.1.2. The cdk bump is patch-level; the `listbox` subpath export is new in 22.1.x and is required by `@angular/aria`.
2. Migrate `app-listbox` to wrap `cdkListbox` and `cdkOption`. Keep the `app-listbox` selector, the `ControlValueAccessor` contract, and the Catalyst class names. The combobox is **not** migrated in this PR — its `@angular/aria` equivalent requires a `ng-template` popup with deferred content, and the primitive is not yet consumed by any route.
3. Move the sidebar to a Nive-style layout with the user, theme toggle, and an explicit `Sign out` button pinned at the bottom. Remove the user-menu dropdown.
4. Generate `docs/design-system/components.json` and `docs/design-system/components.md` from the source tree with `scripts/generate-component-catalog.mjs`. The catalog is the contract for the gallery and for any agent.
5. Add the `/app/en/gallery` route with one live card per primitive, plus a left rail and a filter input.

## Consequences

### Positive

- Listbox behavior — keyboard, focus, `aria-activedescendant`, typeahead, Home/End — is now first-party and tested by Angular's own test suite, not by ours.
- The catalog and the gallery make the library discoverable. A new screen can be composed by reading one file (`components.json`) or by visiting one route (`/app/en/gallery`).
- The e2e suite can now screenshot the gallery and assert the sidebar layout, which means visual regressions in the shell are caught in CI.
- We do not depend on a closed-source, license-keyed package.

### Negative

- The catalog generator uses regex parsing of the source. It will miss inputs declared with renamed aliases or destructuring. The e2e suite catches regressions in the consumer surface, but the generator should be re-run when primitives are added.
- `@angular/aria` is at 22.1.2 with API still labelled "next" in some `llms.txt` entries. We do not yet use it directly; the cdk listbox carries the same behavior. If we later migrate the combobox to `@angular/aria` directly, the popup-template refactor is scoped to the combobox file.
- The gallery is reachable at `/app/en/gallery` behind `authenticatedGuard`. It is a developer tool, not a public surface.

## Alternatives Considered

- **Option B (PrimeNG unstyled for heavy widgets)**: rejected for now. The license change is a non-starter and the widgets we need (datepicker, data table, editor, file upload) are not in Phase 1. The threshold to revisit is "a widget that takes >2 days to build" — not "the catalog is empty."
- **Option C (PrimeNG styled)**: rejected. Tearing out 4,074 lines of Catalyst-aligned work to adopt a competing token system is a step backward.
- **Option D (spartan-ng / ng-primitives)**: rejected. Both are excellent libraries, but neither gives us the first-party signal + CDK integration that the project already depends on. They are a good escape hatch for a future migration if `@angular/aria` stalls.

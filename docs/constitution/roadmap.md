# Delivery Plan: Themis

## Suggested Phases

### Phase 1: Task Definition Core

Build:

- task entity
- task detail screen
- scope fields
- requirements
- acceptance criteria
- status flow

### Phase 2: Daily Execution Layer

Build:

- update composer
- update log timeline
- next step field
- blockers
- stale task surfacing

### Phase 3: Initiative Layer

Build:

- initiative grouping
- initiative view
- task relationships

### Phase 4: Agent Layer

Build:

- agent-readable task view
- agent update endpoints
- structured task export

### Phase 5: Workflow Automation

Build:

- reminders for stale tasks
- automatic summaries
- optional queue-backed processing

## Recommended First Technical Slice

For this standalone monorepo, the first implementation should likely be:

- Angular frontend under the application surface
- API endpoints in `apps/web/api`
- PostgreSQL-backed persistence later in the implementation sequence
- mounted through `apps/web/server`

## SSR Compatibility Hardening

Refactor the Angular app to author server-compatible components per the [Angular SSR guide](https://angular.dev/guide/ssr#authoring-server-compatible-components). Replaces `isPlatformBrowser` / `isPlatformServer` checks with platform-specific provider implementations.

- See spec: [`docs/specs/2026-06-08-ssr-browser-refactor/`](./specs/2026-06-08-ssr-browser-refactor/)
- Branch: `feat/OC/ssr-browser-refactor`
- Version target: `1.1.0`

## Design System Alignment (Catalyst Purity)

The Catalyst Angular foundation shipped with a Material 3 token base and a Catalyst-style alias layer. The user prefers the pure Catalyst visual language; this phase retires the Material 3 layer and exposes only the Catalyst semantic token set (`bg`, `panel`, `panel-raised`, `fg`, `muted-fg`, `accent`, `danger`, `ring`, `border`). The Themis brand color becomes Tailwind `blue-600`. Components adopt Catalyst visual patterns: optical borders via `before/after`, `--btn-bg` / `--btn-border` / `--btn-icon` custom properties, and `data-*` state selectors.

- See spec: [`docs/specs/2026-06-23-catalyst-pure-tokens-alignment/`](./specs/2026-06-23-catalyst-pure-tokens-alignment/)
- Branch: `feat/OC/catalyst-pure-tokens-alignment`
- Version target: `1.3.0`

Slice plan:

- [ ] PR1: token foundation in `styles.base.css` + `docs/design-system/tokens.md` + `components.md` + `recipes.md`.
- [ ] PR2: `shared/ui` components adopt the new tokens and Catalyst `data-*` patterns.

## UI Designer App

Replace the vendored Open Design prototypes and the inherited design-system skill with a first-party Node + Tailwind v4 preview application. The app reuses `styles.base.css`, serves a local preview server with light/dark + mobile/tablet/desktop viewports, ships one seed prototype that mirrors the auth shell recipe, and is paired with a `themis-ui-prototype` opencode skill that drives the workflow. The cleanup drops `resources/open-design/themis-app/`, `.opencode/skills/themis-design-system/`, and the historical specs that referenced them. Two upstream open-design skills (`impeccable-design-polish`, `login-flow`) fill the gap left by the deleted skill; the Themis brand already lives in `docs/design-system/tokens.md` and `DESIGN.md`, so no brand skill is vendored. Node is the only runtime target — Bun is intentionally out of scope to keep the workspace runtime uniform.

- See spec: [`docs/specs/2026-06-26-ui-designer-app/`](./specs/2026-06-26-ui-designer-app/)
- Branch: `feat/OC/ui-designer-app`
- Version target: `1.4.0`

## Post-Refactor UI Review

Audit and polish the surfaces left inconsistent by the Catalyst utility-first refactor series (Catalyst Angular foundation, pure tokens alignment, site utility-first migration, UI designer app). The review follows the `web-design-reviewer` workflow: capture a baseline screenshot grid and an auth flow recording, audit visual drift at the source, apply focused fixes, re-capture, and ship the recordings as evidence. Concrete items in scope: replace the non-canonical `font-display` utility with `font-heading` across the auth routes, brand wordmark, and recipes doc; collapse duplicate background utilities in the `app-auth-layout` sticky header; replace the magic `min-h-[calc(100vh-64px)]` with `min-h-dvh`; tighten the `app-auth-card` mobile padding to a 24px outer floor; add `data-od-id` chrome hooks for visual e2e suites; add `scripts/capture-ui-snapshots.cjs` to drive the snapshot matrix; regenerate the auth flow recordings. No new tokens, no new primitives, no redesign. Out of scope for this spec: a `DESIGN.md` manuscript realignment (already documented as follow-up in the site spec), automated visual regression in CI, and any backend changes.

- See spec: [`docs/specs/2026-06-27-post-refactor-ui-review/`](./specs/2026-06-27-post-refactor-ui-review/)
- Branch: `feat/OC/post-refactor-ui-review`
- Version target: `1.5.0`

Slice plan:

- [ ] PR1: replace `font-display` with `font-heading` in the auth routes, the brand wordmark, and `recipes.md`.
- [ ] PR2: tighten the `app-auth-layout` sticky header (drop duplicate utilities, responsive height, sticky on mobile).
- [ ] PR3: tighten `app-auth-card` mobile padding to `px-6 py-6` floor and add `data-od-id="submit"` to every auth route's primary CTA.
- [ ] PR4: add `scripts/capture-ui-snapshots.cjs`, regenerate `media/auth-flow-videos/*.webm`, bump version to `1.5.0`, update the roadmap.

## CSS-Driven Field Errors

Replace the Angular UI-lib `control.touched` pipeline with the legacy `nive-web-app-old` typing-window reveal: native HTML5 validity (`:user-invalid`) drives the red border and message reveal through a global `:has()` rule in `styles.base.css`. The rule has two branches — native validity (post-blur, content, not focused, not autofilled) and a manual `data-manual-invalid` attribute on `<app-field>` for cross-field mismatches, OTP server errors, and HTTP per-field errors. A new `<app-form>` primitive exposes `[(submitted)]` so submit-time reveal works without per-route boilerplate. Every form primitive — `app-input`, `app-password-input`, `app-textarea`, `app-select`, `app-pin-input`, `app-checkbox`, `app-radio-group`, `app-radio-card`, `app-switch`, `app-color-picker` — accepts `pattern`, `required`, `minLength`, `maxLength`, `min`, `max` and forwards them to the DOM. No new dependencies, no backend changes, no copy edits. Author code drops `(blur)` handlers, `markAllAsTouched()`, and `@if (... as message) { ... }` wrappers around `<app-error-message>`.

- See spec: [`docs/specs/2026-06-28-css-driven-field-errors/`](./specs/2026-06-28-css-driven-field-errors/)
- Branch: `feat/OC/css-driven-field-errors`
- Version target: `1.6.0`

Slice plan:

- [ ] PR1: design-system primitives migration (CSS rule + `<app-form>` + signal pass-throughs) + `sign-in` proof.
- [ ] PR2a: `sign-up`, `verify-email`, `verify-device`.
- [ ] PR2b: `forgotten-password`, `reset-password` (cross-field confirm-password via `[manualError]`).
- [ ] PR2c: `activation`, `project-new`.
- [ ] PR3: recipes doc rewrite (`app-form` section + Field With Error snippet) + version bump + roadmap entry.

## Signal Forms Migration

Lift every Themis form to Angular v22's `form()` / `[formField]` / `[formRoot]` API. Reactive Forms (`FormGroup`, `FormControl`, `Validators.*`, `[formGroup]`, `formControlName`) is retired; `compatForm` and `SignalFormControl` from `@angular/forms/signals/compat` stay available for future interop but are not used in production code. The design-system primitives and the `<app-form>` wrapper accept a `Field<T>` (the `FormField` directive binds `invalid`, `disabled`, `pattern`, `minLength`, `maxLength` automatically to the host's inputs) and the route drives the schema with per-rule `{message: $localize…}` options. Cross-field mismatches use `validate(path, ({value, valueOf}) => …)`; per-field server errors return `{kind, fieldTree, message}` from the `submission.action`. The CSS reveal rule from the previous spec and the `<app-form [(submitted)]>` primitive carry over unchanged. The controlError() translator at `apps/web/app/src/app/shared/form/form-errors.ts` is removed; every i18n key (`@@signInEmailErrorInvalid`, etc.) survives in the schema's `{message}` options.

- See spec: [`docs/specs/2026-07-04-signal-forms-migration/`](./specs/2026-07-04-signal-forms-migration/)
- Branch: `feat/OC/signal-forms-migration`
- Version target: `1.7.0`

Slice plan:

- [x] PR1: design-system primitives migrated to `[formField]`; `<app-form>` rewritten with `[formRoot]`; `form-errors.ts` removed; `sign-in` as the reference consumer.
- [x] PR2a: `sign-up`, `forgotten-password` (sign-up uses `validate()` for the cross-field `confirmPassword` mismatch).
- [x] PR2b: `reset-password` (two `FieldTree`s — pin + password — cross-field rule in step 2).
- [x] PR2c: `verification-code-form` (used by `verify-email` and `verify-device`; `pinManualError` preserved for the per-field server error path).
- [x] PR2d: `activation`, `project-new` (async per-field errors via `<app-field [manualError]>`).
- [x] PR3: recipes doc rewritten (`Signal Forms` section + every snippet uses `[formField]`); version bumped to `1.7.0`; roadmap entry added.

## Aria / CDK Foundation

Adopt option A from the design options report: keep the custom UI library, delegate behavior to `@angular/aria` (MIT, first-party) and `@angular/cdk` (already a dependency), and add a generated catalog plus a live `/app/en/gallery` route. The listbox is the first primitive migrated: it now wraps `cdkListbox` + `cdkOption` and the 130 lines of hand-rolled keyboard / ARIA / focus handling are replaced by first-party directives. The sidebar is reshaped to a Nive-style layout with the user, theme toggle, and an explicit `Sign out` button pinned at the bottom. The `components.md` and `components.json` catalog is generated by `scripts/generate-component-catalog.mjs` and indexes all 51 primitives with their selector, inputs, outputs, and CVA status. The new e2e specs in `app-e2e/src/app/{sidebar,gallery}.spec.ts` cover the shell and the gallery, and the snapshot script `scripts/capture-aria-foundation.cjs` produces 20 PNGs in `media/aria-foundation/` as visual evidence. PrimeNG is **not** adopted in this cycle: v22 requires a license key, ships compiled, and deprecates the free-tier components (Chart, Editor, MultiSelect, Galleria) toward PRO.

- See spec: [`docs/specs/2026-08-13-aria-foundation/`](./specs/2026-08-13-aria-foundation/)
- Branch: `feat/OC/aria-foundation`
- Version target: `1.8.0`

Slice plan:

- [x] PR1: install `@angular/aria@22.1.2`, bump `@angular/cdk` to 22.1.2, migrate `app-listbox` to `cdkListbox` + `cdkOption`. Add unit tests. Add `scripts/generate-component-catalog.mjs`.
- [x] PR2: redesign `app-sidebar-menu` to a Nive-style layout with `Sign out` pinned at the bottom. Update `signOutViaMenu` helper.
- [x] PR3: add `/app/en/gallery` route with one card per primitive, `apps/web/app-e2e/src/app/{sidebar,gallery}.spec.ts`, `scripts/capture-aria-foundation.cjs`, and the `media/aria-foundation/` snapshots.

# CSS-Driven Field Errors — Software Design Document

## Decision

Replace Themis' `control.touched` gate for field-level error visibility with the legacy `nive-web-app-old` pattern: native HTML5 validity (`:invalid`) is the source of truth, and the `<app-error-message>` is revealed by a CSS rule that combines `:placeholder-shown`, `:focus`, `:autofill`, and `:has()` to hide errors while the user is typing and reveal them as soon as they leave a non-empty, invalid field. The pattern is **hybrid**: native validity is CSS-driven; manual errors (HTTP field errors, cross-field mismatches, OTP mismatches) ride a sibling `data-manual-invalid` attribute on `<app-field>` that the same CSS rule consumes.

ReactiveForms stays as the validation source. The Angular `Validators` arrays are unchanged. `controlError()` stays as a pure error-key-to-message translator; the `touched` gate inside it is removed because the CSS rule already implements the correct visibility window. `(blur)="updateXError()"` and `markAllAsTouched()` plumbing goes away in the migrated consumers.

## Why now

The current pattern (`control.touched` + `<app-input [invalid]>` + `(blur)` plumbing + `@if (errorSignal(); as message) { <app-error-message>... }`) is a UI-lib idiom that actively fights the user:

- The error appears the first time the user blurs an invalid field — usually the middle of typing — and stays visible until the user fixes the value.
- During typing, the error is still rendered in the DOM, just visually suppressed; it becomes a flickering decoration.
- Every route reimplements the same `emailError = signal('')` / `emailErrorMessage()` / `updateEmailError()` triplet. `sign-in.ts:72-95`, `sign-up.ts`, `forgotten-password.ts`, `reset-password.ts:62-65,152-180`, `project-new.ts:83-113`, and `activation.ts:232-253` all carry the same boilerplate.
- The `<app-alert>` for asynchronous auth failures coexists with the per-field pipeline even though both are "error UX"; the split creates inconsistent visual rhythm between async and field errors.

The legacy `nive-web-app-old` `styles.css:121-139` solves the same problem with pure CSS:

```css
.control input:not(:placeholder-shown):not(:autofill):not(:focus):invalid {
  @apply border-red-400;
}

.control input ~ p.error,
*:not(.control) p.error.hidden {
  @apply max-h-0;
}

.control input ~ p.error {
  @apply -mt-1;
}

.control input:not(:placeholder-shown):not(:autofill):not(:focus):invalid ~ p.error {
  @apply mt-0 max-h-96;
}
```

The rule's intent maps directly to Themis' current pain points:

| Legacy rule                | User-facing behavior                 | Replaces in current Themis                                              |
| -------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `:not(:placeholder-shown)` | Empty field → no error shown         | `controlError()` returning `''` because `control.invalid` is irrelevant |
| `:not(:focus)`             | Typing → error hides                 | Error persists in DOM during typing (only the visual flicker changes)   |
| `:invalid`                 | Native validity → show border        | `[invalid]="!!emailError()"` + red border, manually piped               |
| `~ p.error`                | Reveal error message sibling         | `@if (emailError(); as message) { <app-error-message>... }`             |
| `:not(:autofill)`          | Browser autofill → no false positive | Manually cleared in the route code                                      |

The shape of the rule generalizes across HTML control kinds (`input`, `textarea`, `select`). Angular component boundaries break the literal `~` sibling selector, but the same intent is reachable with `:has()` on the `<app-field>` host, which is the model this spec lands.

## Note on the legacy

The `nive-web-app-old` project is the source of this UX pattern, but it is not the architectural reference for Themis. The legacy was a focused Angular codebase; Themis — website + webapp + webapi + gateway + websocket fanout + worker queues + a Postgres + Redis data layer behind an Nx monorepo — is the production-quality destination. The full-stack architecture, multi-runtime contracts (Express, Socket.IO, BullMQ, Drizzle), tenant model, validation pipeline, and realtime channel are deliberately above and beyond the legacy's scope, and they stay.

This spec cherry-picks one specific UX pattern from the legacy that solved a real user problem well: the typing-window error reveal. It does **not** import the legacy's other choices — the `control.touched` gate being the inverse consequence of the touched-free reveal, the routing model, the form-aggregation strategy, the data layer, the i18n flow, or the directory layout. Every other form-UX decision in Themis stays aligned with the current production architecture. Adopting the legacy's reveal pattern here is a deliberate convergence on a well-validated interaction, not a regression in approach, and it is one of the few cases where the legacy's CSS idiom is genuinely superior to what the Angular UI-lib templates had been doing.

## Goals

1. `<app-error-message>` reveals and hides via a single global CSS rule in `styles.base.css` driven by the native `:invalid` of its sibling control, the `:placeholder-shown` / `:focus` / `:autofill` window, and an opt-in `data-manual-invalid` attribute on `<app-field>`.
2. The same CSS rule paints the red border on the affected control in lockstep with the message reveal — no Angular state pipeline needed for the visual.
3. `<app-field>` exposes `[manualError]` (string signal). Consumers wire it for HTTP per-field errors, cross-field mismatches (`confirmPassword !== password`), OTP mismatches, and any case where the validity cannot be derived from the field's own value.
4. `<app-input>`, `<app-password-input>`, `<app-textarea>`, `<app-select>`, `<app-pin-input>`, `<app-checkbox>`, `<app-radio-group>`, `<app-radio-card>`, `<app-switch>`, and `<app-color-picker>` accept `pattern`, `required`, `minLength`, `maxLength`, `min`, and `max` inputs and pass them through to the DOM so the browser owns validity.
5. `controlError()` becomes a pure translator (`{ required: '...', email: '...' }` → first matching string). The `touched` gate is removed.
6. A new `<app-form>` primitive wraps `<form>` and exposes `[submitted]` (signal) on the host as `data-submitted`. The CSS rule consumes this attribute to reveal per-field errors on submitted forms — including empty required fields — so the "user clicks Submit on an empty form" gap closes without per-route boilerplate.
7. `sign-in` is migrated as the reference. After it ships, every other auth flow + `project-new` + `activation` follows using the same shape.
8. `(blur)="updateXError()"` and `markAllAsTouched()` boilerplate is removed from migrated consumers. The single submit-time call site is `(ngSubmit)="submit()"` + `<app-form [(submitted)]="submitted">` (or signal wiring); each consumer still calls `form.invalid` to gate the auth-level `<app-alert>`, but no per-field signal pipeline remains.
9. No new dependency. No backend changes. The visual e2e assertions continue to pass against the new pattern.

## Non-Goals

1. No redesign of any auth route copy, layout, or section order.
2. No changes to backend, API, or worker contracts. The pattern is purely a client-side refinement.
3. No changes to `<app-alert>` for asynchronous auth failures (auth route banner). Async `HttpError` continues to surface via `<app-alert>`; only per-field error rendering moves to CSS.
4. No migration to template-driven forms or `NgModel`. ReactiveForms stays.
5. No introduction of a generic `<app-field-error>` component that owns the error dictionary. The translator stays at the route level as `controlError()`; the design system provides the reveal mechanism, not the message dictionary.
6. No removal of the `novalidate` form attribute on routes that use it. Custom submit handling stays.
7. No `DESIGN.md` manuscript realignment.
8. No automated visual regression of the new behavior. A focused unit + e2e suite is enough.

## Audit Findings (Baseline)

| ID    | Surface                                                                                                                        | Issue                                                                                                                                                                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1  | `apps/web/app/src/app/shared/form/form-errors.ts:4`                                                                            | `control.touched` gate forces every error to wait for a blur event, then persist through the typing window.                                                                                                                                                                             |
| P1-2  | `apps/web/app/src/app/shared/ui/forms/input/input.ts:26,36-43`                                                                 | `[invalid]` is set from outside; the red-border logic lives in the component class. The CSS rule that should own this lives on every component instead.                                                                                                                                 |
| P1-3  | `apps/web/app/src/app/shared/ui/forms/password-input/password-input.ts:30,48-57`                                               | Same as P1-2 for password.                                                                                                                                                                                                                                                              |
| P1-4  | `apps/web/app/src/app/shared/ui/forms/textarea/textarea.ts:17,25-30`                                                           | Same as P1-2 for textarea.                                                                                                                                                                                                                                                              |
| P1-5  | `apps/web/app/src/app/shared/ui/forms/select/select.ts:17,23-28`                                                               | Same as P1-2 for select.                                                                                                                                                                                                                                                                |
| P1-6  | `apps/web/app/src/app/shared/ui/forms/pin-input/pin-input.ts:64,80-89`                                                         | Same as P1-2 for pin input.                                                                                                                                                                                                                                                             |
| P1-7  | `apps/web/app/src/app/auth/sign-in/sign-in.ts:54-95` + `sign-in.html:40-44,62-67`                                              | `emailError = signal('')` / `updateEmailError()` / `(blur)` / `@if` triplet duplicated per field. Six auth routes carry the same boilerplate.                                                                                                                                           |
| P1-8  | `apps/web/app/src/app/auth/sign-up/sign-up.ts` (template imports, pairs of `nameError`, `emailError`, `passwordError` signals) | Same boilerplate. Three signals + three updaters + three `@if` blocks per route.                                                                                                                                                                                                        |
| P1-9  | `apps/web/app/src/app/auth/reset-password/reset-password.ts:62-65,152-180` + `reset-password.html`                             | OTP step uses `pinError = signal('')` plus a manual `/^\d{6}$/` validation. Password step carries `passwordError`, `confirmPasswordError`, and a cross-field `confirmPasswordErrorMessage()` that doesn't fit the CSS pattern.                                                          |
| P1-10 | `apps/web/app/src/app/projects/project-new/project-new.ts:83-113`                                                              | Same boilerplate. Two fields with `nameError`, `descriptionError`.                                                                                                                                                                                                                      |
| P1-11 | `apps/web/app/src/app/activation/activation.ts:68,235-253`                                                                     | Same boilerplate. `apiKeyForm.invalid` short-circuits, then `labelError.set(...)` is called manually inside an effect that watches `control.errors`.                                                                                                                                    |
| P1-12 | `apps/web/app/src/app/shared/ui/forms/field/field.ts`                                                                          | The `Field` primitive has no `[invalid]` or `[manualError]` input. `docs/design-system/components.md:19` claims it "propagates `data-invalid` so the child controls can target it" — that contract is documented but not implemented.                                                   |
| P1-13 | `apps/web/app/src/app/shared/ui/forms/error-message/error-message.ts:15-25`                                                    | The error message is a passive container with no `data-error-source` or hook for the CSS rule to target beyond `<app-error-message>` itself. Adding `data-slot="error"` is enough; today `data-slot="error"` exists (`error-message.html:1`).                                           |
| P1-14 | `apps/web/app/src/app/auth/verification-code-form/verification-code-form.ts:56`                                                | `if (this.form.invalid) this.errorMessage.set(...)` short-circuits the submit; the user sees the auth-level alert instead of the per-field pin error. The fix lets the per-pin-error pathway work without manual signal plumbing.                                                       |
| P1-15 | `apps/web/app/src/app/shared/ui/forms/checkbox/checkbox.ts:17,23-28`                                                           | Same `[invalid]` pattern for checkbox. Red border driven from outside; no native `:invalid` reveal. Generic checkboxes (e.g. sign-in "remember this device", activation "I accept the terms") cannot show their validation without manual plumbing.                                     |
| P1-16 | `apps/web/app/src/app/shared/ui/forms/radio-group/radio-group.ts`                                                              | Same `[invalid]` pattern for radio group. Required-radio groups today use `[invalid]="true"` from outside; the CSS rule does not cover radio inputs.                                                                                                                                    |
| P1-17 | `apps/web/app/src/app/shared/ui/forms/switch/switch.ts`                                                                        | Same `[invalid]` pattern for switch. Required-on switches (e.g. accept-terms) have no native CSS path.                                                                                                                                                                                  |
| P1-18 | `apps/web/app/src/app/shared/ui/forms/radio-card/radio-card.ts`                                                                | Card-style radio. Same `[invalid]` story as radio-group; the parent template has to wrap each card in a `<app-field>` to attach `[manualError]`.                                                                                                                                        |
| P1-19 | `apps/web/app/src/app/shared/ui/forms/color-picker/color-picker.ts`                                                            | Color picker participates in the form palette; today its invalid state is driven externally. The CSS rule needs to recognize `app-color-picker > [role="combobox"]:invalid` (PrimeNG-style) or the inner `<input type="color">` if the implementation switches away from PrimeNG later. |
| P1-20 | All routes — `submit()` with required-but-empty form fields                                                                    | Today `markAllAsTouched()` is called to force the touched gate; without the touched gate the empty fields wouldn't reveal. The fix is `<app-form [(submitted)]>` / `data-submitted`, which the CSS rule consumes to reveal errors on submitted forms (including empty).                 |
| P2-1  | `styles.base.css:51-94`                                                                                                        | The file declares `ui-focus-ring`, `ui-panel`, `ui-panel-raised`, `ui-touch-target` utilities. No `ui-invalid` utility, no `:has()` rule for cross-component validity reveal.                                                                                                           |
| P2-2  | `docs/design-system/recipes.md:35-107`                                                                                         | All three field recipes document the `(blur)="updateXError()"` + `@if` pattern that this spec retires.                                                                                                                                                                                  |

### Out-of-scope follow-ups (tracked, not in this spec)

- A11y audit on the `role="alert"` semantics once the message is always in the DOM (verify that screen readers don't announce on mount).
- Per-cell pin error states (a cell that fails the pattern lights up red independently of the field-level `[manualError]`). Today the spec stops at field-level; per-cell detail can land as a follow-up if the auth-OTP flow shows the gap.

## Implementation Strategy

### Slice 1 — Design-system primitive migration + sign-in proof + `<app-form>`

The first PR moves the design system primitives to the hybrid model, lands the new `<app-form>` primitive, and migrates `sign-in` as the reference consumer. After PR1 ships, every other consumer can follow the same shape on its own PR.

**Files touched:**

- `styles.base.css` — add the `:has()` reveal rule, the `[data-submitted]` clause, dark-mode overrides, and `prefers-reduced-motion` short-circuit on the transition.
- `apps/web/app/src/app/shared/ui/forms/field/field.ts` — add `[invalid]` and `[manualError]` inputs, expose `data-invalid` and `data-manual-invalid` attributes on the host.
- `apps/web/app/src/app/shared/ui/forms/input/input.ts` + `input.html` — pass `pattern`, `required`, `minlength`, `maxlength`, `min`, `max` inputs through to the DOM. Wire the existing `[invalid]` to a host `data-invalid` attribute on the inner control so the CSS rule can target without re-implementing in the component class.
- `apps/web/app/src/app/shared/ui/forms/password-input/password-input.ts` + `password-input.html` — same pass-throughs; the `pattern` input already exists, extend with `minLength` / `maxLength`.
- `apps/web/app/src/app/shared/ui/forms/textarea/textarea.ts` + `textarea.html` — same pass-throughs.
- `apps/web/app/src/app/shared/ui/forms/select/select.ts` + `select.html` — add `required`, `pattern`, `minlength` pass-throughs; remove the manual border logic in `classes()` (the CSS rule owns it now).
- `apps/web/app/src/app/shared/ui/forms/pin-input/pin-input.ts` + `pin-input.html` — `digitPattern` input stays; `pattern` is forwarded as the per-cell attribute.
- `apps/web/app/src/app/shared/ui/forms/checkbox/checkbox.ts` + `checkbox.html` — add `required` pass-through. `[invalid]` keeps the same semantics; host adds `data-invalid` so the CSS rule can paint the border from the rule, not the component.
- `apps/web/app/src/app/shared/ui/forms/radio-group/radio-group.ts` + `radio-group.html` — add `required` pass-through. Host exposes `data-invalid` so the rule can paint the per-option border (today a wrapper class is used).
- `apps/web/app/src/app/shared/ui/forms/switch/switch.ts` + `switch.html` — add `required` pass-through. Same `data-invalid` host pattern.
- `apps/web/app/src/app/shared/ui/forms/radio-card/radio-card.ts` + `radio-card.html` — same.
- `apps/web/app/src/app/shared/ui/forms/color-picker/color-picker.ts` + `color-picker.html` — same.
- `apps/web/app/src/app/shared/ui/forms/error-message/error-message.ts` + `error-message.html` — always render the host `<p role="alert" data-slot="error">`. Content comes from `[manualError]` or content projection. Defaults stay `max-h-0 overflow-hidden`.
- `apps/web/app/src/app/shared/ui/forms/form/form.ts` + `form.html` — **new primitive**. Wraps the native `<form>`. Inputs: `[submitted]` signal that mirrors onto `data-submitted` on the host, `[novalidate]` (boolean) passed through to `<form>`, `(submit)` output. Projected via `<ng-content>`.
- `apps/web/app/src/app/shared/form/form-errors.ts` + `form-errors.spec.ts` — drop the `control.touched` gate; the function becomes a pure key-to-message translator.
- `apps/web/app/src/app/auth/sign-in/sign-in.ts` + `sign-in.html` — migrate per the new shape: drop the `emailError` / `passwordError` signals and updaters, use `computed()`s that call `controlError()`, drop `(blur)` and the `@if` wrapper around `<app-error-message>`, wrap the form with `<app-form [(submitted)]="submitted">`.
- `apps/web/app-e2e/src/auth/sign-in.spec.ts` — add a focused e2e for the typing-window behavior (error hidden while focused, shown after blur, hidden again on focus) plus a `data-submitted` test that submits an empty form and asserts the per-field error reveals.

**Reveal rule (sketch, lands in `styles.base.css`):**

```css
@layer components {
  [data-control] app-error-message {
    max-height: 0;
    overflow: hidden;
    opacity: 0;
    margin-top: 0;
    transition:
      max-height var(--motion-base),
      opacity var(--motion-base),
      margin-top var(--motion-base);
  }

  /* Native validity (post-blur) */
  [data-control]:not(:focus-within):has(app-input input:not(:placeholder-shown):not(:autofill):invalid)
    app-input
    > input,
  [data-control]:not(:focus-within):has(app-password-input input:not(:placeholder-shown):not(:autofill):invalid)
    app-password-input
    > input,
  [data-control]:not(:focus-within):has(app-textarea textarea:not(:placeholder-shown):not(:autofill):invalid)
    app-textarea
    > textarea,
  [data-control]:not(:focus-within):has(app-select select:not(:focus):invalid) app-select > select,
  [data-control]:not(:focus-within):has(app-pin-input input:not(:placeholder-shown):not(:autofill):invalid)
    app-pin-input
    > input,
  [data-control]:has(app-checkbox input[type='checkbox']:invalid) app-checkbox,
  [data-control]:has(app-radio-group input[type='radio']:invalid) app-radio-group,
  [data-control]:has(app-switch input[type='checkbox']:invalid) app-switch,
  [data-control]:has(app-radio-card input[type='radio']:invalid) app-radio-card,
  [data-control]:has(app-color-picker [data-control-invalid]:invalid) app-color-picker,
  /* Manual override */
  [data-control][data-manual-invalid] app-input > input,
  [data-control][data-manual-invalid] app-password-input > input,
  [data-control][data-manual-invalid] app-textarea > textarea,
  [data-control][data-manual-invalid] app-select > select,
  [data-control][data-manual-invalid] app-pin-input > input,
  [data-control][data-manual-invalid] app-checkbox,
  [data-control][data-manual-invalid] app-radio-group,
  [data-control][data-manual-invalid] app-switch,
  [data-control][data-manual-invalid] app-radio-card,
  [data-control][data-manual-invalid] app-color-picker,
  /* Submitted-but-empty (closes the "submit empty form" gap) */
  [data-submitted] [data-control]:has(app-input input:invalid) app-input > input,
  [data-submitted] [data-control]:has(app-password-input input:invalid) app-password-input > input,
  [data-submitted] [data-control]:has(app-textarea textarea:invalid) app-textarea > textarea,
  [data-submitted] [data-control]:has(app-select select:invalid) app-select > select,
  [data-submitted] [data-control]:has(app-pin-input input:invalid) app-pin-input > input,
  [data-submitted] [data-control]:has(app-checkbox input:invalid) app-checkbox,
  [data-submitted] [data-control]:has(app-radio-group input:invalid) app-radio-group,
  [data-submitted] [data-control]:has(app-switch input:invalid) app-switch,
  [data-submitted] [data-control]:has(app-radio-card input:invalid) app-radio-card,
  [data-submitted] [data-control]:has(app-color-picker input:invalid) app-color-picker {
    border-color: var(--color-red-600);
  }

  /* Same selectors, dark mode */
  html.dark ... {
    border-color: var(--color-red-500);
  }

  /* Message reveal (one block, mirrors the border block) */
  [data-control]:not(:focus-within):has(...) app-error-message,
  [data-control][data-manual-invalid] app-error-message,
  [data-submitted] [data-control]:has(...) app-error-message {
    max-height: 6rem;
    opacity: 1;
    margin-top: 0.25rem;
  }

  @media (prefers-reduced-motion: reduce) {
    [data-control] app-error-message {
      transition: none;
    }
  }
}
```

Notes:

- `:has()` crosses Angular component boundaries because the components are rendered into the DOM as plain custom elements with their own template trees.
- `:not(:focus-within)` on the host `<app-field>` is the proxy for "no descendant has focus", which is the modern equivalent of "the user is not typing".
- The `data-manual-invalid` clause is what triggers the hybrid branch for `confirmPassword` mismatches, OTP errors, and HTTP-per-field errors.
- The `[data-submitted]` block is the new clause that closes the "submit empty form" gap without per-route boilerplate. `<app-form>` is the source of `data-submitted`.
- `app-pin-input` rides the same rule: each digit is an `<input>` with `[0-9]{1}` `digitPattern`; an invalid cell matches the same `:invalid` selector and reveals the error message. The pin-level error is set via `[manualError]` on the outer `<app-field>`.
- `app-checkbox`, `app-radio-group`, `app-switch`, `app-radio-card`, `app-color-picker` get the same treatment. For radio groups, the field-level error reveals when any radio in the group is `:invalid` (the `required` pass-through on the first input is enough to drive that).
- The `app-error-message` is always present in the DOM. The transition is on `max-height` and `opacity`, mirroring the legacy's `mt-0 max-h-96` swap.

### Slice 2 — Remaining auth + project-new + activation migration

Apply the same shape across the remaining consumers in focused, reviewable PRs:

- **PR2a** — `sign-up`, `verify-email`, `verify-device`. Three PRs of equal size; each replaces the boilerplate with one `computed()` per field and verifies the e2e stays green. Each wraps the form in `<app-form>`. For `verify-email` and `verify-device`, the OTP mismatch (server returns invalid code) uses `data-manual-invalid="true"` driven by a `manualError = signal('')` set in the catch block of `submit()`.
- **PR2b** — `forgotten-password`, `reset-password`. The latter carries the cross-field `confirmPassword` mismatch. Migrate using `[manualError]` on the `<app-field>` driven by a `computed()` that compares the two controls.
- **PR2c** — `activation`, `project-new`. Both carry async per-field errors (`activation.ts:253` already constructs them manually); route them through `[manualError]`. Both also carry required checkboxes / switches (activation's "I accept the terms" pattern, sign-up's marketing-opt-in if any); these ride the native CSS pipeline without manual plumbing.

Each PR removes `(blur)`, `markAllAsTouched()` for the migrated fields, and the `@if` wrapper around `<app-error-message>`. Each wraps the native `<form>` in `<app-form>`. Each replaces any in-template `(submit)="$event.preventDefault()"` with `(ngSubmit)="submit()"`.

### Slice 3 — Recipes + version + roadmap

- Update `docs/design-system/recipes.md`: rewrite the "Auth Shell", "Password Strength", "PIN / Verification Code", and "Field With Error" snippets. The Field With Error section documents:
  - Native case: `<app-field>` only; the CSS rule owns the reveal.
  - Manual case: `<app-field [manualError]="…">`; `data-manual-invalid` consumes the same rule.
  - Submitted-empty case: wrap the form with `<app-form [(submitted)]="…">` and the CSS rule reveals all per-field errors on submit.
  - Checkbox / radio / switch / radio-card / color-picker follow the same hybrid: `required` on the inner control, no `(blur)`.
- Add a new "## Form" entry documenting `<app-form>` and its `[(submitted)]` pattern.
- Bump `apps/web/app/version.json` from `1.5.0` to `1.6.0`.
- Add a "CSS-Driven Field Errors" entry in `docs/constitution/roadmap.md` linking this spec.
- Add a component test in `apps/web/app/src/app/shared/ui/forms/field/field.spec.ts` that asserts `[manualError]` toggles `data-manual-invalid` and that an empty `[manualError]` removes it (a focused unit test that captures the hybrid contract).
- Add `apps/web/app/src/app/shared/ui/forms/form/form.spec.ts` covering the submitted signal wiring.

## Verification

### Static

```bash
rg "control\.touched" apps/web/app/src
# expected: only the new e2e specs that intentionally exercise touched state, zero in form-errors.ts

rg "updateXError|updateEmailError|updatePasswordError|updateNameError|updateDescriptionError|updateLabelError|updatePinError" apps/web/app/src
# expected: 0 matches after Slice 2 lands

rg "markAllAsTouched" apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects
# expected: 0 matches after Slice 2 lands

rg "@if \(.*Error\(\); as message\)" apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects
# expected: 0 matches after Slice 2 lands
```

### Nx targets

```bash
pnpm nx run app:lint          # 0 errors, no new warnings
pnpm nx run app:typecheck     # 0 errors
pnpm nx run app:vite:test     # existing tests pass; new field.spec.ts and sign-in spec additions pass
pnpm nx run site:lint
pnpm nx run site:typecheck
pnpm nx run ui-designer:lint
pnpm nx run ui-designer:build
```

### E2E

```bash
# Sign-in (gateway boot required)
pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production
node dist/apps/web/server/main.js &
sleep 6
pnpm nx e2e app-e2e --grep sign-in

# Auth flow + sign-in typing-window snapshot
node scripts/capture-auth-flow.cjs
```

### Manual behavioral checks

| ID   | Surface                                                                                                            | Expected behavior                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| M-1  | `/app/en/sign-in` — empty email submit                                                                             | `<app-error-message>` reveals after blur + content + invalid                                                                    |
| M-2  | `/app/en/sign-in` — typing                                                                                         | Error hides while focus is inside the field; reappears on blur if the value is still invalid                                    |
| M-3  | `/app/en/sign-in` — autofill                                                                                       | Chrome's autofill of an invalid email does NOT trigger the red border on first paint (the `:not(:autofill)` clause guards this) |
| M-4  | `/app/en/sign-in` — dark mode                                                                                      | Red border uses `dark:border-red-500`; the message foreground uses `dark:text-red-400`                                          |
| M-5  | `/app/en/reset-password` — confirm mismatch                                                                        | The `confirmPassword` field shows a manual error (`data-manual-invalid`) without the input being `:invalid` natively            |
| M-6  | `/app/en/verify-email` — wrong OTP                                                                                 | After submit, the `pin` field shows a manual error inline                                                                       |
| M-7  | `/app/en/verify-email` — typing the right code                                                                     | The pin error remains hidden (no flicker) until `submit()` finishes                                                             |
| M-8  | `/app/en/forgotten-password` — invalid email format                                                                | Border + message reveal after blur; hidden during typing                                                                        |
| M-9  | Snapshot — `media/ui-snapshots/auth-sign-in-{360,1280}-{light,dark}.png` show the post-blur red border and message |                                                                                                                                 |
| M-10 | `/app/en/sign-up` — submit with every field empty                                                                  | After clicking Submit, all required fields reveal their error message via `[data-submitted]` clause (no per-route plumbing)     |
| M-11 | `/app/en/activation` — required "I accept the terms" checkbox unchecked at submit                                  | Checkbox paints red; the field-level message reveals via `[data-submitted]`                                                     |
| M-12 | `/app/en/sign-up` — required "I agree to the privacy policy" checkbox checked, then unchecked                      | Checkbox pattern behaves like a native field: no reveal while focus is on it, reveal on blur if `:invalid`                      |

### Accessibility checks

- Contrast: `red-600` on `zinc-50` ≥ 4.5:1 in light mode; `red-400` on `zinc-900` ≥ 4.5:1 in dark mode. Verified by axe (`pnpm nx e2e app-e2e --grep @a11y`) when the gateway is reachable.
- `aria-invalid="true"` reflects on every control whose `<app-field>` is in either reveal state. For native cases the input derives it from its own `NgControl.status` (wired via the existing CVA registration); for manual cases the parent sets the `[invalid]` input on the inner control as today.
- `role="alert"` stays on `<app-error-message>`. The message is in the DOM at all times but hidden via `max-height: 0` + `opacity: 0`, so SRs do not announce on mount; they announce on the visibility reveal. The transition window is short (`var(--motion-base)` = 200ms).

## Risks

| Risk                                                                                                                                                   | Mitigation                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:has()` selector support is uneven in older browsers                                                                                                  | The matrix is Chromium-only by policy (`docs/constitution/tech-stack.md`); `:has()` shipped Chrome 105+. Today the gate is "best effort" outside the supported matrix; gating to Chromium is documented in `tech-stack.md`.                                                                    |
| The `app-pin-input` renders multiple `<input>`s; `:has(... input:invalid)` matches if any digit is invalid                                             | Cell-level errors stay per-cell (red border on the offending cell, error message on the field). The field-level error stays hidden unless `[manualError]` is set. Tested explicitly in `pin-input.spec.ts`.                                                                                    |
| `<app-form>` race: the user clicks Submit, the `[(submitted)]` signal flips to true, but the form's native validation has already cancelled the submit | The `(ngSubmit)` event only fires when the browser's native validation passes (today the routes use `novalidate`, so `ngSubmit` fires regardless; the auth-level `<app-alert>` still gates on `form.invalid`). `data-submitted` is set in `submit()` and the error reveal follows immediately. |
| Existing e2e specs that target `app-error-message` visibility might rely on the old touched-first pattern                                              | Adjust the affected specs in Slice 1 alongside the sign-in migration. The new e2e asserts the typing-window behavior explicitly.                                                                                                                                                               |
| `<app-error-message>` becoming a permanent DOM node increases initial DOM weight per form                                                              | Marginal: one `<p>` per field with `max-height: 0`. No images, no listeners. SSR cost is negligible.                                                                                                                                                                                           |

## Alternatives Considered

1. **Stay on the existing `control.touched` pipeline but improve it.** Rejected: the user's complaint is structural, not cosmetic. The Angular pipeline duplicates work the browser does natively.
2. **Migrate fully to template-driven forms with `NgModel`.** Rejected: the rest of the stack relies on `FormGroup` for cross-field validation and submit aggregation; the migration cost is much higher for the same UX gain.
3. **Replace `<app-error-message>` with native browser tooltip via `setCustomValidity`.** Rejected: the design system mandates its own chrome for visual rhythm with the rest of the surfaces.
4. **Move the CSS rule into the consumer templates instead of `styles.base.css`.** Rejected: the rule is global by nature and the `:has()` selector doesn't scope well to a single template; centralizing matches the existing pattern (`ui-focus-ring`, `ui-panel` are all global in `styles.base.css`).
5. **Drop the `[manualError]` override and force every error through the native pipeline.** Rejected: cross-field mismatches, HTTP-per-field errors, and OTP mismatches don't fit the native pipeline cleanly. The hybrid is the user's expressed intent.

## Success Criteria

- The static guards in the "Verification" section return the expected counts.
- `pnpm nx run app:lint`, `pnpm nx run app:typecheck`, `pnpm nx run app:vite:test`, `pnpm nx run site:lint`, `pnpm nx run site:typecheck`, `pnpm nx run ui-designer:lint`, `pnpm nx run ui-designer:build` all pass.
- The e2e suite for `sign-in` (and the migrated auth routes) passes against the new typing-window behavior; the manual behavioral checks M-1..M-12 hold.
- `apps/web/app/version.json` is `1.6.0`.
- `docs/constitution/roadmap.md` lists this spec under a new "CSS-Driven Field Errors" entry pointing at `docs/specs/2026-06-28-css-driven-field-errors/`.
- `docs/design-system/recipes.md` no longer documents `(blur)` / `@if` for the auth field recipe and documents the `<app-form>` / `[(submitted)]` pattern.
- `apps/web/app-e2e/src/auth/sign-in.spec.ts` carries an explicit test for the typing-window behavior and for the data-submitted reveal.
- `apps/web/app/src/app/shared/ui/forms/form/form.spec.ts` passes.

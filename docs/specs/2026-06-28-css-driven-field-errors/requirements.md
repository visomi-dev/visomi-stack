# CSS-Driven Field Errors — Requirements

## Functional Requirements

### FR-1 — Native validity reveal via CSS

`<app-error-message>` and the red border on `<app-input>` / `<app-password-input>` / `<app-textarea>` / `<app-select>` / `<app-pin-input>` / `<app-checkbox>` / `<app-radio-group>` / `<app-switch>` / `<app-radio-card>` / `<app-color-picker>` reveal together when the inner control is `:invalid`, has content (`:not(:placeholder-shown)` for the text-based primitives), is not autofilled (`:not(:autofill)` for the text-based primitives), and neither the field nor any descendant has focus (`:not(:focus-within)`). The rule lives in `styles.base.css` under `@layer components` and uses `:has()` to bridge Angular component boundaries. For binary controls (checkbox / radio / switch / radio-card) the `:placeholder-shown` and `:autofill` clauses do not apply — only `:invalid` and `:focus-within` do.

- **Where:** `styles.base.css`, `apps/web/app/src/app/shared/ui/forms/field/field.ts`, every form primitive as listed.
- **Acceptance:** the CSS rule covers all ten primitives. A unit + e2e assertion confirms the typing-window behavior (error hidden while focused, revealed on blur if invalid) for text-based primitives, and the click-out behavior for binary primitives.
- **Verification:** `pnpm nx e2e app-e2e --grep sign-in --grep @typing-window` passes for text primitives; `pnpm nx e2e app-e2e --grep @checkbox-required` passes for binary primitives.

### FR-2 — Manual error override

`<app-field>` exposes `[manualError]` (string | null). When non-empty, the host carries `data-manual-invalid="true"`, which the same CSS rule consumes to reveal the error and the red border. The signal can come from anywhere (computed `control.value !== expected`, an HTTP response mapped to a field, an OTP mismatch, etc.). The override works for every primitive in FR-1 (the rule's manual branch paints the inner control + reveals the message).

- **Where:** `apps/web/app/src/app/shared/ui/forms/field/field.ts`. Consumers reference it for cross-field mismatches and HTTP errors.
- **Acceptance:** `rg "data-manual-invalid" apps/web/app/src/app/shared/ui/forms/field` returns at least one match. After Slice 2, `rg "data-manual-invalid" apps/web/app/src/app/auth/reset-password apps/web/app/src/app/auth/verify-email apps/web/app/src/app/auth/verify-device apps/web/app/src/app/auth/forgotten-password` returns matches for reset-password (confirm), verify-email (pin), verify-device (pin), forgotten-password (email if used).
- **Verification:** the `field.spec.ts` toggles `[manualError]` and asserts the host attribute flips.

### FR-3 — `<app-field>` invalid + manualError inputs

`<app-field>` exposes two inputs:

- `invalid: boolean` — emits `data-invalid` on the host (existing documented contract that this PR implements).
- `manualError: string | null` — emits `data-manual-invalid` on the host when non-empty.

Both attributes co-exist. The CSS rule uses `data-manual-invalid` for the manual branch; `data-invalid` remains available for child controls that read it (e.g. `<app-description>` styling).

- **Where:** `apps/web/app/src/app/shared/ui/forms/field/field.ts`.
- **Acceptance:** the component has both inputs and toggles both attributes. Unit tests cover both toggles and the empty-string case for `manualError`.
- **Verification:** `pnpm nx run app:vite:test -- field.spec.ts` passes.

### FR-4 — `<app-error-message>` always rendered, message reactive

`<app-error-message>` is always rendered. Its content comes from `[manualError]` (string) or from content projection. The component renders the host `<p role="alert" data-slot="error">` with `max-height: 0; opacity: 0;` defaults; the global CSS rule overrides them when the field is in a reveal state.

- **Where:** `apps/web/app/src/app/shared/ui/forms/error-message/error-message.ts` and `error-message.html`.
- **Acceptance:** the component no longer requires a parent `@if` wrapper. The `p` is always in the DOM.
- **Verification:** static check confirms zero `@if (...; as message) { <app-error-message> ... }` wrappers remain after Slice 2.

### FR-5 — Pass-through validation attributes

`<app-input>`, `<app-password-input>`, `<app-textarea>`, `<app-select>`, `<app-pin-input>`, `<app-checkbox>`, `<app-radio-group>`, `<app-switch>`, `<app-radio-card>`, `<app-color-picker>` accept and forward the following inputs to the DOM so the browser owns validity:

- `pattern?: string`
- `required?: boolean`
- `minlength?: number | string`
- `maxlength?: number | string`
- `min?: number | string`
- `max?: number | string`

`<app-pin-input>` keeps its `digitPattern?: string` input. Binary controls (checkbox / radio / switch / radio-card / color-picker) accept `required` at minimum.

- **Where:** each primitive's `.ts` + `.html`.
- **Acceptance:** rendered DOM includes the attributes when the inputs are set on the consumer. `pnpm nx run app:vite:test -- input.spec.ts -- password-input.spec.ts -- pin-input.spec.ts -- checkbox.spec.ts -- radio-group.spec.ts -- switch.spec.ts` passes.
- **Verification:** an existing input spec that sets `pattern` and submits an empty form asserts `:invalid` becomes true. A new checkbox spec sets `required`, leaves the box unchecked, and asserts `:invalid` is true.

### FR-6 — `controlError()` loses the `touched` gate

`apps/web/app/src/app/shared/form/form-errors.ts` becomes a pure translator:

```ts
export function controlError(control: AbstractControl | null, messages: Record<string, string>): string {
  if (!control || !control.invalid) return '';
  for (const [key, value] of Object.entries(messages)) {
    if (control.hasError(key)) return value;
  }
  return 'This field is invalid.';
}
```

No `control.touched` gate. Visibility is owned by CSS.

- **Where:** `apps/web/app/src/app/shared/form/form-errors.ts` + `form-errors.spec.ts`.
- **Acceptance:** `rg "control\.touched" apps/web/app/src/app/shared/form` returns 0 matches; the updated `form-errors.spec.ts` covers the new behavior.
- **Verification:** the existing `controlError` consumer sites compile and behave identically for valid / invalid controls; visibility tests confirm the CSS path owns reveal.

### FR-7 — `<app-form>` primitive with `data-submitted`

A new `<app-form>` primitive wraps the native `<form>` element and tracks whether the form has been submitted at least once. Inputs and outputs:

- `submitted: signal<boolean>` (input/output via `model()`) — exposed on the host as `data-submitted="true"` whenever the value is `true`. Setting it externally resets it; flipping it internally happens on `(ngSubmit)` and on a submit attempt.
- `novalidate: boolean` — forwarded to the native `<form [attr.novalidate]>`.
- `(submit)` output — bubbles the native submit event after the host has flipped `submitted` to `true`. Routes continue to use `(ngSubmit)`.
- Default slot for projected content (the form's controls).

The CSS rule consumes `[data-submitted]` to reveal errors on every per-field `<app-error-message>` whose field is `:has(... input:invalid)` — including empty required fields, which is the gap that motivated the primitive.

- **Where:** `apps/web/app/src/app/shared/ui/forms/form/form.ts` + `form.html` + `form.spec.ts` (new files).
- **Acceptance:** the primitive renders a native `<form>` host element with `data-submitted` flipping in lockstep with the `submitted` signal; the unit test toggles the signal and asserts the host attribute; routes wrap their forms with `<app-form [(submitted)]="submitted">` (or use a local signal).
- **Verification:** `pnpm nx run app:vite:test -- form.spec.ts` passes. Manual M-10 / M-11 hold against the form.

### FR-8 — Sign-in migrated as reference

`apps/web/app/src/app/auth/sign-in/sign-in.ts` no longer carries `emailError`, `passwordError`, `updateEmailError`, `updatePasswordError`. `emailErrorText()` and `passwordErrorText()` are `computed()`s that call `controlError()` directly. `sign-in.html` drops `(blur)="updateXError()"` and the `@if` wrappers; `<app-error-message>` always renders. The native `<form>` is wrapped in `<app-form [(submitted)]="submitted">`. `markAllAsTouched()` is removed from `submit()`; the auth-level `<app-alert>` still gates on `form.invalid` for the network error path.

- **Where:** `apps/web/app/src/app/auth/sign-in/sign-in.ts`, `sign-in.html`, `apps/web/app-e2e/src/auth/sign-in.spec.ts`.
- **Acceptance:** the sign-in component no longer has the per-field signal/updater quadruplets. The e2e suite for sign-in (including the new typing-window test and the submitted-empty test) passes.
- **Verification:** `pnpm nx e2e app-e2e --grep sign-in` passes; `pnpm nx run app:vite:test` passes.

### FR-9 — Remaining auth + project-new + activation migrated

`sign-up`, `verify-email`, `verify-device`, `forgotten-password`, `reset-password`, `activation`, `project-new` follow the same shape. Each consumer carries:

- One `computed()` per field that calls `controlError()`.
- `<app-field>` with `[manualError]` for cases that don't fit native validity (HTTP per-field, cross-field, OTP mismatch).
- No `(blur)`, no `@if` wrapper around `<app-error-message>`, no `markAllAsTouched()` for field reveal (auth-level alert still uses `form.invalid`).
- The `<form>` wrapped in `<app-form [(submitted)]="…">`.
- `required` set on required checkboxes / switches / radio-groups; no manual `[invalid]` plumbing for them.

- **Where:** each route's `.ts` + `.html`.
- **Acceptance:** `rg "markAllAsTouched" apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects` returns 0 matches. `rg "updateXError|updateEmailError|updatePasswordError|updateNameError|updateDescriptionError|updateLabelError|updatePinError|updateConfirmPasswordError" apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects` returns 0 matches. Every affected e2e spec passes.
- **Verification:** `pnpm nx e2e app-e2e --grep @a11y --grep sign-up --grep forgotten-password --grep reset-password` passes (when gateway is reachable).

### FR-10 — Recipes doc rewritten

`docs/design-system/recipes.md` updates the "Auth Shell", "Password Strength", "PIN / Verification Code", and "Field With Error" snippets to drop `(blur)` and `@if` wrappers. The Field With Error section documents the new contract:

- `app-field` exposes `[invalid]` and `[manualError]`.
- `<app-error-message>` is always present in the DOM.
- The reveal rule is global (in `styles.base.css`) and never author-side.
- `<app-form [(submitted)]="…">` wraps every native `<form>` to handle the "submit empty form" gap.
- Checkboxes / switches / radio-groups / radio-cards / color-pickers follow the same hybrid: `required` on the inner control, no `(blur)`, no manual `[invalid]`.

A new "## Form" recipe documents `<app-form>` and its `[(submitted)]` pattern.

- **Where:** `docs/design-system/recipes.md`.
- **Acceptance:** `rg "updateEmailError|updatePasswordError" docs/design-system` returns 0 matches. The recipes mention `manualError`, `<app-form>`, and the new shape.
- **Verification:** diff review vs. `sign-in.html` after Slice 2.

### FR-11 — Version bump

`apps/web/app/version.json` bumps from `1.5.0` to `1.6.0`.

- **Where:** `apps/web/app/version.json`.
- **Acceptance:** `cat apps/web/app/version.json` reports `"version": "1.6.0"`.
- **Verification:** static check after Slice 3 lands.

### FR-12 — Roadmap entry

`docs/constitution/roadmap.md` carries a new "CSS-Driven Field Errors" section pointing at this spec, with the same slice plan used by the previous specs (PR1 = primitive migration + sign-in + `<app-form>`; PR2 = remaining consumers; PR3 = recipes + version + roadmap).

- **Where:** `docs/constitution/roadmap.md`.
- **Acceptance:** `rg "CSS-Driven Field Errors" docs/constitution/roadmap.md` returns 1 match.
- **Verification:** static check after Slice 3 lands.

## Non-Functional Requirements

### NFR-1 — Accessibility

- `aria-invalid="true"` reflects on every control whose `<app-field>` is in either reveal state:
  - Native branch: derives from the inner control's `NgControl.status` (wired through the existing `ControlValueAccessor` registration).
  - Manual branch: parent sets `[invalid]="!!manualError()"` on the inner control as today.
- `role="alert"` stays on `<app-error-message>`. The message is in the DOM at all times but hidden via `max-height: 0; opacity: 0;`. SRs announce on the visibility reveal, not on mount.
- Contrast holds:
  - `red-600` on `zinc-50` ≥ 4.5:1 (light mode message).
  - `red-400` on `zinc-900` ≥ 4.5:1 (dark mode message).
  - Red border against `zinc-50` / `zinc-900` ≥ 3:1 (UI components, non-text).
- `prefers-reduced-motion` collapses the reveal transition to 1ms via the existing `@media (prefers-reduced-motion: reduce)` block in `styles.base.css`.

### NFR-2 — Mobile-first

- The reveal behavior is identical at every viewport. The CSS rule targets pseudo-classes, not media queries.
- Touch targets stay ≥ 44px (`ui-touch-target`).
- The auth card mobile padding from the previous review (≥ 24px outer gutter) is unchanged.

### NFR-3 — Performance

- CSS bundle weight: net negative. The rule replaces the per-component Tailwind conditional `border-red-600 dark:border-red-500` class (compiled twice) with one global rule. Estimated saving: a few hundred bytes per form.
- JS bundle weight: net negative. The `(blur)` handlers and the `signal('')` boilerplate disappear per consumer. The CSS rule carries the visibility logic.
- No new dependencies.

### NFR-4 — Internationalization

- No new copy. The error message strings (e.g. `@@signInEmailErrorInvalid`) stay.
- `pnpm nx run app:extract-i18n` produces an unchanged `messages.es.xlf` byte-for-byte.

### NFR-5 — Tenant isolation

- Not applicable. This spec touches presentation layer only.

## Context

### Architectural reference

Themis — website + webapp + webapi + gateway + websocket fanout + worker queues backed by Postgres + Redis behind an Nx monorepo — is the production-quality architectural reference. The legacy `nive-web-app-old` Angular project is not. This spec cherry-picks one specific UX pattern from the legacy (the typing-window error reveal) and explicitly stops there. Every other form-UX decision, validation pipeline choice, routing model, and data-layer interaction in this codebase stays aligned with Themis' architecture as defined in `docs/constitution/mission.md`, `docs/constitution/tech-stack.md`, and `docs/constitution/roadmap.md`. A reviewer who reads this spec should not infer that Themis is moving back to the legacy's overall templates; only the error-reveal mechanism changes, in a deliberately scoped PR.

### Tone

- Source copy, code identifiers, commit messages, comments, and recipes remain in English (per `AGENTS.md`). User-facing translatable strings stay under `$localize` so the i18n extraction picks them up.
- The new `<app-form>` primitive follows the existing naming pattern (`app-*` selectors, bare file names, kebab-case folders). It joins the design system the same way every other primitive does.
- The spec's prose avoids editorialising about Angular UI-lib idioms in general; the only judgement is structural (the `touched` gate is replaced because it duplicates work the browser already does natively).

## Out of Scope

- No redesign of any auth route copy, layout, or section order.
- No changes to backend, API, or worker contracts.
- No migration to template-driven forms or `NgModel`.
- No removal of `<app-alert>` for async auth failures.
- No automated visual regression of the new behavior.
- No `DESIGN.md` manuscript realignment.
- No per-cell pin error states (each digit's red border is the field-level state today; per-cell detail is a follow-up).
- No SSR-specific reveal behavior (the rule is DOM-based and works the same on server-rendered and hydrated trees).

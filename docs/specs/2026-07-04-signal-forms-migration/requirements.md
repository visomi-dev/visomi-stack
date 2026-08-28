# Signal Forms Migration — Requirements

## Functional Requirements

### FR-1 — Pure Signal Forms API in every form

Every `FormGroup`, `FormControl`, `FormBuilder`, and `ReactiveFormsModule` import in `apps/web/app/src/app/` is removed. Every form is declared as a `signal()` of a plain model, passed to `form(model, schema, options?)` from `@angular/forms/signals`, and consumed in templates via `[formField]` (inner controls), `[formRoot]` (the wrapper or native `<form>`), and `form().submitting()` (loading state). `compatForm` and `SignalFormControl` from `@angular/forms/signals/compat` are not used in production code.

- **Where:** every form primitive (`apps/web/app/src/app/shared/ui/forms/{input,password-input,pin-input,textarea,select,checkbox,radio-group,radio-card,switch,color-picker,form}/*.{ts,html}`), every route (`apps/web/app/src/app/auth/**/*.ts`, `apps/web/app/src/app/activation/*.ts`, `apps/web/app/src/app/projects/*.ts`).
- **Acceptance:** `rg "FormGroup|FormControl|FormBuilder|ReactiveFormsModule|formControlName|formGroupName|\[formGroup\]|\[formControl\]" apps/web/app/src/app` returns 0 matches. `rg "from '@angular/forms'" apps/web/app/src/app | grep -v "@angular/forms/signals"` returns 0 matches.
- **Verification:** static guard runs in CI; the lint and typecheck targets accept the new code.

### FR-2 — `form()` + `FieldTree` replaces `FormGroup`

Each route declares a `readonly signInForm: FieldTree<{…}> = form(model, schema, options?)`. The schema callback lists every validation rule (`required`, `email`, `minLength`, `pattern`, `validate`) with its `{message: '…'}` option carrying the i18n string. The options object carries `submission: { action: async (field) => { … } }` so the framework drives the submit lifecycle.

- **Where:** `sign-in.ts`, `sign-up.ts`, `forgotten-password.ts`, `reset-password.ts` (two steps → two `FieldTree`s), `verification-code-form.ts` (used by `verify-email.ts` and `verify-device.ts`), `activation.ts`, `project-new.ts`.
- **Acceptance:** the new `.ts` files compile under `pnpm nx run app:typecheck`; the `form()` calls return a `FieldTree<…>` whose type matches the `signal()` model.
- **Verification:** a unit test in each route asserts `signInForm().value()` updates when a `set` lands and that `signInForm.email().errors()` reports the rule's `message` after a failing value.

### FR-3 — `[formField]` directive replaces `formControlName`

Every `<input [formControl]>` / `formControlName="x"` binding is replaced by `<input [formField]="signInForm.x">` (or the equivalent for `pin-input`, `radio-group`, etc.). The `[formField]` directive wires the underlying DOM control to the field tree, including `:invalid` / `aria-invalid`.

- **Where:** `sign-in.html`, `sign-up.html`, `forgotten-password.html`, `reset-password.html`, `verification-code-form.html`, `activation.html`, `project-new.html`, and every primitive template that today uses `[formControl]`.
- **Acceptance:** the rendered DOM after the migration carries `[formField]`-bound `<input>`s whose `:invalid` attribute tracks `f.x().invalid()`. The CSS rule from the previous spec reveals errors in lockstep.
- **Verification:** unit test per primitive: bind `[formField]`, set the model, and assert the DOM control is `:invalid` after a failing value. Render the route in a unit test and assert the same.

### FR-4 — `<app-form>` wrapper rewires to `[formRoot]`

`<app-form>` accepts a Signal-Forms root field tree (`[form]="signInForm"`) and renders `<form [formRoot]="form()" [attr.novalidate]="novalidate() ? '' : null" (submit)="onSubmit($event)">`. The `[(submitted)]` model + host `data-submitted` attribute are preserved. `(ngSubmit)` output stays for backward compatibility with routes that prefer the event-driven shape.

- **Where:** `apps/web/app/src/app/shared/ui/forms/form/form.ts` + `form.html` + `form.spec.ts`.
- **Acceptance:** the wrapper unit test toggles `[form]`, dispatches a `submit` event, and asserts `data-submitted` flips; `novalidate` pass-through; the `(ngSubmit)` output fires once.
- **Verification:** `pnpm nx run app:vite:test -- form.spec.ts` passes.

### FR-5 — Validation rules carry `{message: '…'}` inline

Each rule's `{message: '…'}` option holds the i18n string (`$localize` template). The template renders the message via `f.email().errors()[0]?.message ?? ''`. The previous `controlError()` translator is removed; the per-field message dictionary is gone.

- **Where:** every route's `form(model, schema, options)` callback. The constants live at the top of each route's `.ts` file (or in a shared `*.messages.ts` if a route has > 4 fields).
- **Acceptance:** `rg "controlError\(" apps/web/app/src/app` returns 0 matches after Slice 1. `apps/web/app/src/app/shared/form/form-errors.ts` is deleted.
- **Verification:** static guard + the deletion of the file in the PR diff.

### FR-6 — Cross-field rules use `validate(path, …)`

Cross-field cases (sign-up's `confirmPassword !== password`, reset-password's same) are expressed as `validate(p.confirmPassword, ({value, valueOf}) => …)` rules on the dependent field. No `Validators.compose` / `FormGroup.validator` plumbing.

- **Where:** `sign-up.ts` schema callback, `reset-password.ts` second-step schema callback.
- **Acceptance:** entering mismatched passwords in sign-up surfaces `f.confirmPassword().errors()[0]?.message` reading the localized mismatch string.
- **Verification:** route unit test asserts the rule fires when `value !== valueOf(p.password)`.

### FR-7 — Per-field server errors via `submission.action` return

Server errors that target a specific field (verify-email's wrong OTP, verify-device's wrong OTP) return `{kind: 'serverError', message: '…', fieldTree: field.pin}` from the `submission.action`. The framework attaches the error to the `pin` field; the CSS rule's `data-manual-invalid` clause surfaces it.

- **Where:** `verification-code-form.ts` (used by `verify-email.ts` and `verify-device.ts`).
- **Acceptance:** the unit test stubs the auth service to reject, invokes the form's `submit()`, and asserts `f.pin().errors()` contains the server-side message.
- **Verification:** e2e for `verify-email` exercises the wrong-OTP path and asserts the inline error.

### FR-8 — Per-route `manualError` via `[manualError]` on `<app-field>`

Routes that still need a per-route error signal (the previous spec's hybrid branch) keep using `<app-field [manualError]="…">`. The signal source is owned by the route and set in `submission.action` catch blocks (or any `effect` / `toSignal`).

- **Where:** `verify-email.ts` and `verify-device.ts` if a field-level error doesn't fit the `fieldTree` return path; `reset-password.ts` step 1 if the OTP needs a route-level message.
- **Acceptance:** `rg "manualError" apps/web/app/src/app/auth/verify-email apps/web/app/src/app/auth/verify-device apps/web/app/src/app/auth/reset-password` returns ≥ 1 match per route.
- **Verification:** the e2e suite covers the manual error reveal path.

### FR-9 — `disabled` rule replaces `control.disable()`

Every `control.disable()` / `control.enable()` call (if any) is replaced by `disabled(p.x, { when: () => this.isLoading() })`. The framework owns enable/disable transitions.

- **Where:** any route that today imperatively disables a control (e.g. the `auth.submitting` flow). The current code uses `[disabled]="submitting()"` at the button level; the same pattern continues. We add `disabled(p.submit, …)` only if a route needs to gate a control by signal state.
- **Acceptance:** static guard `rg "control\.disable\(\)|control\.enable\(\)" apps/web/app/src/app` returns 0 matches.
- **Verification:** static check after Slice 2.

### FR-10 — `submitting()` drives the button

The route's submit button uses `[disabled]="signInForm().submitting()"` (or `[loading]` if the design-system `Button` accepts it) so the framework's lifecycle is the single source of truth. The legacy `auth.submitting` alias is still readable for routes that already use it, but the new pattern is `form().submitting()`.

- **Where:** every route's submit button.
- **Acceptance:** during the action, the button is disabled and shows the loading affordance. After the action returns (success or error), the button re-enables. The e2e suite verifies the disabled state.
- **Verification:** `pnpm nx e2e app-e2e --grep sign-in --grep sign-up` (when gateway is reachable).

### FR-11 — i18n keys survive

Every i18n key from the previous spec (`@@signInEmailErrorInvalid`, `@@signInEmailErrorRequired`, `@@signInPasswordErrorMinlength`, `@@signInPasswordErrorRequired`, `@@signInAuthFailed`, `@@authOtpInvalid`, `@@signUpConfirmPasswordError`, `@@resetPasswordConfirmErrorMismatch`, etc.) survives. The `$localize` template moves from the `controlError()` call site to the rule's `{message}` option.

- **Where:** every route's schema callback.
- **Acceptance:** `pnpm nx run app:extract-i18n` produces a `messages.es.xlf` that is byte-identical to the previous spec's output (modulo any new keys).
- **Verification:** diff `messages.es.xlf` after `pnpm nx run app:extract-i18n`.

### FR-12 — Recipes doc rewritten

`docs/design-system/recipes.md` rewrites the "Auth Shell", "Password Strength", "PIN / Verification Code", "Field With Error", and "Form" snippets to use `form(model, schema, options)` + `[formField]`. The `manualError` and `<app-form>` story from the previous spec stays as written. A new "## Signal Forms" section documents the import line, the rule list, and the `submission.action` shape.

- **Where:** `docs/design-system/recipes.md`.
- **Acceptance:** `rg "FormGroup|FormControl|Validators|controlError" docs/design-system` returns 0 matches. The recipes mention `form()`, `[formField]`, `[formRoot]`, and `submission`.
- **Verification:** diff review vs. the route `.ts` files after Slice 2.

### FR-13 — Version bump

`apps/web/app/version.json` bumps from `1.6.0` to `1.7.0`.

- **Where:** `apps/web/app/version.json`.
- **Acceptance:** `cat apps/web/app/version.json` reports `"version": "1.7.0"`.
- **Verification:** static check after Slice 3 lands.

### FR-14 — Roadmap entry

`docs/constitution/roadmap.md` carries a new "Signal Forms Migration" section pointing at this spec with the same slice plan used by the previous spec (PR1 = primitive migration + sign-in + `<app-form>` + `form-errors` removal; PR2a = sign-up, forgotten-password; PR2b = reset-password; PR2c = verification-code-form; PR2d = activation, project-new; PR3 = recipes + version + roadmap).

- **Where:** `docs/constitution/roadmap.md`.
- **Acceptance:** `rg "Signal Forms Migration" docs/constitution/roadmap.md` returns 1 match.
- **Verification:** static check after Slice 3 lands.

## Non-Functional Requirements

### NFR-1 — Accessibility

- `aria-invalid="true"` reflects on every control whose field tree is in either reveal state (native `:invalid` from the rule, or the server-error path that returns `{fieldTree}` from `submission.action`).
- `role="alert"` stays on `<app-error-message>`. The message is in the DOM at all times but hidden via `max-height: 0; opacity: 0;`. SRs announce on the visibility reveal, not on mount.
- Focus order, label association, and `aria-describedby` are unchanged because the template structure of each primitive is unchanged.
- Contrast holds: same as the previous spec; nothing in this spec alters the message foreground or border color.
- `prefers-reduced-motion` collapses the reveal transition via the existing `styles.base.css` block.

### NFR-2 — Mobile-first

- The reveal behavior is identical at every viewport. The CSS rule targets pseudo-classes, not media queries.
- Touch targets stay ≥ 44px.
- The auth card mobile padding is unchanged.

### NFR-3 — Performance

- JS bundle weight: net negative. The legacy `FormGroup` machinery, the per-route `Validators` arrays, the `toSignal(valueChanges)` interop shims, and the `controlError()` translator are all removed. The Signal Forms runtime is roughly the same size as the `ReactiveFormsModule` runtime. Net effect: smaller per-route and smaller per-primitive bundles.
- CSS bundle weight: unchanged (the rule from the previous spec is reused as-is).
- No new dependencies. `@angular/forms/signals` ships in `@angular/forms@22`.

### NFR-4 — Internationalization

- The migration is i18n-neutral. The `$localize` template strings move from `controlError()` calls to `{message}` options on each rule. The key naming convention stays (`@@{page}{Section}{Description}`).
- `pnpm nx run app:extract-i18n` produces an unchanged `messages.es.xlf` (modulo any new keys added by routes that were missing a localized message).
- Server-side error messages returned from `submission.action` follow the same `$localize` pattern (the API returns the raw message; the route decides whether to translate it before forwarding to the field tree).

### NFR-5 — Tenant isolation

- Not applicable. This spec touches the client-side form layer only.

### NFR-6 — Server-side rendering

- Signal Forms renders deterministically in SSR. The `:invalid` state is computed from the model signal at render time; the form does not rely on `setTimeout` / browser-only APIs.
- `<app-form>` does not introduce any platform-specific code.
- The e2e suite covers the hydration path; no SSR-only assertions need to be added.

### NFR-7 — Backward compatibility

- `<app-form>` continues to expose `(ngSubmit)` and `[formGroup]` is removed (no consumer used both). Routes that today use `(ngSubmit)="submit()"` can continue to do so by configuring `submission: { action: this.submit.bind(this) }` and dropping the `(ngSubmit)` binding. The wrapper's `(ngSubmit)` output stays for any future route that prefers the event-driven shape.
- `ReactiveFormsModule` becomes unused but is not removed from the dependency graph (the package `@angular/forms` is still required for `HttpErrorResponse` etc.). The package version stays at `^22.0.2`.
- The `compatForm` and `SignalFormControl` exports stay in `@angular/forms/signals/compat`; they are not used in production code but are importable for future cross-system needs.

## Context

### Architectural reference

Themis — website + webapp + webapi + gateway + websocket fanout + worker queues backed by Postgres + Redis behind an Nx monorepo — is the production-quality architectural reference. Signal Forms is the new substrate in Angular v22; the migration lifts the form layer to the same signal-first style as the rest of the codebase (state, effects, templates, etc.).

### Tone

- Source copy, code identifiers, commit messages, comments, and recipes remain in English (per `AGENTS.md`).
- The new form layer is documented in plain TypeScript with `type` aliases (not `interface`); imports use `import type` for type-only imports.
- The spec's prose avoids editorialising about Angular UI-lib idioms in general; the only judgement is structural (Reactive Forms is the legacy API, Signal Forms is the new one).

## Out of Scope

- No redesign of any auth copy, layout, or section order.
- No changes to backend, API, or worker contracts.
- No removal of `ReactiveFormsModule` from `@angular/forms` (the package itself is part of Angular).
- No migration to template-driven forms or `NgModel`.
- No removal of `<app-alert>` for async auth failures.
- No automated visual regression of the new behavior.
- No `DESIGN.md` manuscript realignment.
- No per-cell pin error states (a follow-up, not in this spec).
- No introduction of dynamic forms, schemas as runtime data, or async-validation orchestration.
- No removal of `compatForm` from `@angular/forms/signals/compat`; the export stays even if unused in production.

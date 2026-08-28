# Signal Forms Migration — Software Design Document

## Decision

Migrate every Themis form (seven route components and the eleven design-system form primitives) from `@angular/forms` Reactive Forms (`FormGroup` / `FormControl` / `[formGroup]` / `formControlName` / `ControlValueAccessor`) to **Signal Forms**, the new `@angular/forms/signals` API. The migration is **pure**: `form()` + `[formField]` + `FormRoot` everywhere, with `compatForm` and `SignalFormControl` excluded from the production code paths. The wrapper `<app-form>` and the CSS reveal rule from [`docs/specs/2026-06-28-css-driven-field-errors/`](./2026-06-28-css-driven-field-errors/) carry forward; the data model underneath them changes.

The user-facing surface (CSS reveal, `[data-submitted]`, `data-manual-invalid`, `<app-error-message>`, all helper components, all error copy, all validation rules, all e2e assertions) stays byte-identical or grows by addition. The change lives in:

- `apps/web/app/src/app/{auth,activation,projects}/**/*.ts` — each route's class no longer declares a `FormGroup<…>`; it declares a `signal()` of a plain model and feeds it into `form(model, schema, options)`.
- `apps/web/app/src/app/shared/ui/forms/{input,password-input,pin-input,textarea,select,checkbox,radio-group,radio-card,switch,color-picker}/*.ts` — each primitive accepts a `[formField]` input and forwards it to its inner DOM control; the internal `ControlValueAccessor` registration is removed.
- `apps/web/app/src/app/shared/ui/forms/form/form.ts` — `<app-form>` accepts the signal-form root (`[form]="…"`) and renders `<form [formRoot]="form()" (submit)="onSubmit($event)">` instead of `[formGroup]`. `[(submitted)]` and `data-submitted` are preserved.
- `apps/web/app/src/app/shared/form/form-errors.ts` — removed. Validation rules carry `{message: '…'}` inline, and templates render `f.email().errors()[0]?.message ?? ''`.
- `package.json` — `@angular/forms` stays as a dependency (`@angular/forms/signals` ships in the same package); `ReactiveFormsModule` becomes unused and is no longer imported.

After this lands, every form in the codebase is signal-first; the legacy ReactiveForms imports are gone; the `compatForm` migration shim is not used in production code (it stays available in case an external library ever demands it).

## Why now

The previous spec ([`2026-06-28-css-driven-field-errors`](./2026-06-28-css-driven-field-errors/)) shipped the CSS reveal rule and the `<app-form>` wrapper while **leaving the legacy `FormGroup` machinery intact underneath**. The result is that seven route components still carry the full ReactiveForms boilerplate:

- `sign-in.ts:23-27,57-69,71-99` — a `SignInForm = FormGroup<{...}>` type, a `FormGroup` constructor with `Validators.required` / `email` / `minLength` arrays, two `toSignal(valueChanges)` interop shims, and a `computed()` that calls `controlError()` keyed by error code.
- `sign-up.ts`, `forgotten-password.ts`, `reset-password.ts:62-65,152-180`, `verification-code-form.ts:36-41`, `activation.ts:62-69,231-253`, `project-new.ts:83-113` — the same template, repeated seven times.
- `input.ts:26-46`, `password-input.ts:30-63`, `pin-input.ts:61-95`, `textarea.ts`, `select.ts`, `checkbox.ts:14-30`, `radio-group.ts`, `radio-card.ts:13-25`, `switch.ts`, `color-picker.ts` — each primitive still registers a `ControlValueAccessor` so the inner DOM control can bind via `[formControl]`.

Angular v22 promotes Signal Forms to a **stable, signal-native API**. The migration guide (`https://angular.dev/guide/forms/signals/migration`) frames Reactive Forms as the legacy pipeline and Signal Forms as the destination:

> "When a user submits a form, your application typically needs to handle multiple concerns at once: surfacing validation errors, preventing duplicate submission, sending data to a server, and much more. Handling each of these manually can be tedious and prone to error." ([Form submission](https://angular.dev/guide/forms/signals/form-submission))

The piece by piece motivation:

- **Routes carry signal state already** (`errorMessage = signal('')`, `submitted = signal(false)`, `emailError = computed(…)`). Driving a form from a `FormGroup` is the only legacy seam in those classes.
- **ReactiveFormsModule is the largest contributor to type drift.** Every `FormControl` constructor must declare `nonNullable` and a validator array; every `FormGroup` requires an explicit `FormGroup<{…}>` shape; every `formControlName="x"` is untyped. Signal Forms drop all of that.
- **The submission lifecycle is native.** `form({ submission: { action } })` calls the action only after validation passes, exposes `f().submitting()` so the button can disable itself, and clears server errors on the next edit (matching what we wired up manually before).
- **The CSS rule keeps working.** `[formField]` wires the inner `<input>` to the field tree, including `:invalid`. The `:has(input:invalid)` selectors from the previous spec are unchanged.
- **`[data-submitted]` keeps working.** `<app-form>` renders `[formRoot]` inside its host; the host keeps the `data-submitted` attribute, and the CSS rule targets `[data-submitted] [data-control]:has(input:invalid)` regardless of which form system produces the underlying control.

## Goals

1. Every `FormGroup` / `FormControl` / `FormBuilder` / `ReactiveFormsModule` import is removed from `apps/web/app/src/app/`.
2. Every `[formGroup]`, `formGroupName`, `[formControl]`, `formControlName`, `[ngModel]` is replaced by `[formField]="f.x"` (or equivalent) on the inner DOM control.
3. Every `Validators.{required,email,minLength,pattern,…}` array is replaced by per-rule `required(p.x, { message })` / `email(p.x, { message })` / `minLength(p.x, n, { message })` calls inside the `form(model, schema)` callback.
4. Every `markAllAsTouched()` call is removed (`submit()` in Signal Forms marks all interactive fields as touched automatically).
5. Every per-field `valueChanges` → `toSignal` → `computed(controlError)` triplet is removed; templates read `f.email().errors()[0]?.message` (or `errorSummary()`) directly.
6. The `controlError()` translator (`apps/web/app/src/app/shared/form/form-errors.ts`) is removed.
7. `<app-form>` accepts a Signal-Forms root field tree (`[form]="signInForm"`), renders `<form [formRoot]="form()" (submit)="onSubmit($event)">`, and keeps the `[(submitted)]` model + `data-submitted` host attribute.
8. Every form primitive (`app-input`, `app-password-input`, `app-textarea`, `app-select`, `app-pin-input`, `app-checkbox`, `app-radio-group`, `app-radio-card`, `app-switch`, `app-color-picker`) accepts a `[formField]` input and forwards it to the inner DOM control; the `ControlValueAccessor` registration is dropped.
9. The CSS reveal rule from `docs/specs/2026-06-28-css-driven-field-errors/` is reused untouched.
10. Every i18n message key (`@@signInEmailErrorInvalid`, etc.) survives in the templates via `$localize` inside each rule's `{message}` option.
11. Every e2e spec continues to pass with the same selectors; no new visual snapshots are required unless the rendered DOM changes.
12. No backend, API, worker, or realtime contract changes.

## Non-Goals

1. No redesign of any auth copy, layout, or interaction. The CSS reveal, the `data-submitted` flow, and the `manualError` override from the previous spec are the final user-facing surface for this slice; Signal Forms is the new substrate.
2. No introduction of `compatForm` or `SignalFormControl` in production code. Both stay importable (they ship in `@angular/forms/signals/compat`) but no Themis code uses them in this spec.
3. No removal of `<app-alert>` for async auth failures. Async `HttpErrorResponse` continues to surface via `<app-alert>`; only the per-field error rendering pipeline changes (from `controlError()` to `f.X().errors()`).
4. No changes to the design-system CSS rule in `styles.base.css`. Its selectors are expressed against DOM attributes (`[data-control]`, `data-manual-invalid`, `[data-submitted]`, `:has(input:invalid)`) and survive the migration unchanged.
5. No removal of `FormGroup`, `FormControl`, or `ReactiveFormsModule` from `@angular/forms`. The package remains a transitive dependency of Angular's tooling; only its imports in Themis source files disappear.
6. No migration to template-driven forms or `NgModel`.
7. No introduction of dynamic forms, schemas as runtime data, or async-validation orchestration. The static `form(model, schema)` shape is enough for every current route.
8. No automated visual regression of the new path. The previous spec's snapshot grid continues to be the catching net.
9. No per-cell pin error states. Pin-level error stays field-level; per-cell detail is tracked as a follow-up.
10. No `DESIGN.md` manuscript realignment.

## Audit Findings (Baseline)

| ID   | Surface                                                                                                                                                                           | Issue                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1  | `apps/web/app/src/app/auth/sign-in/sign-in.ts:23-27,57-69`                                                                                                                        | `FormGroup<{email,password,rememberDevice}>` and constructor with `Validators.{required,email,minLength}` arrays.                             |
| S-2  | `apps/web/app/src/app/auth/sign-up/sign-up.ts:24-27,59-72`                                                                                                                        | `FormGroup<{email,password,confirmPassword}>` + `Validators.compose` for the cross-field mismatch as a custom `FormGroup` validator.          |
| S-3  | `apps/web/app/src/app/auth/verification-code-form/verification-code-form.ts:15-17,37-41`                                                                                          | `FormGroup<{pin}>` + `Validators.pattern(/^\d{6}$/)`. Three auth flows reuse this primitive.                                                  |
| S-4  | `apps/web/app/src/app/auth/forgotten-password/forgotten-password.ts:21-22,38-42`                                                                                                  | `FormGroup<{email}>` + `Validators.required` + `Validators.email`.                                                                            |
| S-5  | `apps/web/app/src/app/auth/reset-password/reset-password.ts:24-26,67-77,152-180`                                                                                                  | `FormGroup<{password,confirmPassword}>` plus cross-field mismatch handled inline in `submit()`.                                               |
| S-6  | `apps/web/app/src/app/activation/activation.ts:29-31,62-68,231-253`                                                                                                               | `FormGroup<{label}>` + async per-field error set imperatively in an effect that watches `control.errors`.                                     |
| S-7  | `apps/web/app/src/app/projects/project-new/project-new.ts:24-26,59-69,83-113`                                                                                                     | `FormGroup<{name,summary}>` + per-field `nameError`, `descriptionError` signals + updaters, `(blur)` plumbing.                                |
| S-8  | `apps/web/app/src/app/shared/form/form-errors.ts:3-15`                                                                                                                            | `controlError()` translator driven by `FormControl.hasError()`.                                                                               |
| S-9  | `apps/web/app/src/app/shared/ui/forms/input/input.ts`                                                                                                                             | `ControlValueAccessor` registration; `[formControl]` directive on the inner `<input>`.                                                        |
| S-10 | `apps/web/app/src/app/shared/ui/forms/password-input/password-input.ts`                                                                                                           | Same — `[formControl]` on the inner `<input type="password">`.                                                                                |
| S-11 | `apps/web/app/src/app/shared/ui/forms/pin-input/pin-input.ts`                                                                                                                     | Custom CVA spanning N `<input>` cells; `[formControl]` on the parent.                                                                         |
| S-12 | `apps/web/app/src/app/shared/ui/forms/textarea/textarea.ts`                                                                                                                       | Same — `[formControl]` on the inner `<textarea>`.                                                                                             |
| S-13 | `apps/web/app/src/app/shared/ui/forms/select/select.ts`                                                                                                                           | Same — `[formControl]` on the inner `<select>`.                                                                                               |
| S-14 | `apps/web/app/src/app/shared/ui/forms/checkbox/checkbox.ts`                                                                                                                       | Same — `[formControl]` on the inner `<input type="checkbox">`.                                                                                |
| S-15 | `apps/web/app/src/app/shared/ui/forms/radio-group/radio-group.ts`                                                                                                                 | Same — `[formControl]` on the inner `<input type="radio">`.                                                                                   |
| S-16 | `apps/web/app/src/app/shared/ui/forms/radio-card/radio-card.ts:13-25`                                                                                                             | Same — `[formControl]` on the inner `<input type="radio">`.                                                                                   |
| S-17 | `apps/web/app/src/app/shared/ui/forms/switch/switch.ts`                                                                                                                           | Same — `[formControl]` on the inner `<input type="checkbox" role="switch">`.                                                                  |
| S-18 | `apps/web/app/src/app/shared/ui/forms/color-picker/color-picker.ts`                                                                                                               | Same — `[formControl]` on the PrimeNG `[role="combobox"]` (the inner control it forwards to).                                                 |
| S-19 | `apps/web/app/src/app/shared/ui/forms/form/form.ts`                                                                                                                               | Wrapper accepts `[formGroup]`, renders `<form [formGroup]="formGroup()">`, and toggles `data-submitted`. Will become `[form]` + `[formRoot]`. |
| S-20 | `apps/web/app/src/app/auth/sign-in/sign-in.html:29-86`                                                                                                                            | `formControlName="email"`, `formControlName="password"`, `formControlName="rememberDevice"`. Will become `[formField]="signInForm.x"`.        |
| S-21 | Same shape in `sign-up.html`, `forgotten-password.html`, `reset-password.html:66,79,93`, `verification-code-form.html:8,15`, `activation.html:41,48`, `project-new.html:18,22,41` | Same pattern repeated seven times.                                                                                                            |
| S-22 | `apps/web/app/src/app/auth/sign-in/sign-in.ts:71-99`                                                                                                                              | Two `toSignal(valueChanges)` interop shims that exist only to retrigger `computed()` calls.                                                   |
| S-23 | `apps/web/app/src/app/auth/reset-password/reset-password.ts:152-180`                                                                                                              | OTP cross-field handler with manual `pinError.set(...)` in the catch block.                                                                   |
| S-24 | `apps/web/app/src/app/shared/form/form-errors.spec.ts`                                                                                                                            | Tests `FormControl` constructors + `controlError()`. Will become obsolete.                                                                    |

### Out-of-scope follow-ups (tracked, not in this spec)

- Per-cell pin error states (a cell that fails the pattern lights up red independently of the field-level error).
- A11y audit on `[formField]`-bound `<input>`s once `:invalid` is driven through the Signal Forms control status.

## Implementation Strategy

### Slice 1 — Primitive migration + `<app-form>` rewrite + `form-errors` removal + `sign-in` proof

The first PR moves the design-system primitives to Signal Forms, rewrites the `<app-form>` wrapper, deletes `controlError()`, and migrates `sign-in` as the reference consumer. After PR1 ships, every other route follows the same shape on its own PR.

**Files touched:**

- `apps/web/app/src/app/shared/ui/forms/input/input.ts` + `input.html` + `input.spec.ts` — drop the CVA registration; add `readonly formField = input.required<FieldTree<string>>();`; forward to `<input [formField]="formField()" ...>`.
- `apps/web/app/src/app/shared/ui/forms/password-input/password-input.ts` + `password-input.html` + `password-input.spec.ts` — same.
- `apps/web/app/src/app/shared/ui/forms/textarea/textarea.ts` + `textarea.html` + `textarea.spec.ts` — same.
- `apps/web/app/src/app/shared/ui/forms/select/select.ts` + `select.html` + `select.spec.ts` — same.
- `apps/web/app/src/app/shared/ui/forms/pin-input/pin-input.ts` + `pin-input.html` + `pin-input.spec.ts` — same; `digitPattern` rules attach to each cell.
- `apps/web/app/src/app/shared/ui/forms/checkbox/checkbox.ts` + `checkbox.html` + `checkbox.spec.ts` — same; `required` pass-through stays.
- `apps/web/app/src/app/shared/ui/forms/radio-group/radio-group.ts` + `radio-group.html` + `radio-group.spec.ts` — same.
- `apps/web/app/src/app/shared/ui/forms/radio-card/radio-card.ts` + `radio-card.html` + `radio-card.spec.ts` — same.
- `apps/web/app/src/app/shared/ui/forms/switch/switch.ts` + `switch.html` + `switch.spec.ts` — same.
- `apps/web/app/src/app/shared/ui/forms/color-picker/color-picker.ts` + `color-picker.html` + `color-picker.spec.ts` — same; the inner DOM control becomes `[role="combobox"]` or `<input type="color">` with `[formField]`.
- `apps/web/app/src/app/shared/ui/forms/form/form.ts` + `form.html` + `form.spec.ts` — **rewritten**. New shape:

```ts
import { Component, booleanAttribute, input, model, output } from '@angular/core';
import { FormRoot, type FieldTree } from '@angular/forms/signals';

@Component({
  host: {
    class: /* tw */ 'block',
    '[attr.data-submitted]': 'submitted() ? "" : null',
  },
  selector: 'app-form',
  template: `
    <form [formRoot]="form()" [attr.novalidate]="novalidate() ? '' : null" (submit)="onSubmit($event)">
      <ng-content />
    </form>
  `,
  styleUrl: './form.css',
})
export class Form {
  readonly form = input.required<FieldTree<unknown>>();
  readonly submitted = model(false);
  readonly novalidate = input(true, { transform: booleanAttribute });
  readonly ngSubmit = output<void>();

  onSubmit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
    this.ngSubmit.emit();
  }
}
```

- `apps/web/app/src/app/shared/form/form-errors.ts` — **deleted**. `controlError()` is no longer needed.
- `apps/web/app/src/app/shared/form/form-errors.spec.ts` — **deleted**.
- `apps/web/app/src/app/auth/sign-in/sign-in.ts` — rewritten:

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { form, required, email, minLength, validate, type FieldTree } from '@angular/forms/signals';
import { FormField } from '@angular/forms/signals';
// (no more FormControl, FormGroup, ReactiveFormsModule, Validators, toSignal)

const MESSAGES = {
  emailRequired:    $localize`:@@signInEmailErrorRequired:Enter your email address.`,
  emailInvalid:     $localize`:@@signInEmailErrorInvalid:Enter a valid email address (e.g. you@company.com).`,
  passwordRequired: $localize`:@@signInPasswordErrorRequired:Enter your password.`,
  passwordMinLength:$localize`:@@signInPasswordErrorMinlength:Use at least 8 characters.`,
};

@Component({...})
export class SignIn {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly signInModel = signal({
    email: '',
    password: '',
    rememberDevice: true,
  });

  readonly signInForm: FieldTree<{email: string; password: string; rememberDevice: boolean}> = form(
    this.signInModel,
    (p) => {
      required(p.email,    { message: MESSAGES.emailRequired });
      email(p.email,       { message: MESSAGES.emailInvalid });
      required(p.password, { message: MESSAGES.passwordRequired });
      minLength(p.password, 8, { message: MESSAGES.passwordMinLength });
    },
    {
      submission: {
        action: async (field) => {
          await this.submit(field);
        },
      },
    },
  );

  readonly submitting = this.auth.submitting;
  readonly submitted = signal(false);
  readonly errorMessage = signal('');

  readonly emailError = computed(() => this.signInForm.email().errors()[0]?.message ?? '');
  readonly passwordError = computed(() => this.signInForm.password().errors()[0]?.message ?? '');

  private async submit(field: FieldTree<{email: string; password: string; rememberDevice: boolean}>) {
    if (this.submitting()) return;
    this.errorMessage.set('');
    try {
      const result = await this.auth.signInWithPassword({
        email: field().value().email,
        password: field().value().password,
        rememberDevice: field().value().rememberDevice,
      });
      if ('authenticated' in result) {
        await this.router.navigate([APP_URL]);
        return;
      }
      await this.router.navigate([VERIFY_DEVICE_URL]);
    } catch (error) {
      this.errorMessage.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? $localize`:@@signInAuthFailed:Authentication failed.`)
          : $localize`:@@signInAuthFailed:Authentication failed.`,
      );
    }
  }
}
```

Notes:

- The form is a `FieldTree` returned by `form(model, schema, options?)`. The options include `submission.action`, which the framework invokes after validation passes and which the route uses to drive its async work.
- The framework reads the `submission.action` `this`-bind automatically when the route stores the form as a class field, so `this.submit(field)` works without explicit arrow wrapping.
- The schema uses per-rule `{message}` options; the i18n strings live where the validation lives and the template renders `f.email().errors()[0]?.message` directly.
- `catching` the per-field binding to a `FieldTree<…>` type is supported via `signal<Model>()`.

- `apps/web/app/src/app/auth/sign-in/sign-in.html` — template rewires from `formControlName="email"` to `[formField]="signInForm.email"`, from `formControlName="password"` to `[formField]="signInForm.password"`, from `formControlName="rememberDevice"` to `[formField]="signInForm.rememberDevice"`. The `[formGroup]="form"` binding on `<app-form>` becomes `[form]="signInForm"`. The wrapping `<app-form>` stays. The `emailError()` / `passwordError()` computeds simplify to `f.email().errors()[0]?.message` reads (already done in the new `.ts` above). The `(blur)` bindings are gone (no longer needed; the CSS rule + `submit()`'s `markAsTouched()` replaces them). `markAllAsTouched()` is gone from `submit()`. `FormsModule` / `ReactiveFormsModule` import from the component is dropped.

- `apps/web/app/src/app/shared/ui/forms/form/form.spec.ts` — rewritten to bind `[form]="f"` where `f` is a small `FieldTree` from a `form(signal({email: ''}), () => { required(p.email, {message: '...'}); })`. Asserts `data-submitted` toggling and `novalidate` pass-through.

### Slice 2 — Remaining route migrations

Same shape as sign-in, applied route by route. Each PR replaces the boilerplate and verifies its e2e suite stays green. Each PR wraps the form in `<app-form [form]="…">` and drops `(blur)`, `markAllAsTouched()`, `toSignal(valueChanges)`, and the `controlError()` import.

- **PR2a** — `sign-up`, `forgotten-password`. The cross-field `confirmPassword` mismatch in sign-up uses a `validate` rule:

```ts
validate(p.confirmPassword, ({ value, valueOf }) => {
  const password = valueOf(p.password);
  return value && value !== password
    ? { kind: 'passwordMismatch', message: $localize`:@@signUpConfirmPasswordError:Passwords don't match.` }
    : null;
}),
```

- **PR2b** — `reset-password`. Two-step form: the OTP and the password each carry their own `FieldTree`. The cross-field `confirmPassword` mismatch in the password step uses the same `validate` rule. The current OTP `pinError.set(...)` becomes a `manualError = signal('')` set in the catch block and bound to `<app-field [manualError]>`.

- **PR2c** — `verification-code-form` (consumed by `verify-email` and `verify-device`). The OTP regex becomes `pattern(p.pin, /^\d{6}$/, { message: $localize`:@@authOtpInvalid:Enter the 6-digit code.` })` and the cross-field server error becomes a `manualError` binding.

- **PR2d** — `activation`, `project-new`. Both have small two-field forms; both carry per-field signals in the existing code; both fold cleanly into the Signal-Forms shape.

### Slice 3 — Recipes, version, roadmap, optional status-classes provider

- `docs/design-system/recipes.md` — rewrite the "Auth Shell", "Password Strength", "PIN / Verification Code", "Field With Error", and "Form" snippets to import from `@angular/forms/signals` and use `form(model, schema, options)` + `[formField]`. The manualError override and the `<app-form>` story stay as written in the previous spec.
- `apps/web/app/src/app/app.config.ts` — add `provideSignalFormsConfig({})` if/when any global behavior is desired; otherwise leave it out. (`NG_STATUS_CLASSES` is opt-in and we don't need it; the CSS rule targets native `:invalid`.)
- `apps/web/app/version.json` — bump from `1.6.0` to `1.7.0` (Signal Forms is the only breaking-shape change at the class level; user-facing behavior is identical).
- `docs/constitution/roadmap.md` — add a new "Signal Forms Migration" section pointing at this spec with the slice plan (PR1, PR2a, PR2b, PR2c, PR2d, PR3) and the version target.

### Notes on Signal Forms rule semantics

Signal-Forms validation rules run synchronously per change. Field-level errors live in `f.email().errors()` as `{kind, message}[]`. Templates read the first message (or any specific kind) with `f.email().errors()[0]?.message ?? ''`. The CSS rule from the previous spec reveals the message based on `:has(input:invalid)`, which the `FormField` directive wires up under the hood.

For server-side per-field errors (e.g. wrong OTP), the route captures the error in the `submission.action`, returns it from the action as `{kind: 'serverError', message: '…', fieldTree: field.pin}`, and the framework attaches it to that field. The CSS rule's `data-manual-invalid` reveal from the previous spec then surfaces it.

For cross-field mismatches, we use `validate(p.confirmPassword, ({value, valueOf}) => …)` so the rule lives next to the field it errors, not next to the form group.

For per-route `manualError` in templates, we use `<app-field [manualError]="manualErrorSignal()">` (the primitive added by the previous spec) — the signal source is owned by the route.

For `disabled` state, we use `disabled(p.x, { when: () => this.isLoading() })` instead of the legacy `control.disable()`.

## Verification

### Static

```bash
rg "FormGroup|FormControl|FormBuilder|ReactiveFormsModule|formControlName|formGroupName|\[formGroup\]|\[formControl\]" apps/web/app/src/app
# expected: 0 matches after Slice 2 lands

rg "Validators\." apps/web/app/src/app
# expected: 0 matches after Slice 2 lands (each rule migrates to @angular/forms/signals helpers)

rg "markAllAsTouched|toSignal\(.*\.valueChanges" apps/web/app/src/app
# expected: 0 matches after Slice 2 lands

rg "controlError\(" apps/web/app/src/app
# expected: 0 matches after Slice 1 lands (the translator is removed)

rg "@angular/forms" apps/web/app/src/app | grep -v "@angular/forms/signals"
# expected: only imports of types from @angular/forms (e.g. HttpErrorResponse-derived paths); no live FormGroup / FormControl imports

rg "from '@angular/forms/signals'" apps/web/app/src/app
# expected: matches in every migrated route + every migrated primitive

rg "@@signInEmailErrorInvalid|@@signInEmailErrorRequired|@@signInPasswordErrorMinlength|@@signInPasswordErrorRequired" apps/web/app/src/app
# expected: matches persist (i18n keys survive)

rg "manualError" apps/web/app/src/app
# expected: ≥ 7 matches (one route per cross-field / OTP / server-error path) using the [manualError] input on <app-field>
```

### Nx targets

```bash
pnpm nx run app:lint
pnpm nx run app:typecheck
pnpm nx run app:vite:test
pnpm nx run site:lint
pnpm nx run site:typecheck
pnpm nx run ui-designer:lint
pnpm nx run ui-designer:build
```

### E2E (gateway boot required)

```bash
pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production
node dist/apps/web/server/main.js &
sleep 6

pnpm nx e2e app-e2e --grep sign-in --grep @typing-window
pnpm nx e2e app-e2e --grep sign-up --grep forgotten-password --grep reset-password
pnpm nx e2e app-e2e --grep verify-email --grep verify-device --grep activation --grep project
pnpm nx e2e app-e2e --grep @a11y
```

### Manual behavioural checks

The previous spec already walks M-1..M-12 in `docs/specs/2026-06-28-css-driven-field-errors/sdd.md`. After this spec lands the same checks continue to hold, with one additional check the swap makes visible:

| ID   | Surface                                        | Expected behavior                                                                                                                                                                             |
| ---- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SF-1 | `/app/en/sign-in` — invalid email + submit     | The framework's `submit()` marks the email control touched; the CSS rule reveals the red border + message inline.                                                                             |
| SF-2 | `/app/en/sign-in` — `f.email().errors()` shape | Returns `[]` for valid, `[{kind: 'required', message: 'Enter your email address.'}, …]` for invalid.                                                                                          |
| SF-3 | `/app/en/sign-up` — `confirmPassword` mismatch | `f.confirmPassword().errors()[0]?.message` reads `'Passwords don't match.'` from the `validate` rule.                                                                                         |
| SF-4 | `/app/en/verify-email` — wrong OTP             | The `submission.action` returns `{kind: 'serverError', fieldTree: field.pin, message}`; the framework attaches the error to the pin field; the CSS rule reveals it via `data-manual-invalid`. |
| SF-5 | `/app/en/sign-in` — `submitting()`             | The framework's `submitting()` is `true` during the action and resets to `false` on success or error. The button uses `[disabled]="signInForm().submitting()"`.                               |
| SF-6 | All routes — direct DevTools probe             | `f.email().invalid()`, `f.email().touched()`, `f.email().dirty()`, `f.email().pending()` are all `signal`-backed and reactive.                                                                |

### Visual

No new snapshots required. The rendered DOM is structurally identical:

- `<form [formRoot]>` produces the same `<form>` element with `novalidate` set.
- `<input [formField]>` produces the same `<input>` with the framework-controlled `:invalid` attribute.
- `<app-error-message>` always renders.
- `<app-form [data-submitted]>` host attribute flips in lockstep with submit.
- `media/ui-snapshots/auth-sign-in-{360,1280}-{light,dark}.png` continue to match the new code path without re-shooting.

## Risks

| Risk                                                                                                                                                                                                                                             | Mitigation                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[formField]` directive is rendered through a different CVA pathway than the existing primitives' CVA; some behaviors (autocomplete, name, attribute pass-through) need re-validation.                                                           | The migration preserves every input the primitive already accepts (`required`, `pattern`, `minlength`, `maxlength`, `min`, `max`, `autocomplete`, `name`, `controlId`, etc.) as `input()`-typed fields and forwards them to the DOM via attribute bindings or property bindings. Per-primitive unit tests cover each one. |
| The submission lifecycle's "prevents double submission" guarantee is implemented inside `submit()`; some routes currently rely on `(ngSubmit)="submit()"` and their own `submitted = signal(false)`.                                             | The wrapper exposes `(ngSubmit)` for backward compatibility with route handlers that prefer the event-driven shape; routes that switch to `submission: { action }` no longer use `(ngSubmit)`. Both shapes get tests.                                                                                                     |
| Some routes capture async errors inside `submit()` and set `errorMessage = signal(…)`; that still works since `submission.action` is a method on the class.                                                                                      | The route's `submission: { action: async () => { try { … } catch (e) { this.errorMessage.set(…); } } }` runs inside a try/catch and returns `{kind, message, fieldTree}` for per-field errors. The framework rolls back `submitting()` on a thrown error.                                                                 |
| `ReactiveFormsModule` is still imported transitively by some library or runtime (PrimeNG bindings) that we did not enumerate.                                                                                                                    | Run `rg "from '@angular/forms'" apps/web/app/src/app` after Slice 2 to confirm only `@angular/forms/signals` (or `@angular/forms/signals/compat` if used) imports remain.                                                                                                                                                 |
| The CSS rule (`:has(input:invalid)`) needs `:invalid` to be true on the DOM control. Signal Forms wires the inner `<input>`'s `:invalid` so it tracks `f.email().invalid()`.                                                                     | The unit test in PR1 binds `[formField]` to a controlled signal and asserts the rendered DOM has `:invalid` after the rule fails.                                                                                                                                                                                         |
| Multistep forms (reset-password has two screens with two distinct field trees) were previously one `FormGroup` containing both; now they are two `FieldTree` instances each with its own `form(…)` call.                                         | Each step wraps in its own `<app-form [form]="passwordForm">` block; the action routes carry over without change; the cross-field `confirmPassword` rule lives inside the second step's schema.                                                                                                                           |
| Validation rule library coverage. The legacy code relied on `Validators.compose` for cross-field rules and `Validators.email` for email-format rules; the migration uses `validate(p, …)` and `email(p.email, …)` from `@angular/forms/signals`. | The plan lists the rules used per route. Each rule's behavior matches the legacy validator it replaces. Tests in the migrated components assert identical pass / fail behavior.                                                                                                                                           |

## Alternatives Considered

1. **Use `compatForm` to wrap the existing `FormGroup`s.** Rejected: the codebase already runs on Angular v22 and the migration is intentionally one-shot. The shim is acceptable for incremental migration but the user-facing cost is keeping `ReactiveFormsModule` in the dependency graph and the legacy class-based controls in every route file. Pure Signal Forms eliminates both.
2. **Use `SignalFormControl` per leaf and keep `FormGroup` aggregates.** Rejected: hybrid migration leaves the routes carrying both APIs (one for leaves, one for groups), doubles the surface area to test, and offers no benefit for our routes — none of them have RxJS-heavy validators worth preserving.
3. **Stay on Reactive Forms and just do the error UX cleanup.** Rejected: the request is explicit ("cambiaron totalmente su API"). Doing only the error UX is the previous spec; this spec lands the substrate change.
4. **Migrate routes only and leave the primitives on `[formControl]`.** Rejected: Signal Forms uses `[formField]` directly on the inner DOM control. The primitives would have to register a Reactive-Forms CVA **and** adapt between systems — far more code than rewriting them.
5. **Move from a `<form>` wrapper to a `<form [formRoot]>` in every template.** Rejected: the wrapper owns `data-submitted`, hosts the visual rule, and is the cheapest place to add or remove global behaviors. Removing it would push the host attribute into every route's `host: {...}` block.

## Success Criteria

- The static guards in the "Verification" section return the expected counts.
- `pnpm nx run app:lint`, `pnpm nx run app:typecheck`, `pnpm nx run app:vite:test`, `pnpm nx run site:lint`, `pnpm nx run site:typecheck`, `pnpm nx run ui-designer:lint`, `pnpm nx run ui-designer:build` all pass.
- The full e2e suite (`pnpm nx e2e app-e2e --grep sign-in --grep sign-up --grep verify-email --grep verify-device --grep forgotten-password --grep reset-password --grep activation --grep project`) passes against the new path.
- The M-1..M-12 behavioural checks from the previous spec continue to hold, and the SF-1..SF-6 checks in this spec hold.
- `apps/web/app/version.json` is `1.7.0`.
- `docs/constitution/roadmap.md` lists this spec under a new "Signal Forms Migration" entry pointing at `docs/specs/2026-07-04-signal-forms-migration/`.
- `docs/design-system/recipes.md` no longer references `FormGroup`, `FormControl`, `Validators`, or `controlError`.
- The seven route `.ts` files and eleven primitive `.ts` files contain only Signal Forms imports (and Angular core / router primitives).
- The shared `apps/web/app/src/app/shared/form/form-errors.ts` is removed.

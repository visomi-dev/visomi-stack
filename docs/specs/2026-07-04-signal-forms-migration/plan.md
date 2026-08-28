# Signal Forms Migration — Implementation Plan

The work is split into six reviewable PR groups, matching the slice plan in `sdd.md`. Each PR is independently verifiable. PR1 is the load-bearing one (primitives + `<app-form>` + `form-errors` removal + sign-in proof). PR2a–PR2d are the route migrations. PR3 closes the loop with recipes, version, and roadmap.

## PR1 — Primitive migration + `<app-form>` rewrite + `form-errors` removal + sign-in proof

Migrates the design-system primitives to Signal Forms, rewrites the `<app-form>` wrapper, deletes the `controlError()` translator, and migrates `sign-in` as the reference. After PR1, every primitive compiles against `[formField]`, `<app-form>` is signal-driven, `form-errors.ts` is gone, and sign-in is fully migrated.

### Tasks

1. Edit every form primitive `.ts` + `.html` + `.spec.ts` to drop the `ControlValueAccessor` registration and accept a `[formField]` input:
   - `apps/web/app/src/app/shared/ui/forms/input/input.ts` + `input.html` + `input.spec.ts`
   - `apps/web/app/src/app/shared/ui/forms/password-input/password-input.ts` + `password-input.html` + `password-input.spec.ts`
   - `apps/web/app/src/app/shared/ui/forms/textarea/textarea.ts` + `textarea.html` + `textarea.spec.ts` (if `.spec.ts` exists)
   - `apps/web/app/src/app/shared/ui/forms/select/select.ts` + `select.html` + `select.spec.ts` (if `.spec.ts` exists)
   - `apps/web/app/src/app/shared/ui/forms/pin-input/pin-input.ts` + `pin-input.html` + `pin-input.spec.ts`
   - `apps/web/app/src/app/shared/ui/forms/checkbox/checkbox.ts` + `checkbox.html` + `checkbox.spec.ts` (if `.spec.ts` exists)
   - `apps/web/app/src/app/shared/ui/forms/radio-group/radio-group.ts` + `radio-group.html` + `radio-group.spec.ts` (if `.spec.ts` exists)
   - `apps/web/app/src/app/shared/ui/forms/radio-card/radio-card.ts` + `radio-card.html` + `radio-card.spec.ts`
   - `apps/web/app/src/app/shared/ui/forms/switch/switch.ts` + `switch.html` + `switch.spec.ts` (if `.spec.ts` exists)
   - `apps/web/app/src/app/shared/ui/forms/color-picker/color-picker.ts` + `color-picker.html` + `color-picker.spec.ts` (if `.spec.ts` exists)

   For each primitive:
   - Remove the `ControlValueAccessor` interface implementation.
   - Add `readonly formField = input.required<FieldTree<…>>();` (or `FieldTree<string | number | boolean>` depending on the primitive).
   - Forward the form field to the inner DOM control: `<input [formField]="formField()" ... />` (or `<textarea>`, `<select>`, etc.).
   - Drop `ReactiveFormsModule` from the primitive's `imports` array.
   - Update the `.spec.ts` to construct a `form()` with a small model and pass `[formField]="f.x"` to the primitive.

2. Edit `apps/web/app/src/app/shared/ui/forms/form/form.ts` + `form.html` + `form.spec.ts`:
   - Drop `import { FormGroup, ReactiveFormsModule } from '@angular/forms';`.
   - Add `import { FormRoot, type FieldTree } from '@angular/forms/signals';`.
   - Replace `formGroup = input<FormGroup>(new FormGroup({}))` with `form = input.required<FieldTree<unknown>>()`.
   - Replace the inner template with `<form [formRoot]="form()" [attr.novalidate]="novalidate() ? '' : null" (submit)="onSubmit($event)">`.
   - Keep `[(submitted)] = model(false)`, `data-submitted` host binding, `novalidate`, and `(ngSubmit)` output.
   - Update `form.spec.ts` to construct a `form()` and pass `[form]="f"` instead of `[formGroup]="formGroup"`.

3. Delete `apps/web/app/src/app/shared/form/form-errors.ts` and `form-errors.spec.ts`. No replacement file; validation rules carry `{message}` inline.

4. Edit `apps/web/app/src/app/auth/sign-in/sign-in.ts`:
   - Drop `FormControl, FormGroup, ReactiveFormsModule, Validators` imports from `@angular/forms`.
   - Drop the `toSignal` import (no longer needed).
   - Add imports from `@angular/forms/signals`: `form, required, email, minLength, type FieldTree`.
   - Replace `SignInForm` type and the `FormGroup` constructor with `signInModel = signal({ email: '', password: '', rememberDevice: true })`.
   - Replace the `FormGroup` with `signInForm: FieldTree<…> = form(signInModel, schema, { submission: { action: this.submit.bind(this) } })`.
   - Move the email / password i18n strings into the schema's `{message}` options.
   - Replace `emailError` / `passwordError` with `computed(() => signInForm.email().errors()[0]?.message ?? '')` (and same for password).
   - Remove the `toSignal(valueChanges)` interop shims.
   - Remove `markAllAsTouched()` (no longer called).
   - Rename `submit()` to `private async submit(field: FieldTree<…>)` (the action receives the field tree) — or wrap with a public method the `submission.action` calls.

5. Edit `apps/web/app/src/app/auth/sign-in/sign-in.html`:
   - Replace `[formGroup]="form"` with `[form]="signInForm"`.
   - Replace `formControlName="email"` with `[formField]="signInForm.email"`.
   - Replace `formControlName="password"` with `[formField]="signInForm.password"`.
   - Replace `formControlName="rememberDevice"` with `[formField]="signInForm.rememberDevice"`.
   - Drop the `(ngSubmit)="submit()"` binding (the action drives submit now). Keep `(ngSubmit)` only if the wrapper's output is forwarded somewhere; otherwise drop it.

6. Edit `apps/web/app-e2e/src/auth/sign-in.spec.ts` if any assertion references `form.controls` (it should not — the e2e suite targets the rendered DOM). Refresh selectors only if the rendered DOM structure changes (e.g. `novalidate` location). Otherwise, leave it as-is.

7. Run the static guards in `sdd.md > Verification > Static` (filtered to PR1's scope):
   - `rg "FormGroup|FormControl|FormBuilder|ReactiveFormsModule" apps/web/app/src/app/shared/ui/forms` returns 0 matches.
   - `rg "controlError" apps/web/app/src/app` returns 0 matches.
   - `rg "formControlName" apps/web/app/src/app/auth/sign-in` returns 0 matches.
8. Run `pnpm nx run app:lint`, `pnpm nx run app:typecheck`, `pnpm nx run app:vite:test`, `pnpm nx run site:lint`, `pnpm nx run site:typecheck`, `pnpm nx run ui-designer:lint`, `pnpm nx run ui-designer:build`.
9. Run `pnpm nx e2e app-e2e --grep sign-in --grep @typing-window` (when gateway is reachable). Otherwise document the manual visual check in the PR description.

### Acceptance

- `rg "FormGroup|FormControl|FormBuilder|ReactiveFormsModule|formControlName|formGroupName|\[formGroup\]|\[formControl\]" apps/web/app/src/app/shared apps/web/app/src/app/auth/sign-in` returns 0 matches.
- `rg "controlError" apps/web/app/src/app` returns 0 matches.
- `rg "from '@angular/forms/signals'" apps/web/app/src/app/shared/ui/forms apps/web/app/src/app/auth/sign-in` returns ≥ 12 matches.
- `pnpm nx run app:vite:test -- input.spec.ts -- password-input.spec.ts -- pin-input.spec.ts -- form.spec.ts -- sign-in.spec.ts` all pass.
- The `@typing-window` and `@submitted-empty` e2e for sign-in pass.

## PR2a — sign-up, forgotten-password

Migrates two route components: `sign-up` (with cross-field `confirmPassword` mismatch) and `forgotten-password` (single field).

### Tasks

1. Edit `apps/web/app/src/app/auth/sign-up/sign-up.ts`:
   - Drop `FormControl, FormGroup, ReactiveFormsModule, Validators` imports.
   - Add `form, required, email, minLength, validate` from `@angular/forms/signals`.
   - Replace `SignUpForm` type and the `FormGroup` constructor with `signUpModel = signal({ email: '', password: '', confirmPassword: '' })`.
   - Schema: `required(p.email, …)`, `email(p.email, …)`, `required(p.password, …)`, `minLength(p.password, 8, …)`, `required(p.confirmPassword, …)`, and `validate(p.confirmPassword, ({value, valueOf}) => value && value !== valueOf(p.password) ? {kind: 'passwordMismatch', message: …} : null)`.
   - `submission: { action: this.submit.bind(this) }` (with the existing service call).
   - Drop `toSignal(valueChanges)`, the per-field signal/updater quadruplets, and `markAllAsTouched()`.
2. Edit `apps/web/app/src/app/auth/sign-up/sign-up.html`:
   - Switch `[formGroup]="form"` to `[form]="signUpForm"`.
   - Switch `formControlName="email" | password | confirmPassword` to `[formField]="signUpForm.x"`.
   - Drop `(blur)` and `(ngSubmit)` (the action drives submit).
3. Edit `apps/web/app/src/app/auth/forgotten-password/forgotten-password.ts`:
   - Same shape as sign-up, with one field: `email`.
4. Edit `apps/web/app/src/app/auth/forgotten-password/forgotten-password.html`:
   - Same template change.
5. Update each route's e2e spec to keep the same selectors; refresh only if the rendered DOM structure changes.

### Acceptance

- `rg "FormGroup|FormControl|Validators|formControlName" apps/web/app/src/app/auth/sign-up apps/web/app/src/app/auth/forgotten-password` returns 0 matches.
- `rg "controlError" apps/web/app/src/app/auth` returns 0 matches.
- `pnpm nx e2e app-e2e --grep sign-up --grep forgotten-password` passes (when the gateway is reachable).
- Cross-field mismatch in sign-up surfaces inline (unit test in sign-up.spec.ts).

## PR2b — reset-password

Reset-password has two steps. Each step carries its own `FieldTree`. The cross-field `confirmPassword` rule lives on step 2's schema.

### Tasks

1. Edit `apps/web/app/src/app/auth/reset-password/reset-password.ts`:
   - Drop `FormControl, FormGroup, ReactiveFormsModule, Validators` imports.
   - Add `form, required, pattern, validate, type FieldTree` from `@angular/forms/signals`.
   - `pinModel = signal({ pin: '' })`; `pinForm = form(pinModel, (p) => { required(p.pin, …); pattern(p.pin, /^\d{6}$/, …); }, { submission: { action: this.verifyOtp.bind(this) } })`.
   - `passwordModel = signal({ password: '', confirmPassword: '' })`; `passwordForm = form(passwordModel, (p) => { required(p.password, …); minLength(p.password, 8, …); required(p.confirmPassword, …); validate(p.confirmPassword, ({value, valueOf}) => value && value !== valueOf(p.password) ? {kind: 'passwordMismatch', message: …} : null); }, { submission: { action: this.resetPassword.bind(this) } })`.
   - The `manualError` for the OTP step stays as a route signal set in the `submission.action` catch block; the `<app-field [manualError]>` binding on the pin field stays.
2. Edit `apps/web/app/src/app/auth/reset-password/reset-password.html`:
   - Step 1: `[form]="pinForm"`, `[formField]="pinForm.pin"`, drop `formControlName="pin"`, drop `(blur)`, drop `markAllAsTouched()`.
   - Step 2: `[form]="passwordForm"`, `[formField]="passwordForm.password | confirmPassword"`, drop `formControlName`.
3. Update the e2e spec for reset-password.

### Acceptance

- `rg "FormGroup|FormControl|Validators|formControlName" apps/web/app/src/app/auth/reset-password` returns 0 matches.
- The cross-field `confirmPassword` mismatch in step 2 surfaces inline.
- The OTP `manualError` flow in step 1 still works (server-side error → `<app-field [manualError]>`).
- `pnpm nx e2e app-e2e --grep reset-password` passes.

## PR2c — verification-code-form (used by verify-email and verify-device)

This is the only primitive route that's reused in two routes. The OTP regex migrates to `pattern`; the server-side per-field error returns from `submission.action` as `{fieldTree: field.pin}`.

### Tasks

1. Edit `apps/web/app/src/app/auth/verification-code-form/verification-code-form.ts`:
   - Drop `FormControl, FormGroup, ReactiveFormsModule, Validators` imports.
   - Add `form, required, pattern, type FieldTree` from `@angular/forms/signals`.
   - `pinModel = signal({ pin: '' })`; `pinForm = form(pinModel, (p) => { required(p.pin, …); pattern(p.pin, /^\d{6}$/, …); }, { submission: { action: this.submit.bind(this) } })`.
   - The `errorMessage` signal (for the auth-level alert) stays; the per-field server error returns `{kind: 'serverError', message: '…', fieldTree: field.pin}` from the action.
2. Edit `apps/web/app/src/app/auth/verification-code-form/verification-code-form.html`:
   - Switch `[formGroup]="form"` to `[form]="pinForm"`.
   - Switch `formControlName="pin"` to `[formField]="pinForm.pin"`.
3. The `verify-email.ts` and `verify-device.ts` consumers pass their own data into the `<app-verification-code-form>` via inputs; if the input shape changes, update those `.ts` files. The form is owned by the primitive.
4. Update the e2e specs for verify-email and verify-device.

### Acceptance

- `rg "FormGroup|FormControl|Validators|formControlName" apps/web/app/src/app/auth/verification-code-form` returns 0 matches.
- `rg "manualError" apps/web/app/src/app/auth/verify-email apps/web/app/src/app/auth/verify-device` returns ≥ 1 match per route (the per-field server error binding on `<app-field [manualError]>`).
- `pnpm nx e2e app-e2e --grep verify-email --grep verify-device` passes.

## PR2d — activation, project-new

Two final two-field forms.

### Tasks

1. Edit `apps/web/app/src/app/activation/activation.ts`:
   - Drop `FormControl, FormGroup, ReactiveFormsModule, Validators` imports.
   - Add `form, required, minLength, type FieldTree` from `@angular/forms/signals`.
   - `apiKeyModel = signal({ label: 'Primary workspace key' })`; `apiKeyForm = form(apiKeyModel, (p) => { required(p.label, …); minLength(p.label, 3, …); }, { submission: { action: this.submit.bind(this) } })`.
   - The async per-field error from the legacy `labelError.set(...)` effect becomes a `manualError` signal set in the action's catch block, bound to `<app-field [manualError]>` on the label field.
2. Edit `apps/web/app/src/app/activation/activation.html`:
   - Switch `[formGroup]="apiKeyForm"` to `[form]="apiKeyForm"`.
   - Switch `formControlName="label"` to `[formField]="apiKeyForm.label"`.
3. Edit `apps/web/app/src/app/projects/project-new/project-new.ts`:
   - Same pattern; two fields (`name`, `summary`); `required` + `minLength` rules.
4. Edit `apps/web/app/src/app/projects/project-new/project-new.html`:
   - Switch `[formGroup]="form"` to `[form]="projectForm"` (rename for consistency).
   - Switch `formControlName="name | summary"` to `[formField]="projectForm.x"`.
5. Update the e2e specs for activation and project-new.

### Acceptance

- `rg "FormGroup|FormControl|Validators|formControlName" apps/web/app/src/app/activation apps/web/app/src/app/projects` returns 0 matches.
- `rg "manualError" apps/web/app/src/app/activation` returns ≥ 1 match (the label field's manual error binding).
- `pnpm nx e2e app-e2e --grep activation --grep project` passes.

## PR3 — Recipes, version, roadmap

1. Edit `docs/design-system/recipes.md`:
   - Rewrite the "Auth Shell", "Password Strength", "PIN / Verification Code", "Field With Error", and "Form" snippets to use `form(model, schema, options)` + `[formField]`.
   - Add a new "## Signal Forms" entry that documents the import line, the rule list (`required`, `email`, `minLength`, `pattern`, `validate`, `disabled`, `applyWhen`), and the `submission.action` shape.
   - Document the `manualError` override, the `<app-form>` wrapper, and the `data-submitted` flow from the previous spec.
2. Bump `apps/web/app/version.json` from `1.6.0` to `1.7.0`.
3. Edit `docs/constitution/roadmap.md`:
   - Add a new "## Signal Forms Migration" section after the existing phases.
   - Reference this spec: `docs/specs/2026-07-04-signal-forms-migration/`.
   - Document the slice plan (PR1, PR2a, PR2b, PR2c, PR2d, PR3).
   - Set the branch name `feat/OC/signal-forms-migration` and the version target `1.7.0`.
4. Add a focused unit test in `apps/web/app/src/app/shared/ui/forms/form/form.spec.ts` (covered in PR1; the PR3 work is the recipes + version + roadmap).
5. Add a unit test in `apps/web/app/src/app/auth/sign-in/sign-in.spec.ts` (new) covering the new `f.email().errors()` shape and the cross-route `submission.action` lifecycle.

### Acceptance

- `rg "FormGroup|FormControl|Validators|controlError" docs/design-system` returns 0 matches.
- `rg "form\(\(model" docs/design-system/recipes.md` returns ≥ 1 match.
- `cat apps/web/app/version.json` reports `"version": "1.7.0"`.
- `rg "Signal Forms Migration" docs/constitution/roadmap.md` returns 1 match.

## Cross-PR Verification

```bash
pnpm nx run-many -t lint,typecheck --projects=app,site,ui-designer
pnpm nx run app:vite:test
pnpm nx run app:build --skip-nx-cache
pnpm nx run site:build --skip-nx-cache
pnpm nx run ui-designer:build --skip-nx-cache

# Static guards per PR (full set runs after PR2d)
rg "FormGroup|FormControl|FormBuilder|ReactiveFormsModule|formControlName|formGroupName|\[formGroup\]|\[formControl\]" apps/web/app/src/app
# expected: 0 matches

rg "Validators\." apps/web/app/src/app
# expected: 0 matches

rg "markAllAsTouched|toSignal\(.*\.valueChanges" apps/web/app/src/app
# expected: 0 matches

rg "controlError\(" apps/web/app/src/app
# expected: 0 matches

rg "from '@angular/forms'" apps/web/app/src/app | grep -v "@angular/forms/signals"
# expected: 0 matches

rg "from '@angular/forms/signals'" apps/web/app/src/app
# expected: matches in every migrated route + every migrated primitive

# Gateway boot (skip if Redis is not reachable in this environment)
pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production
node dist/apps/web/server/main.js &
sleep 6
pnpm nx e2e app-e2e --grep sign-in --grep sign-up --grep verify-email --grep verify-device --grep forgotten-password --grep reset-password --grep activation --grep project
node scripts/capture-auth-flow.cjs

# Visual evidence (optional, for the slice boundary)
node scripts/capture-ui-snapshots.cjs
```

Manual review: walk the M-1..M-12 checklist in `docs/specs/2026-06-28-css-driven-field-errors/sdd.md` and the SF-1..SF-6 checklist in this spec's `sdd.md`, ticking each row when the corresponding screenshot / video frame matches the expected post-migration behavior.

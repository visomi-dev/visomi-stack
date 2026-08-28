# CSS-Driven Field Errors — Implementation Plan

The work is split into three reviewable PR groups, matching the slice plan in `sdd.md`. Each PR is independently verifiable.

## PR1 — Design-system primitive migration + sign-in proof + `<app-form>`

Migrates the design-system primitives to the hybrid pattern, lands the new `<app-form>` primitive, and migrates `sign-in` as the proof. After PR1, the boilerplate in `sign-in.ts` is gone, the CSS rule exists in `styles.base.css`, every form primitive passes through validation attributes, `<app-form>` exists, and `controlError()` is a pure translator.

### Tasks

1. Edit `styles.base.css`:
   - Add `@layer components { ... }` block with the `:has()` reveal rule (see `sdd.md` "Implementation Strategy > Slice 1") covering `app-input`, `app-password-input`, `app-textarea`, `app-select`, `app-pin-input`, `app-checkbox`, `app-radio-group`, `app-switch`, `app-radio-card`, `app-color-picker`.
   - Add the `data-manual-invalid` clause that activates the same reveal when `<app-field>` carries the attribute.
   - Add the `[data-submitted]` clause (sourced by `<app-form>`) that reveals errors on submitted forms, even when empty.
   - Add dark-mode overrides via `html.dark [data-control] ...`.
   - Reduce the transition window for `prefers-reduced-motion` (uses the existing block at lines 43-49).
2. Author `apps/web/app/src/app/shared/ui/forms/form/form.ts` + `form.html` (new primitive):
   - Standalone component with `selector: 'app-form'`.
   - Inputs: `[submitted] = model<boolean>(false)`, `[novalidate] = input(false, { transform: booleanAttribute })`.
   - Output: `(ngSubmit)` (bubbles the native submit).
   - Host: `class: 'block'`; `host: { '[attr.data-submitted]': 'submitted() ? "" : null' }`.
   - Template renders a native `<form [attr.novalidate]="novalidate()" (submit)="onSubmit($event)"><ng-content /></form>`.
   - `onSubmit` calls `submitted.set(true)`. The host attribute flips in lockstep.
3. Author `apps/web/app/src/app/shared/ui/forms/form/form.spec.ts`:
   - Renders a `<app-form>` and asserts the host has no `data-submitted` initially.
   - Dispatches a `submit` event; asserts the host carries `data-submitted="true"`.
   - Asserts `(ngSubmit)` fires.
4. Edit `apps/web/app/src/app/shared/ui/forms/field/field.ts`:
   - Add `readonly invalid = input(false, { transform: booleanAttribute })`.
   - Add `readonly manualError = input<string | null>(null)`.
   - Use `host` bindings (`@HostBinding` or `host: { '[attr.data-invalid]': '...', '[attr.data-manual-invalid]': '...' }`) to expose the attributes.
5. Edit `apps/web/app/src/app/shared/ui/forms/input/input.ts` + `input.html`:
   - Add `pattern`, `required`, `minlength`, `maxlength`, `min`, `max` inputs (number-typed where appropriate via `numberAttribute`).
   - Bind them through to the DOM via `[attr.pattern]` etc.
   - Keep the existing `[invalid]` input; the CSS rule owns the visual reveal.
6. Edit `apps/web/app/src/app/shared/ui/forms/password-input/password-input.ts` + `password-input.html`: same pass-throughs. The existing `pattern` input extends with `minLength` / `maxLength`.
7. Edit `apps/web/app/src/app/shared/ui/forms/textarea/textarea.ts` + `textarea.html`: same pass-throughs.
8. Edit `apps/web/app/src/app/shared/ui/forms/select/select.ts` + `select.html`: add `required`, `pattern`, `minlength` pass-throughs; remove the manual border logic in `classes()` (the CSS rule owns it now).
9. Edit `apps/web/app/src/app/shared/ui/forms/pin-input/pin-input.ts` + `pin-input.html`: the existing `digitPattern` input stays; `pattern` is forwarded as the per-cell attribute.
10. Edit `apps/web/app/src/app/shared/ui/forms/checkbox/checkbox.ts` + `checkbox.html`: add `required` pass-through; remove the manual border logic in `classes()`.
11. Edit `apps/web/app/src/app/shared/ui/forms/radio-group/radio-group.ts` + `radio-group.html`: add `required` pass-through; expose a host data attribute the CSS rule can target.
12. Edit `apps/web/app/src/app/shared/ui/forms/switch/switch.ts` + `switch.html`: same as checkbox.
13. Edit `apps/web/app/src/app/shared/ui/forms/radio-card/radio-card.ts` + `radio-card.html`: same as radio-group.
14. Edit `apps/web/app/src/app/shared/ui/forms/color-picker/color-picker.ts` + `color-picker.html`: same; the inner `[role="combobox"]` or `<input type="color">` is the validity target.
15. Edit `apps/web/app/src/app/shared/ui/forms/error-message/error-message.ts` + `error-message.html`:
    - The component is always rendered. The host class stays; content comes from `[manualError]` or content projection.
    - Keep `id` / `controlId` so `aria-describedby` keeps working.
16. Edit `apps/web/app/src/app/shared/form/form-errors.ts`:
    - Remove the `control.touched` gate.
    - Return `''` when control is missing or valid; first matching message; default `'This field is invalid.'`.
17. Edit `apps/web/app/src/app/shared/form/form-errors.spec.ts`:
    - Replace touched-related tests with invalid-only tests.
    - Add a test for missing control.
    - Add a test for the default fallback message.
18. Edit `apps/web/app/src/app/shared/ui/forms/field/field.spec.ts` (new file if not present):
    - `manualError` non-empty → host has `data-manual-invalid="true"`.
    - `manualError` empty / null → host attribute absent.
    - `invalid` non-empty → host has `data-invalid="true"`.
19. Edit `apps/web/app/src/app/auth/sign-in/sign-in.ts`:
    - Replace the per-field signals with `computed()`s:
      ```ts
      readonly emailErrorText = computed(() => controlError(this.form.controls.email, MESSAGES));
      readonly passwordErrorText = computed(() => controlError(this.form.controls.password, MESSAGES));
      ```
    - Drop `emailError`, `passwordError`, `updateEmailError`, `updatePasswordError`, `emailErrorMessage`, `passwordErrorMessage`.
    - Drop `markAllAsTouched()` from `submit()` for the migrated fields (the auth-level alert still gates on `form.invalid`).
    - Add `submitted = signal(false)` and wire it through `<app-form [(submitted)]="submitted">`.
20. Edit `apps/web/app/src/app/auth/sign-in/sign-in.html`:
    - Replace the `<form>` element with `<app-form [(submitted)]="submitted" (ngSubmit)="submit()" novalidate>`.
    - Drop `(blur)="updateEmailError()"` and `(blur)="updatePasswordError()"`.
    - Drop the `@if (emailError(); as message)` wrapper around `<app-error-message>`.
    - Bind `[invalid]="!!emailErrorText()"` is removed too; the CSS rule handles the visual.
    - Keep `[aria-describedby]`, `controlId`, `formControlName`, etc.
21. Edit `apps/web/app-e2e/src/auth/sign-in.spec.ts`:
    - Add a `@typing-window` test that:
      1. Types an invalid email.
      2. Asserts `<app-error-message>` is not visible while the field has focus.
      3. Blurs the field.
      4. Asserts `<app-error-message>` is visible and the message text matches.
      5. Re-focuses the field.
      6. Asserts the error hides again.
    - Add a `@submitted-empty` test that:
      1. Clicks `Submit` on an otherwise empty form.
      2. Asserts the `<app-form>` host carries `data-submitted="true"`.
      3. Asserts every required `<app-field>` reveals its `<app-error-message>` (CSS-driven, no manual plumbing).
22. Run the static guards in `sdd.md > Verification > Static`.
23. Run `pnpm nx run app:lint`, `pnpm nx run app:typecheck`, `pnpm nx run app:vite:test`, `pnpm nx run site:lint`, `pnpm nx run site:typecheck`, `pnpm nx run ui-designer:lint`, `pnpm nx run ui-designer:build`.
24. Run `pnpm nx e2e app-e2e --grep sign-in` (when gateway is reachable). Otherwise document the manual visual check in the PR description.

### Acceptance

- `rg "control\.touched" apps/web/app/src/app/shared/form` returns 0 matches.
- `rg "updateXError|updateEmailError|updatePasswordError" apps/web/app/src/app/auth/sign-in` returns 0 matches.
- `rg "data-manual-invalid" apps/web/app/src/app/shared/ui/forms/field` returns at least 1 match (the host binding).
- `rg "data-submitted" apps/web/app/src/app/shared/ui/forms/form` returns at least 1 match (the host binding).
- `pnpm nx run app:vite:test -- field.spec.ts -- form-errors.spec.ts -- form.spec.ts -- input.spec.ts -- password-input.spec.ts -- pin-input.spec.ts` all pass.
- The `@typing-window` and `@submitted-empty` e2e for sign-in pass.
- `media/ui-snapshots/auth-sign-in-{360,1280}-{light,dark}.png` show the post-blur red border with the message; the typing-window screen recording shows the error fading out while focus is in the field; the submitted-empty snapshot shows the per-field red borders and messages.

## PR2 — Remaining consumers migrated

Three sub-PRs of equal size:

### PR2a — `sign-up`, `verify-email`, `verify-device`

For each route:

1. Replace per-field signals with `computed()` calls to `controlError()`.
2. Drop `(blur)` handlers.
3. Drop the `@if` wrappers around `<app-error-message>`.
4. Wrap the `<form>` in `<app-form [(submitted)]="submitted">`.
5. For `verify-email` and `verify-device`, the OTP mismatch (server returns invalid code) uses `data-manual-invalid="true"` driven by a `manualError = signal('')` set in the catch block of `submit()`.
6. Where sign-up has a required checkbox (e.g. privacy / terms), set `required` on the inner `<app-checkbox>` and drop the manual `[invalid]` plumbing if any.
7. Update the affected e2e specs to drop `await page.locator(...).blur()` assertions if they relied on the touched-first model; the new behavior is "error visible after blur" already, so most specs stay green.

### PR2b — `forgotten-password`, `reset-password`

1. Same template simplification as PR2a.
2. `reset-password` carries the cross-field `confirmPassword` mismatch. Migrate to:
   ```ts
   readonly confirmPasswordError = computed(() => {
     const control = this.passwordForm.controls.confirmPassword;
     const expected = this.passwordForm.controls.password.value;
     if (!control.value) return '';
     if (expected && control.value !== expected) {
       return $localize`:@@resetPasswordConfirmErrorMismatch:Passwords don't match.`;
     }
     return controlError(control, { required: '...' });
   });
   ```
3. Drop the manual `if (this.passwordForm.invalid || ...) { markAllAsTouched(); return; }` short-circuit; the new model is "errors render via CSS, submit still uses `form.invalid` for the alert".

### PR2c — `activation`, `project-new`

1. Same template simplification.
2. `activation.ts:253` (`labelError.set(...)`) becomes a `computed()` that calls `controlError()` and feeds `[manualError]` on the corresponding `<app-field>`.
3. `project-new` follows the same shape; both fields use the native pipeline (`required`, `minLength` patterns) without manual signals.
4. Both routes carry required switches / checkboxes (activation's "I accept the terms" pattern, sign-up's privacy / terms in `project-new`); set `required` on the inner control and rely on the CSS rule.

### Acceptance for PR2

- `rg "markAllAsTouched" apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects` returns 0 matches.
- `rg "updateXError|updateEmailError|updatePasswordError|updateNameError|updateDescriptionError|updateLabelError|updatePinError|updateConfirmPasswordError" apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects` returns 0 matches.
- `rg "app-form \[?\(?" apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects` returns matches in every migrated route's template.
- `pnpm nx e2e app-e2e --grep sign-up --grep forgotten-password --grep reset-password --grep verify-email --grep verify-device --grep activation --grep project` passes (when the gateway is reachable).
- The new behavior is exercised manually per M-1..M-12 in `sdd.md`.

## PR3 — Recipes, version, roadmap

1. Edit `docs/design-system/recipes.md`:
   - Rewrite the "Auth Shell" snippet so the `<app-input>` / `<app-password-input>` blocks drop `(blur)` and the `@if` wrapper, and so the `<form>` becomes `<app-form [(submitted)]="submitted" (ngSubmit)="submit()" novalidate>`.
   - Rewrite the "Password Strength" snippet the same way.
   - Rewrite the "PIN / Verification Code" snippet the same way; document that pin mismatches come from `[manualError]`.
   - Rewrite the "Field With Error" snippet:
     - Native case: `<app-field>` only; `<app-error-message>` always rendered; the CSS rule owns the reveal.
     - Manual case: `<app-field [manualError]="...">`; the `data-manual-invalid` attribute consumes the same rule.
     - Submitted-empty case: `<app-form [(submitted)]="…">` reveals all per-field errors after submit, including empty required fields.
     - Checkbox / switch / radio-group / radio-card / color-picker: `required` on the inner control; no `(blur)`; no manual `[invalid]`.
   - Add a new "## Form" entry that documents `<app-form>`, `[(submitted)]`, and `novalidate`.
2. Bump `apps/web/app/version.json` from `1.5.0` to `1.6.0`.
3. Edit `docs/constitution/roadmap.md`:
   - Add a new "## CSS-Driven Field Errors" section after the existing phases.
   - Reference this spec: `docs/specs/2026-06-28-css-driven-field-errors/`.
   - Document the slice plan (PR1, PR2a, PR2b, PR2c, PR3).
   - Set the branch name `feat/OC/css-driven-field-errors` and the version target `1.6.0`.

### Acceptance

- `rg "updateEmailError|updatePasswordError" docs/design-system` returns 0 matches.
- `rg "app-form" docs/design-system/recipes.md` returns at least 1 match.
- `cat apps/web/app/version.json` reports `"version": "1.6.0"`.
- `rg "CSS-Driven Field Errors" docs/constitution/roadmap.md` returns 1 match.

## Cross-PR Verification

```bash
pnpm nx run-many -t lint,typecheck --projects=app,site,ui-designer
pnpm nx run app:vite:test
pnpm nx run app:build --skip-nx-cache
pnpm nx run site:build --skip-nx-cache
pnpm nx run ui-designer:build --skip-nx-cache

# Static guards per PR
rg "control\.touched" apps/web/app/src/app/shared/form
rg "markAllAsTouched" apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects
rg "updateXError|updateEmailError|updatePasswordError|updateNameError|updateDescriptionError|updateLabelError|updatePinError|updateConfirmPasswordError" apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects
rg "@if \(.*Error\(\); as message\)" apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects
rg "data-manual-invalid" apps/web/app/src/app/shared/ui/forms/field apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects
rg "data-submitted" apps/web/app/src/app/shared/ui/forms/form apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects
rg "<app-form" apps/web/app/src/app/auth apps/web/app/src/app/activation apps/web/app/src/app/projects
rg "CSS-Driven Field Errors" docs/constitution/roadmap.md

# Gateway boot (skip if Redis is not reachable in this environment)
pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production
node dist/apps/web/server/main.js &
sleep 6
pnpm nx e2e app-e2e --grep sign-in --grep sign-up --grep verify-email --grep verify-device --grep forgotten-password --grep reset-password
node scripts/capture-auth-flow.cjs   # regenerate media/auth-flow-videos/*.webm against the new behavior

# Visual evidence
node scripts/capture-ui-snapshots.cjs
```

Manual review: walk the M-1..M-12 checklist in `sdd.md`, tick each row when the corresponding screenshot / video frame matches the expected post-fix behavior.

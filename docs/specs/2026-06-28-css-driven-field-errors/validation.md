# CSS-Driven Field Errors — Validation Plan

## Status

Draft. PRs land in order (PR1 → PR2a → PR2b → PR2c → PR3). The verification log below is a forecast; replace it with actual run output once each PR lands.

## Static Validation (per PR)

```bash
pnpm nx run app:lint                          # expected: 0 errors, 0 new warnings
pnpm nx run app:typecheck                     # expected: 0 errors
pnpm nx run app:vite:test                     # expected: existing tests pass; new field.spec.ts, form-errors.spec.ts, form.spec.ts, and sign-in spec @typing-window / @submitted-empty pass
pnpm nx run site:lint                         # expected: 0 errors
pnpm nx run site:typecheck                    # expected: 0 errors
pnpm nx run ui-designer:lint                  # expected: 0 errors
pnpm nx run ui-designer:build                 # expected: builds dist/apps/web/ui-designer
```

### PR1 — Primitive migration + sign-in + `<app-form>`

```bash
rg "control\.touched" apps/web/app/src/app/shared/form
# expected: 0 matches

rg "updateXError|updateEmailError|updatePasswordError" apps/web/app/src/app/auth/sign-in
# expected: 0 matches

rg "data-manual-invalid" apps/web/app/src/app/shared/ui/forms/field
# expected: ≥ 1 match (host binding)

rg "data-submitted" apps/web/app/src/app/shared/ui/forms/form
# expected: ≥ 1 match (host binding)

rg "pattern|minlength|maxlength" apps/web/app/src/app/shared/ui/forms/input
# expected: ≥ 4 matches (the new inputs in the .ts)

rg "required" apps/web/app/src/app/shared/ui/forms/checkbox apps/web/app/src/app/shared/ui/forms/radio-group apps/web/app/src/app/shared/ui/forms/switch apps/web/app/src/app/shared/ui/forms/radio-card
# expected: ≥ 1 match per primitive (the new pass-throughs)

rg "max-height: 0" styles.base.css
# expected: 1 match in the [data-control] rule

rg "data-submitted\]" styles.base.css
# expected: ≥ 1 match (the [data-submitted] clause)
```

Files touched:

- `styles.base.css`
- `apps/web/app/src/app/shared/ui/forms/field/field.ts` + `field.html`
- `apps/web/app/src/app/shared/ui/forms/input/input.ts` + `input.html`
- `apps/web/app/src/app/shared/ui/forms/password-input/password-input.ts` + `password-input.html`
- `apps/web/app/src/app/shared/ui/forms/textarea/textarea.ts` + `textarea.html`
- `apps/web/app/src/app/shared/ui/forms/select/select.ts` + `select.html`
- `apps/web/app/src/app/shared/ui/forms/pin-input/pin-input.ts` + `pin-input.html`
- `apps/web/app/src/app/shared/ui/forms/checkbox/checkbox.ts` + `checkbox.html`
- `apps/web/app/src/app/shared/ui/forms/radio-group/radio-group.ts` + `radio-group.html`
- `apps/web/app/src/app/shared/ui/forms/switch/switch.ts` + `switch.html`
- `apps/web/app/src/app/shared/ui/forms/radio-card/radio-card.ts` + `radio-card.html`
- `apps/web/app/src/app/shared/ui/forms/color-picker/color-picker.ts` + `color-picker.html`
- `apps/web/app/src/app/shared/ui/forms/error-message/error-message.ts` + `error-message.html`
- `apps/web/app/src/app/shared/ui/forms/form/form.ts` + `form.html` + `form.spec.ts` (new files)
- `apps/web/app/src/app/shared/form/form-errors.ts` + `form-errors.spec.ts`
- `apps/web/app/src/app/shared/ui/forms/field/field.spec.ts` (new)
- `apps/web/app/src/app/auth/sign-in/sign-in.ts` + `sign-in.html`
- `apps/web/app-e2e/src/auth/sign-in.spec.ts`

### PR2a — sign-up, verify-email, verify-device

```bash
rg "updateXError|updateEmailError|updatePasswordError|updateNameError|updateDescriptionError|updateLabelError|updatePinError" apps/web/app/src/app/auth/sign-up apps/web/app/src/app/auth/verify-email apps/web/app/src/app/auth/verify-device
# expected: 0 matches

rg "data-manual-invalid" apps/web/app/src/app/auth/verify-email apps/web/app/src/app/auth/verify-device
# expected: ≥ 1 match per route (the OTP mismatch binding)

rg "<app-form" apps/web/app/src/app/auth/sign-up apps/web/app/src/app/auth/verify-email apps/web/app/src/app/auth/verify-device
# expected: ≥ 1 match per route (the wrapping primitive)
```

Files touched:

- `apps/web/app/src/app/auth/sign-up/sign-up.ts` + `sign-up.html`
- `apps/web/app/src/app/auth/verify-email/verify-email.ts` + `verify-email.html`
- `apps/web/app/src/app/auth/verify-device/verify-device.ts` + `verify-device.html`
- (Plus their e2e specs under `apps/web/app-e2e/src/auth/`.)

### PR2b — forgotten-password, reset-password

```bash
rg "markAllAsTouched" apps/web/app/src/app/auth/forgotten-password apps/web/app/src/app/auth/reset-password
# expected: 0 matches

rg "data-manual-invalid" apps/web/app/src/app/auth/reset-password
# expected: ≥ 1 match (the confirmPassword binding)

rg "<app-form" apps/web/app/src/app/auth/forgotten-password apps/web/app/src/app/auth/reset-password
# expected: ≥ 1 match per route
```

Files touched:

- `apps/web/app/src/app/auth/forgotten-password/forgotten-password.ts` + `forgotten-password.html`
- `apps/web/app/src/app/auth/reset-password/reset-password.ts` + `reset-password.html`
- (Plus their e2e specs under `apps/web/app-e2e/src/auth/`.)

### PR2c — activation, project-new

```bash
rg "markAllAsTouched" apps/web/app/src/app/activation apps/web/app/src/app/projects
# expected: 0 matches

rg "labelError|apiKeyForm\.invalid" apps/web/app/src/app/activation
# expected: 0 matches after the computed() rewrite

rg "<app-form" apps/web/app/src/app/activation apps/web/app/src/app/projects
# expected: ≥ 1 match per route
```

Files touched:

- `apps/web/app/src/app/activation/activation.ts` + `activation.html`
- `apps/web/app/src/app/projects/project-new/project-new.ts` + `project-new.html`
- (Plus their e2e specs under `apps/web/app-e2e/src/`.)

### PR3 — Recipes + version + roadmap

```bash
rg "updateEmailError|updatePasswordError" docs/design-system
# expected: 0 matches

rg "app-form" docs/design-system/recipes.md
# expected: ≥ 1 match (the new "## Form" section)

cat apps/web/app/version.json
# expected: { "version": "1.6.0" }

rg "CSS-Driven Field Errors" docs/constitution/roadmap.md
# expected: 1 match
```

Files touched:

- `docs/design-system/recipes.md`
- `apps/web/app/version.json`
- `docs/constitution/roadmap.md`

## Component Validation

### `app-form`

| Test                                            | Expected                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Render with no inputs                           | host has no `data-submitted`                                                           |
| `[(submitted)]` toggled externally to `true`    | host has `data-submitted="true"`                                                       |
| Dispatch a `submit` event on the inner `<form>` | `submitted` flips to `true`; host has `data-submitted="true"`; `(ngSubmit)` fires once |
| `[novalidate]="true"` passed through            | inner `<form>` has `novalidate` attribute                                              |
| `[novalidate]="false"` (default)                | inner `<form>` does not have the attribute                                             |

### `app-field`

| Test                                                                    | Expected                                                                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Render with no `invalid` and no `manualError`                           | host has `data-invalid` and `data-manual-invalid` absent                                                        |
| Set `[invalid]="true"`                                                  | host has `data-invalid="true"`                                                                                  |
| Set `[manualError]="'some string'"`                                     | host has `data-manual-invalid="true"`                                                                           |
| Set `[manualError]=""` (falsy)                                          | host has `data-manual-invalid` absent                                                                           |
| `[invalid]="true"` + `[manualError]="'...'"`                            | host has both attributes                                                                                        |
| `[manualError]="computed()"` returns `''` after async validation passes | host has `data-manual-invalid` absent (the field's red border + message both clear in lockstep with the signal) |

### `app-error-message`

| Test                                           | Expected                                                     |
| ---------------------------------------------- | ------------------------------------------------------------ |
| Render with no content (default state)         | `<p role="alert" data-slot="error" />` present, max-height 0 |
| Render with `[manualError]="'...'"`            | `<p>` carries the message text                               |
| Render via content projection (legacy pattern) | `<p>` carries the projected text                             |
| Both bindings supplied                         | The `[manualError]` string wins (documented in the API)      |

### `app-input` (and siblings)

| Test                                                                     | Expected                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Render with `[pattern]="[a-z]{3}"`                                       | DOM `<input>` has `pattern="[a-z]{3}"`                                |
| Render with `[required]="true"`                                          | DOM `<input>` has `required`                                          |
| Render with `[minlength]="3"`                                            | DOM `<input>` has `minlength="3"`                                     |
| Submit a form whose input is invalid (empty required field)              | input has `:invalid` true in the rendered DOM                         |
| Submit a form whose password input is invalid (does not match the regex) | input has `:invalid` true; the field-level error appears after `blur` |

### `app-checkbox` / `app-radio-group` / `app-switch` / `app-radio-card` / `app-color-picker`

| Test                                                       | Expected                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Render with `[required]="true"`                            | Inner control carries `required` in the rendered DOM                             |
| Required + unchecked / unselected                          | `:invalid` is `true` on the rendered DOM input                                   |
| Submit form with required checkbox unchecked               | Field reveals red border + message via the `[data-submitted]` CSS clause         |
| Toggle the checkbox from unchecked → checked while focused | `:invalid` becomes `false`; CSS hides the error in lockstep (no manual plumbing) |

### `controlError()`

| Test                                                                             | Expected                           |
| -------------------------------------------------------------------------------- | ---------------------------------- |
| Missing control                                                                  | returns `''`                       |
| Valid control with no errors                                                     | returns `''`                       |
| Invalid control with `required` error, `messages.required === 'Choose a value.'` | returns that string                |
| Invalid control with `required` error, no entry in `messages`                    | returns `'This field is invalid.'` |

## Accessibility Validation

- `pnpm nx run app:vite:test` continues to pass; no regression in the existing a11y specs.
- `pnpm nx e2e app-e2e --grep @a11y` (when the gateway is reachable) confirms focus order and live regions.
- Manual contrast check on every surface touched by the spec, light + dark:
  - `red-600` on `zinc-50` (light error text) → ≥ 4.5:1.
  - `red-400` on `zinc-900` (dark error text) → ≥ 4.5:1.
  - `red-600` on `zinc-50` (light error border) → ≥ 3:1.
  - `red-500` on `zinc-900` (dark error border) → ≥ 3:1.
  - `blue-600` on `white` (primary CTA) → ≥ 4.5:1.
  - `blue-500` on `zinc-950` (primary CTA in dark) → ≥ 4.5:1.
- `role="alert"` semantics: `pnpm nx e2e app-e2e --grep sign-in --grep @typing-window` asserts (1) no announcement on initial mount, (2) announcement on the post-blur reveal, (3) no double-announcement when re-focusing the field.

## Visual Validation

After all PRs land and the gateway is reachable, the reviewer walks the snapshot grid in `media/ui-snapshots/` and the auth flow recordings, ticking each row of the M-1..M-9 checklist in `sdd.md`:

| Item | Surface                                                                                                 | Expected state                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| M-1  | `sign-in` — empty email submit                                                                          | Email input reveals an error after the user explicitly blurs the empty field                  |
| M-2  | `sign-in` — typing                                                                                      | Error hides while focus is inside the field; reappears on blur if the value is still invalid  |
| M-3  | `sign-in` — autofill                                                                                    | Browser autofill of an invalid email does not trigger the red border on first paint           |
| M-4  | `sign-in` — dark mode                                                                                   | Red border uses `dark:border-red-500`; the message foreground uses `dark:text-red-400`        |
| M-5  | `reset-password` — confirm mismatch                                                                     | The `confirmPassword` field shows a manual error inline (`data-manual-invalid`)               |
| M-6  | `verify-email` — wrong OTP after submit                                                                 | The `pin` field shows a manual error inline                                                   |
| M-7  | `verify-email` — typing the right code                                                                  | The pin error remains hidden (no flicker) until `submit()` finishes                           |
| M-8  | `forgotten-password` — invalid email format                                                             | Border + message reveal after blur; hidden during typing                                      |
| M-9  | `media/ui-snapshots/auth-sign-in-{360,1280}-{light,dark}.png` show the post-blur red border and message |                                                                                               |
| M-10 | `sign-up` — submit with every field empty                                                               | All required fields reveal their errors via `[data-submitted]` (no per-route plumbing)        |
| M-11 | `activation` — required "I accept the terms" unchecked at submit                                        | Checkbox paints red; the message reveals via `[data-submitted]`                               |
| M-12 | `sign-up` — required privacy checkbox interact                                                          | Checkbox pattern behaves like a native field: hide during focus, reveal on blur if `:invalid` |

## Auth Flow Recording Validation

```bash
# Pre-flight
file media/auth-flow-videos/auth-flow-iphone-13-mini.webm
file media/auth-flow-videos/auth-flow-hd-1920x1080.webm
# expected: WebM video, VP8 or VP9, ≥ 100 KB

# Playback (manual)
ffplay media/auth-flow-videos/auth-flow-iphone-13-mini.webm
ffplay media/auth-flow-videos/auth-flow-hd-1920x1080.webm
# expected: full flow visible (sign-up, OTP, dashboard, logout, forgotten password, OTP, new password, success, sign-in, OTP, dashboard) without console errors or page crashes; per-field errors fade in on blur
```

## Completion Checklist

- PR1 lands. The CSS rule exists in `styles.base.css`; every primitive (text + binary) accepts pass-throughs; `<app-form>` exists with `data-submitted`; sign-in is migrated and the `@typing-window` + `@submitted-empty` e2e tests pass.
- PR2a lands. `sign-up`, `verify-email`, `verify-device` follow the new shape and wrap their `<form>` in `<app-form>`.
- PR2b lands. `forgotten-password`, `reset-password` follow the new shape; the cross-field `confirmPassword` mismatch routes through `[manualError]`.
- PR2c lands. `activation`, `project-new` follow the new shape; required checkboxes / switches ride the native CSS pipeline.
- PR3 lands. `docs/design-system/recipes.md` reflects the new pattern and adds a `## Form` section; `apps/web/app/version.json` is `1.6.0`; `docs/constitution/roadmap.md` lists this spec.
- `pnpm nx run app:lint`, `pnpm nx run app:typecheck`, `pnpm nx run app:vite:test` all pass.
- The auth flow recordings are regenerated and load without console errors.
- This validation plan is updated to "Completed" with the verification log.

## Notes

- The static guards are intentionally narrow. They are a regression fence, not a full unit test. The CSS rule's `:has()` semantics, the `[data-submitted]` clause, and the `prefers-reduced-motion` shortcut are the only places where the implementation could regress quietly; the e2e suite + a manual screenshot diff are the catching net.
- The reveal rule no longer depends on `markAllAsTouched()` at the route level. Submitting an empty form flips `<app-form>`'s `data-submitted` to `true` and the CSS rule reveals every required field's error inline. The auth-level `<app-alert>` still gates the submit (today via `if (this.form.invalid) { ... }` on the auth routes), but no per-route touched plumbing remains.
- The `:not(:autofill)` clause is included even though modern Chromium does not flag autofill-replayed values as invalid by default. It is defensive against Safari and Firefox historical quirks; the cost is one extra selector term.

# Signal Forms Migration — Validation Plan

## Status

Draft. PRs land in order (PR1 → PR2a → PR2b → PR2c → PR2d → PR3). The verification log below is a forecast; replace it with actual run output once each PR lands.

## Top-Level Validation Strategy

Every PR runs the **same three-layer check** before review:

1. **Static guard** — `rg` over the touched paths to confirm the old API is gone and the new API is in.
2. **Focused e2e** — the Nx target `pnpm nx e2e app-e2e` filtered to the affected route(s). Boot the gateway per `docs/agents/e2e.md > Full-Server E2E Playbook` and run only the slice.
3. **Visual capture** — `node scripts/capture-ui-snapshots.cjs` regenerates the `media/ui-snapshots/*.png` grid against the new code path, then a reviewer diffs against the previous PR's grid to confirm no visual regression.

After PR2d lands, the **full e2e suite** runs (`pnpm nx e2e app-e2e --grep sign-in --grep sign-up --grep verify-email --grep verify-device --grep forgotten-password --grep reset-password --grep activation --grep project`) plus the auth flow recording (`node scripts/capture-auth-flow.cjs`).

## Bootstrap (run once per fresh environment)

```bash
# 1. Playwright browser binaries (one-time per checkout)
pnpm exec playwright install chromium

# 2. Redis sidecar (the worker needs it; the spec uses the same env the e2e config injects)
podman run -d --name themis-redis docker.io/library/redis:7-alpine
# or: docker run -d --name themis-redis redis:7-alpine

# 3. Free ports 8080 (worker) and 8081 (gateway) before each run
ps aux | grep "dist/apps" | grep -v grep | awk '{print $2}' | xargs -r kill -9
```

Without these three the e2e suite fails fast with "Executable doesn't exist at chrome-headless-shell" or with the worker exiting and the gateway shutting down.

## Cross-PR Static Validation

```bash
pnpm nx run app:lint                          # expected: 0 errors, 0 new warnings
pnpm nx run app:typecheck                     # expected: 0 errors
pnpm nx run app:vite:test                     # expected: existing tests pass; new form.spec.ts and route spec additions pass
pnpm nx run site:lint                         # expected: 0 errors
pnpm nx run site:typecheck                    # expected: 0 errors
pnpm nx run ui-designer:lint                  # expected: 0 errors
pnpm nx run ui-designer:build                 # expected: builds dist/apps/web/ui-designer
```

## Visual Baseline Capture (run BEFORE PR1)

Capture a baseline of the `media/ui-snapshots/` and `media/auth-flow-videos/` directories before any code change so each PR can diff against the previous PR's grid:

```bash
# 1. Build the runtime bundle the e2e webServer depends on
pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production

# 2. Boot the gateway (env vars match apps/web/app-e2e/playwright.config.ts)
DATABASE_AUTO_MIGRATE=true \
DATABASE_DRIVER=memory \
MAIL_TRANSPORT=memory \
ENABLE_TEST_API=true \
HOST=127.0.0.1 \
NG_ALLOWED_HOSTS=127.0.0.1 \
PORT=8081 \
SESSION_SECRET=themis-app-e2e-secret \
node dist/apps/web/server/main.js &
sleep 6

# 3. Capture the static grid (60 auth PNGs + 12 site PNGs = 72 PNGs)
node scripts/capture-ui-snapshots.cjs

# 4. Capture the interactive auth flow (WebM recordings)
node scripts/capture-auth-flow.cjs

# 5. Stash the baseline (each PR diffs against the previous PR's snapshot)
git add media/ && git commit -m "chore(visual): capture pre-signal-forms baseline"
```

Output grid (per `scripts/capture-ui-snapshots.cjs`):

| Surface | Routes                                                                            | Viewports                | Themes      | Files                                                                       |
| ------- | --------------------------------------------------------------------------------- | ------------------------ | ----------- | --------------------------------------------------------------------------- |
| site    | `/en/`, `/es/`                                                                    | 375, 768, 1280           | light, dark | `media/ui-snapshots/site-{en-home,es-home}-{375,768,1280}-{light,dark}.png` |
| auth    | sign-in, sign-up, forgotten-password, verify-email, verify-device, reset-password | 360, 390, 520, 768, 1280 | light, dark | `media/ui-snapshots/auth-{route}-{360,390,520,768,1280}-{light,dark}.png`   |

The site surface is unaffected by this spec but gets re-captured so the diff isn't noisy on PR3 (only the auth half should change).

---

## PR1 — Primitive migration + `<app-form>` rewrite + `form-errors` removal + sign-in proof

### Static

```bash
rg "FormGroup|FormControl|FormBuilder|ReactiveFormsModule|formControlName|formGroupName|\[formGroup\]|\[formControl\]" apps/web/app/src/app/shared apps/web/app/src/app/auth/sign-in
# expected: 0 matches

rg "controlError" apps/web/app/src/app
# expected: 0 matches

rg "from '@angular/forms'" apps/web/app/src/app | grep -v "@angular/forms/signals"
# expected: 0 matches

rg "from '@angular/forms/signals'" apps/web/app/src/app/shared/ui/forms apps/web/app/src/app/auth/sign-in
# expected: ≥ 12 matches

ls apps/web/app/src/app/shared/form/
# expected: form-errors.ts is gone; the directory may be empty or removed

rg "\[formField\]" apps/web/app/src/app/shared/ui/forms apps/web/app/src/app/auth/sign-in
# expected: ≥ 12 matches

rg "formRoot" apps/web/app/src/app/shared/ui/forms/form
# expected: ≥ 1 match
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

### E2E (focused on sign-in)

```bash
# Reuse the gateway from the baseline capture (it is still running on 8081)
# If the gateway is down, re-boot it as in the bootstrap section.

pnpm nx e2e app-e2e --grep sign-in --grep @typing-window --skip-nx-cache
# expected: all sign-in specs pass; the @typing-window spec asserts
#   (1) the inline error is hidden while focus is inside the field
#   (2) it reveals on blur if the value is still invalid
#   (3) it hides again on re-focus
#   (4) the @submitted-empty spec reveals empty required fields after submit
```

The sign-in route spec (`apps/web/app-e2e/src/auth/sign-in.spec.ts:41-61`) already asserts the functional contract the new Signal Forms path must preserve:

```ts
await emailField.fill('bad-email');
await passwordField.fill('short');
await page.getByRole('button', { name: 'Sign in' }).click();
await expect(page).toHaveURL(signInUrlPattern);
await expect(page.getByText(/Enter (a valid|your) email address/)).toBeVisible();
await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
```

The localized copy is what the new `f.email().errors()[0]?.message` returns. If the spec fails, the schema's `{message: '…'}` is wrong.

### Visual (re-capture + diff)

```bash
# Re-capture only the auth half (the site half is unaffected)
node scripts/capture-ui-snapshots.cjs

# Diff against the baseline commit
git diff --stat media/ui-snapshots/auth-sign-in-*.png
# expected: most files unchanged or near-zero diff (the rendered DOM is structurally identical);
# per-pixel diff is allowed but the human reviewer walks the M-1..M-12 checklist in
# docs/specs/2026-06-28-css-driven-field-errors/sdd.md to confirm no visual regression.
```

Manually walk these snapshot files in `media/ui-snapshots/` (representative subset):

| Surface       | File                          | Expected after PR1                                                     |
| ------------- | ----------------------------- | ---------------------------------------------------------------------- |
| sign-in empty | `auth-sign-in-360-light.png`  | Same Open Design chrome; empty email + password fields; "Sign in" CTA. |
| sign-in dark  | `auth-sign-in-360-dark.png`   | Same in dark mode; `zinc-900` background, `zinc-50` text.              |
| sign-in 1280  | `auth-sign-in-1280-light.png` | Same wider layout; card centered.                                      |

For the **error reveal** path (not captured by the static script, since it requires interaction), use the e2e spec's flow:

1. Open `auth-sign-in-360-light.png` and `auth-sign-in-360-dark.png` for the "empty form" baseline.
2. Run `pnpm nx e2e app-e2e --grep @typing-window` and capture a screenshot at the post-blur moment (the spec already passes the functional assertion; the screenshot is the visual confirmation).
3. Confirm: red border on the email field, message text below the field, no other fields affected.

### Files touched

- `apps/web/app/src/app/shared/ui/forms/input/{input.ts,input.html,input.spec.ts}`
- `apps/web/app/src/app/shared/ui/forms/password-input/{password-input.ts,password-input.html,password-input.spec.ts}`
- `apps/web/app/src/app/shared/ui/forms/textarea/{textarea.ts,textarea.html,textarea.spec.ts}` (if spec exists)
- `apps/web/app/src/app/shared/ui/forms/select/{select.ts,select.html,select.spec.ts}` (if spec exists)
- `apps/web/app/src/app/shared/ui/forms/pin-input/{pin-input.ts,pin-input.html,pin-input.spec.ts}`
- `apps/web/app/src/app/shared/ui/forms/checkbox/{checkbox.ts,checkbox.html,checkbox.spec.ts}` (if spec exists)
- `apps/web/app/src/app/shared/ui/forms/radio-group/{radio-group.ts,radio-group.html,radio-group.spec.ts}` (if spec exists)
- `apps/web/app/src/app/shared/ui/forms/radio-card/{radio-card.ts,radio-card.html,radio-card.spec.ts}`
- `apps/web/app/src/app/shared/ui/forms/switch/{switch.ts,switch.html,switch.spec.ts}` (if spec exists)
- `apps/web/app/src/app/shared/ui/forms/color-picker/{color-picker.ts,color-picker.html,color-picker.spec.ts}` (if spec exists)
- `apps/web/app/src/app/shared/ui/forms/form/{form.ts,form.html,form.spec.ts}` (rewritten)
- `apps/web/app/src/app/shared/form/form-errors.ts` (deleted)
- `apps/web/app/src/app/shared/form/form-errors.spec.ts` (deleted)
- `apps/web/app/src/app/auth/sign-in/{sign-in.ts,sign-in.html}`
- `apps/web/app-e2e/src/auth/sign-in.spec.ts` (refreshed only if rendered DOM changes)

### Acceptance

- The static guards above return 0 matches / ≥ N matches as noted.
- `pnpm nx e2e app-e2e --grep sign-in --grep @typing-window` passes.
- The auth-sign-in snapshot diff is structurally identical (the human reviewer ticks the M-1..M-12 rows from the previous spec).

---

## PR2a — sign-up, forgotten-password

### Static

```bash
rg "FormGroup|FormControl|Validators|formControlName|\[formGroup\]|\[formControl\]" apps/web/app/src/app/auth/sign-up apps/web/app/src/app/auth/forgotten-password
# expected: 0 matches

rg "\[formField\]" apps/web/app/src/app/auth/sign-up apps/web/app/src/app/auth/forgotten-password
# expected: ≥ 3 matches (sign-up has 3 fields, forgotten-password has 1)

rg "validate\(p\." apps/web/app/src/app/auth/sign-up
# expected: ≥ 1 match (the cross-field `confirmPassword` rule)
```

### Nx targets

```bash
pnpm nx run app:lint
pnpm nx run app:typecheck
pnpm nx run app:vite:test
```

### E2E (focused)

```bash
pnpm nx e2e app-e2e --grep sign-up --grep forgotten-password --skip-nx-cache
# expected: all sign-up + forgotten-password specs pass

# Specific assertions the spec files already make that the new code must preserve:
# - apps/web/app-e2e/src/auth/sign-up.spec.ts:17  → 'shows validation errors for invalid credentials'
# - apps/web/app-e2e/src/auth/sign-up.spec.ts:26  → 'moves into verification after a valid submission'
# - apps/web/app-e2e/src/auth/forgotten-password.spec.ts:37 → 'shows validation errors when submitting empty form'
# - apps/web/app-e2e/src/auth/forgotten-password.spec.ts:44 → 'shows validation error for invalid email format'
```

### Visual (re-capture + diff)

```bash
node scripts/capture-ui-snapshots.cjs

# Inspect the migrated routes (filter the diff to just the PR's surface)
git diff --stat media/ui-snapshots/auth-sign-up-*.png media/ui-snapshots/auth-forgotten-password-*.png
# expected: structurally identical; the rendered DOM has the same Open Design chrome.
```

Manually walk these files in `media/ui-snapshots/`:

| Surface                  | File                                                            | Expected after PR2a                                                                                   |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| sign-up empty            | `auth-sign-up-360-light.png`                                    | Same Open Design chrome; email + password + confirm password fields; "Sign up" CTA.                   |
| sign-up cross-field      | (re-captured after running the e2e `@typing-window`-style flow) | `<app-error-message>` for `confirmPassword` reveals with the localized "Passwords don't match." text. |
| forgotten-password empty | `auth-forgotten-password-360-light.png`                         | Same Open Design chrome; single email field; "Send link" CTA.                                         |

### Acceptance

- The static guards return 0 matches / ≥ N matches as noted.
- `pnpm nx e2e app-e2e --grep sign-up --grep forgotten-password` passes.
- The sign-up + forgotten-password snapshot diff is structurally identical (M-1..M-12 holds for both routes).

---

## PR2b — reset-password

### Static

```bash
rg "FormGroup|FormControl|Validators|formControlName|\[formGroup\]|\[formControl\]" apps/web/app/src/app/auth/reset-password
# expected: 0 matches

rg "\[formField\]" apps/web/app/src/app/auth/reset-password
# expected: ≥ 3 matches (pin, password, confirmPassword)

rg "validate\(p\." apps/web/app/src/app/auth/reset-password
# expected: ≥ 1 match (the cross-field `confirmPassword` rule in step 2)

rg "manualError" apps/web/app/src/app/auth/reset-password
# expected: ≥ 1 match (the OTP step's `<app-field [manualError]>` binding for server-side errors)
```

### Nx targets

```bash
pnpm nx run app:lint
pnpm nx run app:typecheck
pnpm nx run app:vite:test
```

### E2E (focused)

```bash
pnpm nx e2e app-e2e --grep reset-password --skip-nx-cache
# expected: all reset-password specs pass

# Specific assertions the spec file already makes that the new code must preserve:
# - apps/web/app-e2e/src/auth/reset-password.spec.ts:70  → 'renders the Open Design OTP step'
# - apps/web/app-e2e/src/auth/reset-password.spec.ts:79  → 'reveals the password step after OTP verification'
# - apps/web/app-e2e/src/auth/reset-password.spec.ts:96  → 'rejects mismatched passwords' (the cross-field validate rule)
# - apps/web/app-e2e/src/auth/reset-password.spec.ts:114 → 'shows the success state after a valid password update'
```

The cross-field assertion is the load-bearing one — `expect(page.getByText("Passwords don't match.")).toBeVisible()` must still hold for the new `validate(p.confirmPassword, …)` rule.

### Visual (re-capture + diff)

```bash
node scripts/capture-ui-snapshots.cjs

git diff --stat media/ui-snapshots/auth-reset-password-*.png
# expected: structurally identical
```

Manually walk `auth-reset-password-360-light.png` (OTP step) and confirm the same Open Design chrome; then trigger the cross-field mismatch in the e2e suite and capture a screenshot of the post-submit state showing the inline "Passwords don't match." message.

### Acceptance

- The static guards return 0 matches / ≥ N matches as noted.
- `pnpm nx e2e app-e2e --grep reset-password` passes.
- The cross-field mismatch reveals inline (functional + visual).

---

## PR2c — verification-code-form (verify-email + verify-device)

### Static

```bash
rg "FormGroup|FormControl|Validators|formControlName|\[formGroup\]|\[formControl\]" apps/web/app/src/app/auth/verification-code-form
# expected: 0 matches

rg "\[formField\]" apps/web/app/src/app/auth/verification-code-form
# expected: ≥ 1 match (the pin field)

rg "fieldTree: field\.pin" apps/web/app/src/app/auth/verification-code-form
# expected: ≥ 1 match (the per-field server error return from the action)

rg "manualError" apps/web/app/src/app/auth/verify-email apps/web/app/src/app/auth/verify-device
# expected: ≥ 1 match per route (the consumers' `<app-field [manualError]>` binding, if any)
```

### Nx targets

```bash
pnpm nx run app:lint
pnpm nx run app:typecheck
pnpm nx run app:vite:test
```

### E2E (focused)

```bash
pnpm nx e2e app-e2e --grep verify-email --grep verify-device --skip-nx-cache
# expected: all verify-email + verify-device specs pass

# Specific assertions the spec files already make that the new code must preserve:
# - apps/web/app-e2e/src/auth/verify-email.spec.ts:15  → 'shows an inline error for an invalid verification code'
#   asserts: expect(page.locator('#verification-pin-error')).toContainText("The code didn");
#   this confirms the per-field server error return path through submission.action.
# - apps/web/app-e2e/src/auth/verify-email.spec.ts:30  → 'shows cooldown feedback when resend is requested too early'
# - apps/web/app-e2e/src/auth/verify-email.spec.ts:45  → 'completes sign-in verification with the latest code'
```

The `#verification-pin-error` selector is the load-bearing assertion — it confirms the per-field server error is attached to the `pin` field and the CSS rule's `data-manual-invalid` clause surfaces it.

### Visual (re-capture + diff)

```bash
node scripts/capture-ui-snapshots.cjs

git diff --stat media/ui-snapshots/auth-verify-email-*.png media/ui-snapshots/auth-verify-device-*.png
# expected: structurally identical
```

Manually walk `auth-verify-email-360-light.png` and `auth-verify-email-360-dark.png`; trigger the wrong-OTP flow in the e2e suite and capture a screenshot of the post-submit state showing the inline "The code didn't match. Try again." message.

### Acceptance

- The static guards return 0 matches / ≥ N matches as noted.
- `pnpm nx e2e app-e2e --grep verify-email --grep verify-device` passes.
- The wrong-OTP per-field error reveals inline (functional + visual).

---

## PR2d — activation, project-new

### Static

```bash
rg "FormGroup|FormControl|Validators|formControlName|\[formGroup\]|\[formControl\]" apps/web/app/src/app/activation apps/web/app/src/app/projects
# expected: 0 matches

rg "\[formField\]" apps/web/app/src/app/activation apps/web/app/src/app/projects
# expected: ≥ 1 match per file (label / name / summary)

rg "manualError" apps/web/app/src/app/activation
# expected: ≥ 1 match (the label field's manual error binding for async per-field errors)
```

### Nx targets

```bash
pnpm nx run app:lint
pnpm nx run app:typecheck
pnpm nx run app:vite:test
```

### E2E (focused)

```bash
pnpm nx e2e app-e2e --grep activation --grep project --skip-nx-cache
# expected: all activation + project-new specs pass

# Specific assertions the spec files already make that the new code must preserve:
# - apps/web/app-e2e/src/app/activation.spec.ts            → first-run activation flow
# - apps/web/app-e2e/src/projects/projects.spec.ts:25      → 'has a new project button that navigates to the create form'
# - apps/web/app-e2e/src/projects/projects.spec.ts:36      → 'can create a project with a name'
# - apps/web/app-e2e/src/projects/projects.spec.ts:53      → 'shows created project in the list'
```

The `can create a project with a name` flow is the load-bearing one for `project-new` — it exercises the form's `submission.action` and the navigation to the project detail page.

### Visual (re-capture + diff)

Activation isn't in the `scripts/capture-ui-snapshots.cjs` `AUTH_ROUTES` list (only the auth shell is captured). The new project form is part of the `/app/projects/new` route which is also not in the snapshot grid. The visual check for PR2d runs through the e2e suite:

```bash
# Trigger the empty-submit path in the project-new form and capture a screenshot
# via the e2e suite's existing helpers.
pnpm nx e2e app-e2e --grep project --skip-nx-cache
# Open the HTML report under dist/.playwright/apps/web/app-e2e/index.html after the run.
# Confirm: the new project form's empty submit reveals all required fields' errors via [data-submitted].
```

### Acceptance

- The static guards return 0 matches / ≥ N matches as noted.
- `pnpm nx e2e app-e2e --grep activation --grep project` passes.
- The async per-field error in activation surfaces inline (functional).

---

## PR3 — Recipes, version, roadmap

### Static

```bash
rg "FormGroup|FormControl|Validators|controlError" docs/design-system
# expected: 0 matches

rg "form\(model" docs/design-system/recipes.md
# expected: ≥ 1 match (the new "## Signal Forms" section)

cat apps/web/app/version.json
# expected: { "version": "1.7.0" }

rg "Signal Forms Migration" docs/constitution/roadmap.md
# expected: 1 match
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

### Files touched

- `docs/design-system/recipes.md`
- `apps/web/app/version.json`
- `docs/constitution/roadmap.md`

### Acceptance

- The static guards return 0 matches / ≥ N matches as noted.

---

## Cross-PR Full Validation (after PR2d)

### Full e2e suite

```bash
# 1. Build the full runtime bundle
pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production --skip-nx-cache

# 2. Boot the gateway
DATABASE_AUTO_MIGRATE=true \
DATABASE_DRIVER=memory \
MAIL_TRANSPORT=memory \
ENABLE_TEST_API=true \
HOST=127.0.0.1 \
NG_ALLOWED_HOSTS=127.0.0.1 \
PORT=8081 \
SESSION_SECRET=themis-app-e2e-secret \
node dist/apps/web/server/main.js &
sleep 6

# 3. Run the full app e2e suite with all relevant greps
pnpm nx e2e app-e2e --skip-nx-cache \
  --grep sign-in --grep sign-up --grep verify-email --grep verify-device \
  --grep forgotten-password --grep reset-password --grep activation --grep project

# expected: every spec in apps/web/app-e2e/src/{auth,app,projects,theme}/ passes
```

### Full visual capture

```bash
# Capture the full 72-PNG grid against the new code path
node scripts/capture-ui-snapshots.cjs

# Diff against the baseline
git diff --stat media/ui-snapshots/
# expected: site-*.png is unchanged; auth-*.png is structurally identical or near-zero diff
# (per the M-1..M-12 + SF-1..SF-6 checklists below)
```

### Auth flow recording

```bash
# Regenerate the interactive WebM recordings
node scripts/capture-auth-flow.cjs
# expected: media/auth-flow-videos/auth-flow-iphone-13-mini.webm and
# media/auth-flow-videos/auth-flow-hd-1920x1080.webm are regenerated

# Pre-flight
file media/auth-flow-videos/auth-flow-iphone-13-mini.webm
file media/auth-flow-videos/auth-flow-hd-1920x1080.webm
# expected: WebM video, VP8 or VP9, ≥ 100 KB

# Manual playback
ffplay media/auth-flow-videos/auth-flow-iphone-13-mini.webm
ffplay media/auth-flow-videos/auth-flow-hd-1920x1080.webm
# expected: full flow visible (sign-up, OTP, dashboard, logout, forgotten password,
# OTP, new password, success, sign-in, OTP, dashboard) without console errors or
# page crashes; per-field errors fade in on blur; cross-field mismatches in
# sign-up / reset-password surface inline; OTP mismatches in verify-email /
# verify-device surface inline.
```

### Snapshot diff walk

| Item      | Surface                                                                                     | Expected state                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-1..M-12 | (inherited from the previous spec — `docs/specs/2026-06-28-css-driven-field-errors/sdd.md`) | All M-\* checks continue to hold; rendered DOM is structurally identical.                                                                                                                     |
| SF-1      | `/app/en/sign-in` — invalid email + submit                                                  | The framework's `submit()` marks the email control touched; the CSS rule reveals the red border + message inline.                                                                             |
| SF-2      | `/app/en/sign-in` — `f.email().errors()` shape                                              | Returns `[]` for valid; `[{kind: 'required', message: 'Enter your email address.'}, …]` for invalid.                                                                                          |
| SF-3      | `/app/en/sign-up` — `confirmPassword` mismatch                                              | `f.confirmPassword().errors()[0]?.message` reads `'Passwords don't match.'` from the `validate` rule.                                                                                         |
| SF-4      | `/app/en/verify-email` — wrong OTP                                                          | The `submission.action` returns `{kind: 'serverError', fieldTree: field.pin, message}`; the framework attaches the error to the pin field; the CSS rule reveals it via `data-manual-invalid`. |
| SF-5      | `/app/en/sign-in` — `submitting()`                                                          | The framework's `submitting()` is `true` during the action and resets to `false` on success or error. The button uses `[disabled]="signInForm().submitting()"`.                               |
| SF-6      | All routes — direct DevTools probe                                                          | `f.email().invalid()`, `f.email().touched()`, `f.email().dirty()`, `f.email().pending()` are all `signal`-backed and reactive.                                                                |

### Viewport × theme × route grid to inspect

| Route              | 360 light                               | 360 dark                               | 1280 light                               | 1280 dark                               |
| ------------------ | --------------------------------------- | -------------------------------------- | ---------------------------------------- | --------------------------------------- |
| sign-in            | `auth-sign-in-360-light.png`            | `auth-sign-in-360-dark.png`            | `auth-sign-in-1280-light.png`            | `auth-sign-in-1280-dark.png`            |
| sign-up            | `auth-sign-up-360-light.png`            | `auth-sign-up-360-dark.png`            | `auth-sign-up-1280-light.png`            | `auth-sign-up-1280-dark.png`            |
| forgotten-password | `auth-forgotten-password-360-light.png` | `auth-forgotten-password-360-dark.png` | `auth-forgotten-password-1280-light.png` | `auth-forgotten-password-1280-dark.png` |
| verify-email       | `auth-verify-email-360-light.png`       | `auth-verify-email-360-dark.png`       | `auth-verify-email-1280-light.png`       | `auth-verify-email-1280-dark.png`       |
| verify-device      | `auth-verify-device-360-light.png`      | `auth-verify-device-360-dark.png`      | `auth-verify-device-1280-light.png`      | `auth-verify-device-1280-dark.png`      |
| reset-password     | `auth-reset-password-360-light.png`     | `auth-reset-password-360-dark.png`     | `auth-reset-password-1280-light.png`     | `auth-reset-password-1280-dark.png`     |

The 390 / 520 / 768 viewports follow the same naming pattern (`auth-<route>-<viewport>-<theme>.png`). The reviewer ticks the row for each viewport × theme × route they want to verify.

---

## Component Validation

### `app-form`

| Test                                            | Expected                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Render with no `[form]` (default) — typecheck   | TS reports `input.required<FieldTree<unknown>>()`; runtime errors if no value is provided |
| Render with `[form]="f"` (a small `FieldTree`)  | Inner `<form>` renders with `[formRoot]` bound                                            |
| `[(submitted)]` toggled externally to `true`    | Host carries `data-submitted="true"`                                                      |
| Dispatch a `submit` event on the inner `<form>` | `submitted` flips to `true`; host has `data-submitted="true"`; `(ngSubmit)` fires once    |
| `[novalidate]="true"` passed through            | Inner `<form>` has `novalidate` attribute                                                 |
| `[novalidate]="false"` (default)                | Inner `<form>` does not have the attribute                                                |
| `[form]="f"` whose `f` is invalid               | `FormRoot` does not invoke `submission.action`                                            |
| `[form]="f"` whose `f` is valid + button click  | `FormRoot` invokes `submission.action`; `f().submitting()` is `true` during the action    |

### `app-input` (and siblings)

| Test                                                     | Expected                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| Render with `[formField]="f.email"` + a rule that fails  | DOM `<input>` has `:invalid` true                                |
| Render with `[formField]="f.email"` + a rule that passes | DOM `<input>` has `:invalid` false                               |
| Render with `[required]="true"` + `[formField]`          | DOM `<input>` has `required` attribute                           |
| Render with `[pattern]="[a-z]{3}"` + `[formField]`       | DOM `<input>` has `pattern="[a-z]{3}"` attribute                 |
| Render with `[minlength]="3"` + `[formField]`            | DOM `<input>` has `minlength="3"` attribute                      |
| Update the model's `email` field                         | DOM `<input>`'s value updates; `:invalid` recomputes in lockstep |

### `app-pin-input`

| Test                                           | Expected                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Render with `[formField]="f.pin"` + 6 cells    | Each cell renders a `[formField]`-bound `<input>`                             |
| Fill cells with the right digits               | All cells `:invalid` = false; `f.pin().errors()` is `[]`                      |
| Type an out-of-pattern digit in any cell       | The cell's `:invalid` is `true`; `f.pin().errors()` contains the rule's error |
| `pattern` rule fires for `f.pin` (empty value) | `f.pin().errors()` contains `[{kind: 'required', message: '...'}]`            |

### `app-checkbox` / `app-radio-group` / `app-radio-card` / `app-switch` / `app-color-picker`

| Test                                                  | Expected                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Render with `[formField]="f.x"` + `[required]="true"` | DOM `<input>` has `required`; `:invalid` is `true` when unchecked / unselected          |
| Toggle to checked / selected                          | `:invalid` flips to `false`; the CSS rule hides the red border + message                |
| Update the model to `true`                            | The rendered DOM control reflects the new state (radio buttons + checkboxes + switches) |

### Routes

#### `sign-in`

| Test                                                                         | Expected                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Construct `signInForm` with empty email                                      | `signInForm.email().errors()[0]?.message` reads the localized "required" copy   |
| Type an invalid email                                                        | `signInForm.email().errors()[0]?.message` reads the localized "email" copy      |
| Type a valid email + valid password + click submit                           | `signInForm().submitting()` is `true` during the action; flips to `false` after |
| Action throws (auth rejects)                                                 | `signInForm().submitting()` resets; the auth-level `errorMessage` signal is set |
| Action returns `{kind: 'serverError', message: '…', fieldTree: field.email}` | `signInForm.email().errors()` contains the error; clears on next edit           |

#### `sign-up`

| Test                                   | Expected                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Cross-field `confirmPassword` mismatch | `signUpForm.confirmPassword().errors()[0]?.message` reads the localized "mismatch" copy |
| Mismatched password + click submit     | Action does not run; CSS reveal surfaces the inline error                               |
| Matched password + click submit        | Action runs; `signUpForm().submitting()` is `true` during the action                    |

#### `reset-password`

| Test                                  | Expected                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Step 1 — wrong OTP after submit       | `pinForm.pin().errors()` contains the per-field server error; clears on next edit      |
| Step 1 — valid OTP + click submit     | Action runs; transitions to step 2                                                     |
| Step 2 — mismatched `confirmPassword` | `passwordForm.confirmPassword().errors()` contains the rule's `passwordMismatch` error |

#### `verification-code-form`

| Test                                                                            | Expected                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Empty pin + click submit                                                        | Action does not run; the rule's `required` error surfaces inline        |
| 5 digits + click submit                                                         | Action does not run; the rule's `pattern` error surfaces inline         |
| 6 digits + click submit                                                         | Action runs; `pinForm().submitting()` is `true` during the action       |
| Action rejects with `{kind: 'serverError', fieldTree: field.pin, message: '…'}` | `pinForm.pin().errors()` contains the server error; clears on next edit |

#### `activation` / `project-new`

| Test                                                | Expected                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Empty `label` / `name` / `summary` + click submit   | The corresponding `FieldTree` field reports the `required` error; CSS reveals it inline          |
| Async per-field error from action (`activation.ts`) | The field's `manualError` signal is set; `<app-field [manualError]>` flips `data-manual-invalid` |

---

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
- `[formField]`-bound `<input>`s propagate `aria-invalid` based on the field tree's `invalid()` signal. The primitive's template passes the attribute through; the framework owns the value.

---

## Completion Checklist

- PR1 lands. Every primitive compiles against `[formField]`; `<app-form>` is signal-driven; `form-errors.ts` is gone; sign-in is fully migrated and the unit + e2e tests pass; the sign-in snapshot diff is structurally identical.
- PR2a lands. `sign-up` and `forgotten-password` follow the new shape and wrap their `<form>` in `<app-form [form]="…">`; the cross-field `confirmPassword` rule uses `validate(...)`; the snapshot diff is structurally identical.
- PR2b lands. `reset-password` has two `FieldTree`s (one per step); the cross-field `confirmPassword` rule lives in step 2's schema; the OTP `manualError` flow stays via `<app-field [manualError]>`.
- PR2c lands. `verification-code-form` is a `FieldTree` whose `submission.action` returns `{fieldTree: field.pin}` for per-field server errors.
- PR2d lands. `activation` and `project-new` follow the new shape; `activation`'s async per-field error routes through `[manualError]`.
- PR3 lands. `docs/design-system/recipes.md` reflects the new pattern and adds a `## Signal Forms` section; `apps/web/app/version.json` is `1.7.0`; `docs/constitution/roadmap.md` lists this spec.
- The full e2e suite (`pnpm nx e2e app-e2e --grep sign-in --grep sign-up --grep verify-email --grep verify-device --grep forgotten-password --grep reset-password --grep activation --grep project`) passes.
- The full 72-PNG visual grid regenerates without regression (the human reviewer ticks the M-1..M-12 + SF-1..SF-6 checklists).
- The auth flow recordings regenerate and load without console errors.
- This validation plan is updated to "Completed" with the verification log.

---

## Notes

- The static guards are intentionally narrow. They are a regression fence, not a full unit test. The Signal-Forms integration points (the `form()` call, the `[formField]` binding, the `submission.action` shape, the `formRoot` directive) are the only places where the implementation could regress quietly; the e2e suite + a manual snapshot diff are the catching net.
- The `submission.action` lifecycle in Signal Forms is fully event-driven: it does not run if the schema's rules fail, it runs once on submit, and it returns server-side errors per field. Routes that previously called `markAllAsTouched()` no longer need to.
- The `:not(:autofill)` clause in the previous spec's CSS rule continues to work; the Signal-Forms `FormField` directive does not interfere with browser autofill detection.
- For the `disabled` rule, the framework supports `disabled(p.x, { when: () => this.isLoading() })` for state-driven enable/disable. No Themis route uses imperative `control.disable()` today, so this is a forward-looking item; the static guard `rg "control\.disable\(\)|control\.enable\(\)" apps/web/app/src/app` is the regression fence.
- For `compatForm` / `SignalFormControl`: the spec explicitly avoids them in production code. The exports stay importable from `@angular/forms/signals/compat` for any future cross-system need. The static guard `rg "compatForm|SignalFormControl" apps/web/app/src/app` returns 0 matches by design.
- Visual diff is a human check, not an automated assertion. The `media/ui-snapshots/*.png` files are committed to the repo; the reviewer's job is to walk the grid and tick the M-_ + SF-_ rows. The 60 auth PNGs × the 5 viewports × 2 themes cover every surface the migration touches; if any PNG looks off, it traces back to a specific route's template or a primitive's host binding.
- The auth flow recordings (`media/auth-flow-videos/*.webm`) cover the interactive flow end-to-end (sign-up, OTP, dashboard, logout, forgotten password, OTP, new password, success, sign-in, OTP, dashboard). A reviewer with `ffplay` confirms no console errors, no page crashes, no flicker on the per-field error reveal, and no double-submit on rapid clicks.

# Themis UI Recipes

## Auth Shell (sign-in / sign-up / verify / forgotten-password / reset-password)

All auth routes share the same `app-auth-layout` primitive. The shell renders a sticky header (brand + language switcher + theme toggle) and a single-column main area for the card. The card is `app-auth-card` (max-width 440px, padded, surface + subtle border + shadow-sm). Both shell and card expose `data-od-id` hooks for visual e2e assertions (`auth-shell`, `brand`, `lang-menu`, `theme-toggle`, `auth-card`).

```html
<app-auth-layout>
  <app-auth-card>
    <header class="mb-7 space-y-2">
      <p
        data-slot="kicker"
        class="font-mono text-xs font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400"
        i18n="@@signInKicker"
      >
        Account access
      </p>
      <h1
        data-slot="title"
        class="font-heading text-[1.625rem] leading-tight font-bold tracking-[-0.025em] text-zinc-950 dark:text-zinc-50"
        i18n="@@signInTitle"
      >
        Sign in
      </h1>
      <p data-slot="sub" class="text-[0.9375rem] leading-6 text-zinc-500 dark:text-zinc-400" i18n="@@signInSub">
        Welcome back. Use your work email to access your Themis workspace.
      </p>
    </header>

    @if (errorMessage()) {
    <app-alert class="mb-5" tone="danger" variant="auth" i18n="@@signInAuthFailedAlert">{{ errorMessage() }}</app-alert>
    }

    <app-form class="grid gap-5" [form]="signInForm">
      <app-field>
        <app-label for="sign-in-email" i18n="@@signInEmailLabel">Email</app-label>
        <app-input
          autocomplete="email"
          [formField]="signInForm.email"
          required
          type="email"
          placeholder="name@organization.com"
          controlId="sign-in-email"
          name="email"
        />
        <app-error-message controlId="sign-in-email-error" i18n="@@signInEmailErrorInvalid"
          >{{ emailError() }}</app-error-message
        >
      </app-field>

      <app-field>
        <app-label for="sign-in-password" i18n="@@signInPasswordLabel">Password</app-label>
        <app-password-input
          autocomplete="current-password"
          [formField]="signInForm.password"
          required
          minLength="8"
          placeholder="***************"
          controlId="sign-in-password"
          name="password"
        />
        <app-error-message controlId="sign-in-password-error" i18n="@@signInPasswordErrorMinlength"
          >{{ passwordError() }}</app-error-message
        >
      </app-field>

      <label
        class="flex items-start gap-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400"
        for="sign-in-remember-device"
      >
        <app-checkbox
          [formField]="signInForm.rememberDevice"
          controlId="sign-in-remember-device"
          name="rememberDevice"
        />
        <span i18n="@@signInRememberDeviceLabel">Remember this device.</span>
      </label>

      <app-button
        data-slot="submit"
        data-od-id="submit"
        i18n="@@signInSubmitButton"
        tone="accent"
        type="submit"
        [loading]="submitting()"
        >Sign in</app-button
      >
    </app-form>

    <p class="mt-6 text-sm text-zinc-500 dark:text-zinc-400" i18n="@@signInFooterPrompt">New to Themis?</p>
    <app-link data-slot="footer" i18n="@@signInFooterLink" [routerLink]="footerLink" [text]="'Create an account'" />
  </app-auth-card>
</app-auth-layout>
```

Notes:

- The auth chrome (brand, lang, theme toggle) is owned by `app-auth-layout`; routes only render the card and its form.
- `app-password-input` defaults to `variant="text"` (mono "Show" / "Hide" with aria-label "Show password" / "Hide password"). Use `variant="icon"` for the eye / eye-off icon.
- `app-error-message` prepends a circle-alert icon when `withIcon=true` (default).
- Use `data-slot` markers (`kicker`, `title`, `sub`, `submit`, `footer`) for e2e copy assertions. Open Design copy is locked in the spec.
- The submit button uses `tone="accent"` (the Catalyst `blue-600` brand color) and `app-alert` with `variant="auth"` for danger/success above the form.
- Field error reveal is CSS-driven: the global rule in `styles.base.css` toggles `data-invalid` + `:user-invalid` + `[data-submitted]`. No `(blur)` handlers or `@if (... as message) { ... }` wrappers remain.
- Cross-field errors (e.g. password vs confirm) ride `<app-field [manualError]="...">`, not the touched gate.
- The form uses Signal Forms: `[form]="signInForm"` (a `FieldTree<SignInModel>`) plus `[formField]="signInForm.email"` on every inner control. The submit lifecycle runs through `submission: { action: ... }` inside the `form()` call.

## Form

`app-form` wraps a native `<form>` (with `FormRoot` from `@angular/forms/signals`) and exposes `[(submitted)]` (model signal) on the host as `data-submitted`. The global CSS rule consumes `[data-submitted]` to reveal every required field's error after submit, including empty inputs that were never touched. The wrapper binds the Signal-Forms root via `[form]`.

```html
<app-form class="grid gap-5" [form]="recoveryForm">
  <app-field>
    <app-label for="recovery-email" i18n="@@recoveryEmailLabel">Email</app-label>
    <app-input
      autocomplete="email"
      [formField]="recoveryForm.email"
      required
      type="email"
      placeholder="name@organization.com"
      controlId="recovery-email"
      name="email"
    />
    <app-error-message controlId="recovery-email-error" i18n="@@recoveryEmailError"
      >{{ emailError() }}</app-error-message
    >
  </app-field>

  <app-button
    data-od-id="submit"
    data-slot="submit"
    i18n="@@recoverySubmitButton"
    tone="accent"
    type="submit"
    [loading]="submitting()"
    >Send recovery link</app-button
  >
</app-form>
```

Notes:

- The host attribute `data-submitted` flips the moment the inner `<form>` dispatches `submit`. Consumers wire `[(submitted)]="submitted"` to a local signal; no manual write is required.
- `[novalidate]` defaults to `true`; pass `false` to opt in to browser-native validation.
- The submit lifecycle is driven by `form(model, schema, { submission: { action: ... } })`. The `action` only runs after the schema's rules pass. It receives the field tree, calls `field().value()` to read the model, and returns validation errors per field if needed (via `{kind, fieldTree, message}`).
- Forms that opt out of `app-form` (no submit-time reveal needed) keep the raw `<form>` element with `[formRoot]="formRoot"` directly from `@angular/forms/signals`.

## Password Strength (sign-up, reset-password)

`app-password-strength` mounts a 4-bar meter driven by a signal of the password value. The level is reflected on `data-level` (0..4) and the accessible label updates live.

```html
<app-field>
  <app-label for="sign-up-password" i18n="@@signUpPasswordLabel">Password</app-label>
  <app-password-input
    autocomplete="new-password"
    [formField]="signUpForm.password"
    required
    minLength="8"
    placeholder="***************"
    controlId="sign-up-password"
    name="password"
  />
  <app-password-strength [password]="passwordValue" />
  <app-error-message controlId="sign-up-password-error" i18n="@@signUpPasswordErrorMinlength"
    >{{ passwordError() }}</app-error-message
  >
</app-field>
```

`passwordValue` is a `computed(() => signUpForm.password().value())` on the route. The pure `computePasswordStrength(value)` helper is exported so unit tests can validate the level mapping without rendering.

## Reset Password (single-screen OTP + password)

`/app/reset-password` uses one card with internal step signal (otp -> password -> success). The OTP step delegates to `app-verification-code-form` and threads a `pinManualError` signal for the inline mismatch on server rejects. The password step reuses `app-password-strength` and `app-form` for the cross-field confirm-password mismatch via `[manualError]`.

## PIN / Verification Code

```html
<app-field [manualError]="pinManualError() ?? ''">
  <app-label for="verification-pin-1" i18n="@@verificationCodeLabel">Verification code</app-label>
  <app-pin-input
    [digits]="6"
    digitPattern="[0-9]{1}"
    [loading]="submitting()"
    [formField]="verificationForm.pin"
    idPrefix="verification-pin"
  />
  <app-description i18n="@@verificationCodeHelp">Enter the 6-digit code from your email.</app-description>
  <app-error-message controlId="verification-pin-error" i18n="@@verificationCodeErrorLength"
    >{{ resolvedPinError() }}</app-error-message
  >
</app-field>
```

The pin input renders a wrapper with `data-slot="pin-input"`; e2e helpers target `[data-slot=pin-input] input` to fill each cell.

The native per-cell `:user-invalid` reveals the surrounding field's red border post-blur. The field-level `pinManualError` is set by the consumer (verify-email, verify-device, reset-password) when the server returns an invalid-code response. The joined `pin` field is validated with `required` + `pattern(/^\d{6}$/)` (or `minLength` + `maxLength` of 6) in the route's `form()` schema.

## Field With Error

```html
<!-- Native: pure CSS reveal via the form's required rule -->
<app-field>
  <app-label for="project-name" i18n="@@projectNewNameLabel">Project name</app-label>
  <app-input
    [formField]="newProjectForm.name"
    required
    maxLength="120"
    controlId="project-name"
    name="name"
    placeholder="My application"
  />
  <app-error-message controlId="project-name-error" i18n="@@projectNewNameRequiredError"
    >{{ nameError() }}</app-error-message
  >
</app-field>

<!-- Manual: cross-field mismatch via [manualError] on <app-field> -->
<app-field [manualError]="signUpForm.confirmPassword().errors()[0]?.message ?? ''">
  <app-label for="confirm-password" i18n="@@confirmPasswordLabel">Confirm password</app-label>
  <app-password-input
    autocomplete="new-password"
    [formField]="signUpForm.confirmPassword"
    required
    minLength="8"
    controlId="confirm-password"
    name="confirmPassword"
  />
  <app-error-message controlId="confirm-password-error" i18n="@@confirmPasswordMismatchError"
    >{{ signUpForm.confirmPassword().errors()[0]?.message ?? '' }}</app-error-message
  >
</app-field>
```

The reveal rule is global (in `styles.base.css`); author code never toggles red borders or wraps `<app-error-message>` in `@if`. Both inputs and binary controls (checkbox / switch / radio-group / radio-card / color-picker) follow the same hybrid: pass `required` on the inner control, the browser owns validity, the CSS rule owns visibility. Cross-field mismatches use `validate(p.confirmPassword, ({value, valueOf}) => …)` in the route's `form()` schema; the resulting error attaches to the dependent field and surfaces via the same `f.confirmPassword().errors()` read.

## Signal Forms

Every form in Themis uses `@angular/forms/signals` (Signal Forms). Reactive Forms is retired; the `FormGroup` / `FormControl` / `[formGroup]` / `formControlName` / `Validators.*` API surface no longer appears in app code.

```ts
import { form, required, email, minLength, validate, type FieldTree } from '@angular/forms/signals';

readonly signInModel = signal({ email: '', password: '' });

readonly signInForm: FieldTree<SignInModel> = form(
  this.signInModel,
  (p) => {
    required(p.email, { message: $localize`:@@signInEmailErrorRequired:Enter your email address.` });
    email(p.email, { message: $localize`:@@signInEmailErrorInvalid:Enter a valid email address (e.g. you@company.com).` });
    required(p.password, { message: $localize`:@@signInPasswordErrorRequired:Enter your password.` });
    minLength(p.password, 8, { message: $localize`:@@signInPasswordErrorMinlength:Use at least 8 characters.` });
  },
  {
    submission: {
      action: async (field) => {
        await this.submit(field);
      },
    },
  },
);
```

```html
<app-form [form]="signInForm">
  <app-input [formField]="signInForm.email" required type="email" controlId="sign-in-email" />
  <app-error-message controlId="sign-in-email-error"
    >{{ signInForm.email().errors()[0]?.message ?? '' }}</app-error-message
  >
  <app-button type="submit" [loading]="signInForm().submitting()">Sign in</app-button>
</app-form>
```

Notes:

- `form(model, schema, options?)` returns a `FieldTree<Model>`. The schema callback receives a `SchemaPath<Model>` proxy and registers per-field rules. Each rule takes a `{message: '…'}` option (typically a `$localize` template) that becomes the first entry in `f.x().errors()`.
- Template bindings use `[formField]="f.x"` (alias for the `FormField` directive) on inner controls and `[form]="f"` (alias for the `FormRoot` directive) on `<app-form>` or the native `<form>`. Both directives are imported from `@angular/forms/signals` and added to the consumer's `imports`.
- Built-in rules: `required`, `email`, `minLength`, `maxLength`, `min`, `max`, `pattern`, `disabled`, `applyWhen`. Cross-field rules use `validate(path, ({value, valueOf}) => ErrorKind | null)`.
- Submission runs through `submission: { action }`. The action receives the field tree and is invoked only when the schema passes. It returns `{kind, message, fieldTree}` for per-field server errors or `null` / `undefined` for success.
- For per-cell `pattern` on a `pin-input`, the cell is the unit. The field-level `pinManualError` is set by the route when the server returns an invalid code and is bound to `<app-field [manualError]="…">`.
- `compatForm` and `SignalFormControl` from `@angular/forms/signals/compat` are not used in production code. They are kept available for legacy interop with libraries that still use Reactive Forms.

## App Shell (auth routes excluded)

The authenticated shell is a fixed sidebar + topbar + content outlet. Auth routes set `data: { hideAppShell: true }` so the layout hides the chrome.

```html
<app-layout>
  <router-outlet />
</app-layout>
```

The `Layout` component composes the existing `SidebarMenu` and `Topbar` (legacy components in `shared/layout/`), which already use `app-icon`, `app-avatar`, and `app-dropdown` internally.

## Sidebar Navigation

Navigation entries are plain data. Icons are names from `app-icon` (no `pi pi-*` classes).

```ts
type LayoutNavItem = {
  children?: LayoutNavItem[];
  exact: boolean;
  icon: IconName;
  label: string;
  url: string;
};
```

The `Sidebar` items consume `data-current:bg-blue-600/10 data-current:text-blue-600 dark:data-current:bg-blue-400/10 dark:data-current:text-blue-400` for the active state.

The footer is `mt-auto` and contains the user identity, the theme toggle, and the explicit `Sign out` button (`data-od-id="sidebar-sign-out"`). The user-menu dropdown was removed in the 2026-08-13 aria foundation spec; the e2e helper `signOutViaMenu` now clicks the sidebar button directly.

## Component Gallery

A live gallery of every primitive is available at `/app/en/gallery` behind `authenticatedGuard`. The gallery is the source of truth for the public API of each primitive; the catalog at `docs/design-system/components.md` is a snapshot regenerated by `scripts/generate-component-catalog.mjs`.

Each card has a `data-od-id="gallery-card-{host}"` hook (e.g. `gallery-card-button`, `gallery-card-listbox`) so the e2e suite and the snapshot script can target it without coupling to internal class names.

## Page Header

```html
<app-page-header>
  <p data-slot="eyebrow" class="text-sm font-semibold text-blue-600 dark:text-blue-500">Projects</p>
  <h1 data-slot="title" class="font-heading text-4xl font-bold text-zinc-950 dark:text-zinc-50">Project workspace</h1>
  <p data-slot="description" class="text-zinc-500 dark:text-zinc-400">Manage active work.</p>
  <app-button data-slot="actions" tone="blue">New project</app-button>
</app-page-header>
```

## Project List With Table And Cards

```html
<app-card padding="md" tone="raised" class="overflow-hidden">
  <div class="hidden grid-cols-4 gap-3 bg-zinc-50 px-6 py-3 md:grid dark:bg-zinc-900">
    <span class="text-xs font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">Project</span>
    <span class="text-xs font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">Status</span>
    <span class="text-xs font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">Created</span>
    <span class="text-xs font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">Actions</span>
  </div>

  @for (project of projects(); track project.id) {
  <article class="grid gap-3 border-t border-zinc-950/10 px-6 py-4 md:grid-cols-4 md:items-center dark:border-white/10">
    <a
      class="font-medium text-zinc-950 no-underline hover:text-blue-600 dark:text-zinc-50 dark:hover:text-blue-500"
      [routerLink]="['/projects', project.id]"
    >
      {{ project.name }}
    </a>
    <app-badge [tone]="statusTone(project.status)">{{ statusLabel(project.status) }}</app-badge>
    <span class="text-xs text-zinc-500 dark:text-zinc-400">{{ formatDate(project.createdAt) }}</span>
    <div class="flex items-center gap-2">
      <a [routerLink]="['/projects', project.id]" class="text-sm font-medium text-blue-600 dark:text-blue-500">View</a>
      <button
        type="button"
        class="text-sm font-medium text-red-600 dark:text-red-400"
        (click)="deleteProject(project.id, $event)"
      >
        Delete
      </button>
    </div>
  </article>
  }
</app-card>
```

`Badge` resolves its background and text colors from a `data-tone` attribute. Valid tones are `'zinc' | 'blue' | 'red' | 'green' | 'amber'`.

## Activation Page Tabs

Use the accessible `role="tablist"` / `role="tab"` / `role="tabpanel"` pattern with Tailwind utilities. No PrimeNG `TabView` is needed.

```html
<div role="tablist" class="flex flex-wrap border-b border-zinc-950/10 bg-zinc-50 dark:border-white/10 dark:bg-zinc-900">
  @for (tab of tabs; track tab.id) {
  <button
    type="button"
    role="tab"
    [id]="'config-tab-' + tab.id"
    [attr.aria-selected]="selected() === tab.id"
    [attr.aria-controls]="'config-tabpanel'"
    [class.bg-white]="selected() === tab.id"
    [class.dark:bg-zinc-950]="selected() === tab.id"
    [class.text-blue-600]="selected() === tab.id"
    [class.dark:text-blue-500]="selected() === tab.id"
    (click)="select(tab.id)"
  >
    {{ tab.label }}
  </button>
  }
</div>

<div role="tabpanel" [attr.aria-labelledby]="'config-tab-' + selected()" class="bg-zinc-100 p-6 dark:bg-zinc-800">
  <pre class="font-mono text-sm leading-7 break-words whitespace-pre-wrap">{{ content() }}</pre>
</div>
```

## Dialog

```html
<app-dialog [open]="dialogOpen()" ariaLabelledBy="dialog-title" (closed)="dialogOpen.set(false)">
  <h2 id="dialog-title" class="font-heading text-2xl font-bold text-zinc-950 dark:text-zinc-50">Confirm action</h2>
  <p class="text-zinc-500 dark:text-zinc-400">This action can be undone from settings.</p>
</app-dialog>
```

## Declarative Table

```html
<app-table [columns]="columns" [data]="projects" mobileCards>
  <ng-template appTableCell="name" let-project>
    <strong>{{ project.name }}</strong>
  </ng-template>
</app-table>
```

## Buttons

```html
<!-- Primary blue accent -->
<app-button tone="blue">Start run</app-button>

<!-- Neutral outline -->
<app-button tone="zinc" variant="outline">Copy context</app-button>

<!-- Destructive action -->
<app-button tone="red">Delete project</app-button>

<!-- Success / completion state -->
<app-button tone="green">Mark complete</app-button>

<!-- Warning / attention state -->
<app-button tone="amber">Resolve blocker</app-button>
```

Solid buttons use the Catalyst optical-border pattern internally. The visible border is the `--btn-border` custom property, the visible fill is the `--btn-bg` custom property, and the `after` pseudo-element renders the inset highlight shadow plus the hover overlay.

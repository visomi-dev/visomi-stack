import { Component, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { disabled, email, form, FormField, required, submit } from '@angular/forms/signals';

import { Button, Heading, Text, Link, Field, Input } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { Journey } from '../shared/journey';
import { emailMessage, requiredMessage, formFocus } from '../shared/form-errors';
import { Passkeys } from '../passkeys/passkeys';

import { passwordPolicy } from './validation';
import { Passwords } from './passwords';

@Component({
  selector: 'app-password-credentials',
  imports: [Button, Heading, Text, Link, Field, Input, FormField, RouterLink, AuthFeedback],
  providers: [AuthHttp, Passwords, Passkeys],
  template: `<section class="space-y-6">
    <header class="space-y-3">
      <h1 appUI>{{ title }}</h1>
      <p appUI tone="muted">{{ description }}</p>
    </header>
    <form novalidate class="space-y-5" [attr.data-submitted]="attempted() ? '' : null" (submit)="send($event)">
      <app-field
        #emailField="appField"
        control-id="password-email"
        [label]="emailLabel"
        [error]="fields.email().errors()[0]?.message ?? ''"
        ><input
          appUI
          [formField]="fields.email"
          id="password-email"
          type="email"
          [attr.autocomplete]="signup ? 'email' : 'username webauthn'"
          placeholder=" "
          [attr.aria-invalid]="fields.email().touched() && fields.email().invalid()"
          [attr.aria-describedby]="emailField.describedBy()"
      /></app-field>
      <app-field
        #passwordField="appField"
        control-id="account-password"
        [label]="passwordLabel"
        [description]="signup ? policy : ''"
        [error]="fields.password().errors()[0]?.message ?? ''"
        ><div class="relative">
          <input
            appUI
            [formField]="fields.password"
            id="account-password"
            [type]="visible() ? 'text' : 'password'"
            [attr.autocomplete]="signup ? 'new-password' : 'current-password'"
            placeholder=" "
            class="pr-24"
            [attr.aria-invalid]="fields.password().touched() && fields.password().invalid()"
            [attr.aria-describedby]="passwordField.describedBy()"
          /><button
            type="button"
            class="absolute inset-y-0 right-2 min-w-16 text-sm ui-focus-ring"
            [attr.aria-pressed]="visible()"
            (click)="visible.set(!visible())"
          >
            {{ visible() ? hideLabel : showLabel }}
          </button>
        </div></app-field
      >
      <button appUI type="submit" class="w-full" [disabled]="action.busy()">
        {{ signup ? createLabel : signInLabel }}
      </button>
    </form>
    <app-auth-feedback [action]="action" />
    @if (!signup) {
      <a appUI routerLink="/auth/forgot-password" class="block text-center text-sm" i18n="@@authForgotPassword"
        >Forgot your password?</a
      >
    }
    <a
      appUI
      [routerLink]="signup ? '/auth/sign-up' : '/auth/sign-in'"
      [queryParams]="navigation.returnQuery()"
      class="block border-t border-zinc-200 pt-5 text-center text-sm dark:border-zinc-800"
      i18n="@@authOtherMethod"
      >Choose another method</a
    >
  </section>`,
})
export class PasswordCredentials {
  private readonly route = inject(ActivatedRoute);
  private readonly passwords = inject(Passwords);
  private readonly passkeys = inject(Passkeys);
  private readonly journey = inject(Journey);
  private readonly router = inject(Router);
  readonly navigation = inject(AuthNavigation);

  readonly model = signal({ email: '', password: '' });
  readonly visible = signal(false);
  readonly attempted = signal(false);

  readonly signup = this.route.snapshot.data['signup'] === true;
  readonly fields = form(this.model, (path) => {
    required(path.email, { message: requiredMessage });
    email(path.email, { message: emailMessage });
    required(path.password, { message: requiredMessage });

    if (this.signup) {
      passwordPolicy(path.password);
    }

    disabled(path, { when: () => this.action.busy() });
  });

  readonly action = new Action();
  readonly title = this.signup
    ? $localize`:@@authPasswordSignUpTitle:Create your account`
    : $localize`:@@authPasswordSignInTitle:Sign in with a password`;
  readonly description = this.signup
    ? $localize`:@@authPasswordSignupDescription:Choose a password, then verify your email.`
    : $localize`:@@authPasswordSigninDescription:After your password, we will ask for a code to confirm it is you.`;
  readonly emailLabel = $localize`:@@authEmail:Email address`;
  readonly passwordLabel = $localize`:@@authPassword:Password`;
  readonly policy = $localize`:@@authPasswordPolicy:Use 12–128 characters. Spaces and passphrases are welcome.`;
  readonly showLabel = $localize`:@@authShowPassword:Show`;
  readonly hideLabel = $localize`:@@authHidePassword:Hide`;
  readonly createLabel = $localize`:@@authCreateAccount:Create an account`;
  readonly signInLabel = $localize`:@@authSignIn:Sign in`;

  private readonly focusInvalid = formFocus();

  constructor() {
    afterNextRender(() => {
      if (!this.signup) {
        void this.passkeys
          .authenticate(true)
          .then(() => this.navigation.complete())
          .catch(() => undefined);
      }
    });
  }

  send(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, async () =>
      this.action.run(async () => {
        this.passkeys.cancel();
        const { email, password } = this.model();

        try {
          const operation = this.signup
            ? this.passwords.signup(email, password)
            : this.passwords.signin(email, password);
          const pending = await operation;

          this.journey.start(this.signup ? 'email' : 'password', pending);

          await this.router.navigate([this.signup ? '/auth/verify-email' : '/auth/sign-in/verify'], {
            queryParams: this.navigation.returnQuery(),
          });
        } finally {
          this.model.update((value) => ({ ...value, password: '' }));
        }
      }),
    );

    if (this.fields().invalid()) {
      this.focusInvalid();
    }
  }
}

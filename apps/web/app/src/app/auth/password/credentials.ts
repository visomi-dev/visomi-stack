import { Component, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { disabled, email, form, FormField, required, submit } from '@angular/forms/signals';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Link, Field, Input } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { Journey } from '../shared/journey';
import { emailMessage, requiredMessage, focusInvalid } from '../shared/form-errors';
import { Passkeys } from '../passkeys/passkeys';

import { passwordPolicy } from './validation';
import { Passwords } from './passwords';

@Component({
  selector: 'app-password-credentials',
  imports: [NavigationHeading, Button, Heading, Text, Link, Field, Input, FormField, RouterLink, AuthFeedback],
  providers: [Action, AuthHttp, Passwords, Passkeys],
  templateUrl: './credentials.html',
})
export class PasswordCredentials {
  private readonly route = inject(ActivatedRoute);
  private readonly passwords = inject(Passwords);
  private readonly passkeys = inject(Passkeys);
  private readonly journey = inject(Journey);
  private readonly router = inject(Router);
  readonly navigation = inject(AuthNavigation);
  readonly action = inject(Action);

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

  send(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, {
      action: async () =>
        this.action.run(
          async () => {
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
              this.fields.password().reset('');
              this.attempted.set(false);
            }
          },
          { name: 'send' },
        ),
      onInvalid: focusInvalid,
    });
  }

  private readonly initialize = afterNextRender(() => {
    if (!this.signup) {
      void this.passkeys
        .authenticate(true)
        .then(() => this.navigation.complete())
        .catch(() => undefined);
    }
  });
}

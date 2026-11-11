import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Heading, Text, Link } from '../../ui';
import { EmailEntry } from '../shared/email-entry';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { Journey } from '../shared/journey';
import { Session } from '../session/session';
import { GoogleButton } from '../google/google-button';
import type { Pending, SessionView } from '../session/models';

import { Passkeys } from './passkeys';

@Component({
  selector: 'app-sign-up',
  imports: [NavigationHeading, Heading, Text, Link, RouterLink, EmailEntry, AuthFeedback, GoogleButton],
  providers: [Action, AuthHttp, Passkeys],
  templateUrl: './sign-up.html',
})
export class SignUp {
  readonly session = inject(Session);
  readonly navigation = inject(AuthNavigation);
  private readonly keys = inject(Passkeys);
  private readonly journey = inject(Journey);
  private readonly router = inject(Router);
  readonly action = inject(Action);

  readonly createLabel = $localize`:@@authCreatePasskeyAccount:Create account with a passkey`;

  register(email: string): void {
    void this.action.run(
      async () => {
        const result = await this.keys.register(email);

        if (result.flowId && result.expiresAt) {
          this.journey.start('email', { flowId: result.flowId, expiresAt: result.expiresAt });
        }

        await this.navigation.complete();
      },
      { name: 'register' },
    );
  }

  google(result: SessionView | (Pending & { factor: 'email' })): void {
    void this.action.run(
      async () => {
        if ('access' in result) {
          await this.navigation.complete();
        } else {
          this.journey.start('google', result);

          await this.router.navigate(['/auth/google/verify-email'], { queryParams: this.navigation.returnQuery() });
        }
      },
      { name: 'provider' },
    );
  }
}

import { Component, inject } from '@angular/core';
import { RouterLink, Router } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Link, Alert } from '../../ui';
import { Session } from '../session/session';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { Journey } from '../shared/journey';
import { GoogleButton } from '../google/google-button';
import type { Pending, SessionView } from '../session/models';

import { Passkeys } from './passkeys';

@Component({
  selector: 'app-sign-in',
  imports: [NavigationHeading, Button, Heading, Text, Link, Alert, RouterLink, AuthFeedback, GoogleButton],
  providers: [Action, AuthHttp, Passkeys],
  templateUrl: './sign-in.html',
})
export class SignIn {
  readonly session = inject(Session);
  readonly navigation = inject(AuthNavigation);
  private readonly keys = inject(Passkeys);
  private readonly router = inject(Router);
  private readonly journey = inject(Journey);
  readonly action = inject(Action);

  retry(): void {
    void this.action.run(
      async () => {
        await this.session.load(true);

        await this.session.loadProviders();

        if (this.session.status() === 'ready' && this.session.snapshot().access !== 'anonymous') {
          await this.navigation.complete();
        }
      },
      { name: 'retry' },
    );
  }

  passkey(): void {
    void this.action.run(
      async () => {
        await this.keys.authenticate();

        await this.navigation.complete();
      },
      { name: 'passkey' },
    );
  }

  google(result: SessionView | (Pending & { factor: 'email' })): void {
    void this.action.run(async () => {
      if ('access' in result) {
        await this.navigation.complete();
      } else {
        this.journey.start('google', result);

        await this.router.navigate(['/auth/google/verify-email'], { queryParams: this.navigation.returnQuery() });
      }
    });
  }
}

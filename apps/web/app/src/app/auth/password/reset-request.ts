import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Heading, Text, Link } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { Journey } from '../shared/journey';
import { EmailEntry } from '../shared/email-entry';

import { Passwords } from './passwords';

@Component({
  selector: 'app-reset-request',
  imports: [NavigationHeading, Heading, Text, Link, RouterLink, AuthFeedback, EmailEntry],
  providers: [Action, AuthHttp, Passwords],
  templateUrl: './reset-request.html',
})
export class ResetRequest {
  private readonly passwords = inject(Passwords);
  private readonly journey = inject(Journey);
  private readonly router = inject(Router);
  readonly action = inject(Action);

  request(email: string): void {
    void this.action.run(
      async () => {
        const pending = await this.passwords.reset(email);

        this.journey.start('reset', pending);

        await this.router.navigate(['/auth/reset-password']);
      },
      { name: 'request' },
    );
  }
}

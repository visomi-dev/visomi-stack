import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Heading, Text, LinkButton, Alert } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { Journey } from '../shared/journey';
import { CodeEntry } from '../shared/code-entry';
import { ResendCode } from '../shared/resend';

import { Google } from './google';

@Component({
  selector: 'app-google-verify',
  imports: [NavigationHeading, Heading, Text, LinkButton, Alert, RouterLink, AuthFeedback, CodeEntry, ResendCode],
  providers: [Action, AuthHttp, Google],
  templateUrl: './verify.html',
})
export class GoogleVerify {
  readonly journey = inject(Journey);
  private readonly google = inject(Google);
  private readonly navigation = inject(AuthNavigation);
  readonly action = inject(Action);

  verify(code: string): void {
    const pending = this.journey.challenge();

    if (pending?.purpose !== 'google') {
      return;
    }

    void this.action.run(
      async () => {
        await this.google.verify(pending.flowId, code);

        this.journey.clear();

        await this.navigation.complete();
      },
      { name: 'verify' },
    );
  }
}

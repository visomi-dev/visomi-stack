import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text } from '../../ui';
import { Session } from '../session/session';
import { Logout } from '../session/logout';
import { AuthHttp } from '../shared/http';
import { AuthFeedback } from '../shared/feedback';
import { Action } from '../shared/action';
import { Journey } from '../shared/journey';
import { AuthNavigation } from '../shared/navigation';
import { CodeEntry } from '../shared/code-entry';
import { EmailEntry } from '../shared/email-entry';
import { ResendCode } from '../shared/resend';

import { Email } from './email';

@Component({
  selector: 'app-email-verify',
  imports: [NavigationHeading, Button, Heading, Text, AuthFeedback, CodeEntry, EmailEntry, ResendCode],
  providers: [Action, AuthHttp, Email, Logout],
  templateUrl: './verify.html',
})
export class EmailVerify {
  readonly session = inject(Session);
  readonly journey = inject(Journey);
  private readonly email = inject(Email);
  private readonly navigation = inject(AuthNavigation);
  private readonly signOut = inject(Logout);
  readonly action = inject(Action);
  private readonly destroyRef = inject(DestroyRef);

  private readonly clock = signal(0);

  readonly pending = computed(() => {
    const challenge = this.journey.challenge();

    return challenge?.purpose === 'email' && Date.parse(challenge.expiresAt) > this.clock() ? challenge : null;
  });

  request(address?: string): void {
    void this.action.run(async () => {
      const pending = await this.email.request(address);

      this.journey.start('email', pending);

      await this.session.load(true);
    });
  }

  verify(code: string): void {
    const pending = this.pending();

    if (!pending) {
      return;
    }

    void this.action.run(async () => {
      await this.email.verify(pending.flowId, code);

      this.journey.clear();

      await this.navigation.complete();
    });
  }

  logout(): void {
    void this.signOut.run({ clearFlowState: () => this.journey.clear() });
  }

  private readonly initialize = afterNextRender(() => {
    this.clock.set(Date.now());
    const timer = setInterval(() => this.clock.set(Date.now()), 1000);

    this.destroyRef.onDestroy(() => clearInterval(timer));
  });
}

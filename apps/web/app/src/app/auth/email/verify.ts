import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Button, Heading, Text } from '../../ui';
import { Session } from '../session/session';
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
  imports: [Button, Heading, Text, AuthFeedback, CodeEntry, EmailEntry, ResendCode],
  providers: [AuthHttp, Email],
  templateUrl: './verify.html',
})
export class EmailVerify {
  readonly session = inject(Session);
  readonly journey = inject(Journey);
  private readonly email = inject(Email);
  private readonly http = inject(AuthHttp);
  private readonly navigation = inject(AuthNavigation);
  private readonly router = inject(Router);

  private readonly clock = signal(0);

  readonly pending = computed(() => {
    const challenge = this.journey.challenge();

    return challenge?.purpose === 'email' && Date.parse(challenge.expiresAt) > this.clock() ? challenge : null;
  });

  readonly action = new Action();

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      this.clock.set(Date.now());
      const timer = setInterval(() => this.clock.set(Date.now()), 1000);

      destroyRef.onDestroy(() => clearInterval(timer));
    });
  }

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
    void this.action.run(async () => {
      this.session.cancelOperations();

      await this.http.request('POST', '/logout', {});

      this.session.clear();
      this.journey.clear();

      await this.router.navigate(['/auth/sign-in']);
    });
  }
}

import { Component, DestroyRef, afterNextRender, computed, inject, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { Button } from '../../ui';
import { Email } from '../email/email';

import { AuthHttp, retryDelay } from './http';
import { Journey } from './journey';
import { Action } from './action';
import { AuthFeedback } from './feedback';

@Component({
  selector: 'app-resend-code',
  imports: [Button, AuthFeedback],
  providers: [Action, AuthHttp, Email],
  host: { class: 'flex min-w-0 flex-col gap-3' },
  templateUrl: './resend.html',
})
export class ResendCode {
  private readonly email = inject(Email);
  private readonly journey = inject(Journey);
  private readonly destroyRef = inject(DestroyRef);
  readonly action = inject(Action);

  readonly sent = output<void>();

  readonly clock = signal(0);
  readonly retryAt = signal(0);

  readonly remaining = computed(() =>
    this.clock() === 0
      ? 60
      : Math.max(
          0,
          Math.ceil((Math.max((this.journey.challenge()?.sentAt ?? 0) + 60000, this.retryAt()) - this.clock()) / 1000),
        ),
  );

  resend(): void {
    const current = this.journey.challenge();

    if (!current) {
      return;
    }

    void this.action.run(async () => {
      try {
        const pending = await this.email.resend(current.flowId);

        this.journey.start(current.purpose, { ...pending, factor: current.factor });
        this.sent.emit();
        this.action.setNotice($localize`:@@authCodeSent:A new code has been requested. Check your email.`);
      } catch (error) {
        if (error instanceof HttpErrorResponse) {
          this.retryAt.set(Date.now() + (retryDelay(error.headers) ?? 60) * 1000);
        }

        throw error;
      }
    });
  }

  private readonly initialize = afterNextRender(() => {
    this.clock.set(Date.now());
    const timer = setInterval(() => this.clock.set(Date.now()), 1000);

    this.destroyRef.onDestroy(() => clearInterval(timer));
  });
}

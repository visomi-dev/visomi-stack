import { Component, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { form, FormField, required, pattern, disabled, submit } from '@angular/forms/signals';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Link, Field, Input } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { codeMessage, requiredMessage, focusInvalid } from '../shared/form-errors';

import { Devices, type DeviceStatus } from './devices';

function validRequestId(value: string | null): string | null {
  return value && /^[a-f0-9-]{36}$/.test(value) ? value : null;
}

@Component({
  selector: 'app-device-review',
  imports: [NavigationHeading, Button, Heading, Text, Link, Field, Input, FormField, RouterLink, AuthFeedback],
  providers: [Action, AuthHttp, Devices],
  templateUrl: './review.html',
})
export class DeviceReview {
  private readonly api = inject(Devices);
  private readonly route = inject(ActivatedRoute);
  readonly action = inject(Action);

  readonly status = signal<DeviceStatus['status'] | null>(null);
  readonly attempted = signal(false);
  readonly model = signal({ code: '' });
  private readonly rendered = signal(false);
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  readonly fields = form(this.model, (path) => {
    required(path.code, { message: requiredMessage });
    pattern(path.code, /^\d{6}$/, { message: codeMessage });
    disabled(path, { when: () => this.action.busy() });
  });

  readonly requestId = computed(() => validRequestId(this.query().get('requestId')));

  readonly codeLabel = $localize`:@@authPairingCode:Pairing code`;

  private review: { requestId: string | null; signal: AbortSignal } | undefined;

  decide(event: Event, approve: boolean): void {
    event.preventDefault();
    const requestId = this.requestId();
    const review = this.review;

    if (!requestId || review?.requestId !== requestId || review.signal.aborted || this.status() !== 'pending') {
      return;
    }

    const { signal } = review;
    const isCurrent = () => !signal.aborted && this.requestId() === requestId;

    this.attempted.set(true);
    void submit(this.fields, {
      action: async () =>
        this.action.run(
          async () => {
            if (!isCurrent()) {
              return;
            }

            try {
              await this.api.decide(requestId, this.model().code, approve, signal);

              if (isCurrent()) {
                this.status.set(approve ? 'approved' : 'denied');
              }
            } finally {
              if (isCurrent()) {
                this.fields().reset({ code: '' });
                this.attempted.set(false);
              }
            }
          },
          { signal },
        ),
      onInvalid: focusInvalid,
    });
  }

  private loadReview(requestId: string | null, signal: AbortSignal): void {
    this.review = { requestId, signal };
    this.status.set(null);
    this.fields().reset({ code: '' });
    this.attempted.set(false);
    this.action.reset();

    if (requestId) {
      void this.action.run(
        async () => {
          const review = await this.api.review(requestId, signal);

          if (!signal.aborted && this.requestId() === requestId) {
            this.status.set(review.status);
          }
        },
        { signal },
      );
    }
  }

  private readonly syncReview = effect((onCleanup) => {
    if (!this.rendered()) {
      return;
    }

    const requestId = this.requestId();
    const controller = new AbortController();

    onCleanup(() => controller.abort());
    untracked(() => this.loadReview(requestId, controller.signal));
  });

  private readonly initialize = afterNextRender(() => this.rendered.set(true));
}

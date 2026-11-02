import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { form, FormField, required, pattern, disabled, submit } from '@angular/forms/signals';
import { distinctUntilChanged, map } from 'rxjs';

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
  imports: [Button, Heading, Text, Link, Field, Input, FormField, RouterLink, AuthFeedback],
  providers: [AuthHttp, Devices],
  templateUrl: './review.html',
})
export class DeviceReview {
  private readonly api = inject(Devices);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<DeviceStatus['status'] | null>(null);
  readonly attempted = signal(false);
  readonly model = signal({ code: '' });
  readonly requestId = signal(validRequestId(this.route.snapshot.queryParamMap.get('requestId')));

  readonly fields = form(this.model, (path) => {
    required(path.code, { message: requiredMessage });
    pattern(path.code, /^\d{6}$/, { message: codeMessage });
    disabled(path, { when: () => this.action.busy() });
  });

  readonly action = new Action();
  readonly codeLabel = $localize`:@@authPairingCode:Pairing code`;

  private controller: AbortController | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.controller?.abort());
    afterNextRender(() => {
      this.route.queryParamMap
        .pipe(
          map((params) => validRequestId(params.get('requestId'))),
          distinctUntilChanged(),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((requestId) => {
          this.controller?.abort();
          const controller = new AbortController();

          this.controller = controller;
          this.requestId.set(requestId);
          this.status.set(null);
          this.fields().reset({ code: '' });
          this.attempted.set(false);
          this.action.busy.set(false);
          this.action.error.set('');
          this.action.notice.set('');

          if (requestId) {
            void this.action.run(async () => {
              const review = await this.api.review(requestId, controller.signal);

              if (!controller.signal.aborted) {
                this.status.set(review.status);
              }
            }, controller.signal);
          }
        });
    });
  }

  decide(event: Event, approve: boolean): void {
    event.preventDefault();
    const requestId = this.requestId();
    const controller = this.controller;

    if (!requestId || !controller || controller.signal.aborted || this.status() !== 'pending') {
      return;
    }

    this.attempted.set(true);
    void submit(this.fields, {
      action: async () =>
        this.action.run(async () => {
          try {
            await this.api.decide(requestId, this.model().code, approve, controller.signal);

            if (!controller.signal.aborted) {
              this.status.set(approve ? 'approved' : 'denied');
            }
          } finally {
            if (!controller.signal.aborted) {
              this.model.set({ code: '' });
            }
          }
        }, controller.signal),
      onInvalid: focusInvalid,
    });
  }
}

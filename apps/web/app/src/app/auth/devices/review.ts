import { Component, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { form, FormField, required, pattern, disabled, submit } from '@angular/forms/signals';

import { Button, Heading, Text, Link, Field, Input } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { codeMessage, requiredMessage, formFocus } from '../shared/form-errors';

import { Devices, type DeviceStatus } from './devices';

@Component({
  selector: 'app-device-review',
  imports: [Button, Heading, Text, Link, Field, Input, FormField, RouterLink, AuthFeedback],
  providers: [AuthHttp, Devices],
  templateUrl: './review.html',
})
export class DeviceReview {
  private readonly api = inject(Devices);
  private readonly route = inject(ActivatedRoute);

  readonly status = signal<DeviceStatus['status'] | null>(null);
  readonly attempted = signal(false);
  readonly model = signal({ code: '' });

  readonly fields = form(this.model, (path) => {
    required(path.code, { message: requiredMessage });
    pattern(path.code, /^\d{6}$/, { message: codeMessage });
    disabled(path, { when: () => this.action.busy() });
  });

  readonly requestId = /^[a-f0-9-]{36}$/.test(this.route.snapshot.queryParamMap.get('requestId') ?? '')
    ? this.route.snapshot.queryParamMap.get('requestId')
    : null;
  readonly action = new Action();
  readonly codeLabel = $localize`:@@authPairingCode:Pairing code`;

  private readonly focusInvalid = formFocus();

  constructor() {
    afterNextRender(() => {
      if (this.requestId) {
        void this.action.run(async () => {
          const review = await this.api.review(this.requestId!);

          this.status.set(review.status);
        });
      }
    });
  }

  decide(event: Event, approve: boolean): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, async () =>
      this.action.run(async () => {
        if (!this.requestId) {
          return;
        }

        try {
          await this.api.decide(this.requestId, this.model().code, approve);

          this.status.set(approve ? 'approved' : 'denied');
        } finally {
          this.model.set({ code: '' });
        }
      }),
    );

    if (this.fields().invalid()) {
      this.focusInvalid();
    }
  }
}

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
  template: `<section class="max-w-lg space-y-6">
    <h1 appUI i18n="@@authReviewDeviceTitle">Approve another device</h1>
    <p appUI tone="muted" i18n="@@authReviewDeviceWarning">
      Only approve a request you started. Approval allows a replacement sign-in method to be created for your account.
    </p>
    @if (status() === 'pending') {
      <form
        novalidate
        class="space-y-5"
        [attr.data-submitted]="attempted() ? '' : null"
        (submit)="decide($event, true)"
      >
        <app-field
          #field="appField"
          control-id="device-pairing-code"
          [label]="codeLabel"
          [error]="fields.code().errors()[0]?.message ?? ''"
          ><input
            appUI
            id="device-pairing-code"
            [formField]="fields.code"
            inputmode="numeric"
            autocomplete="off"
            placeholder=" "
            [attr.aria-describedby]="field.describedBy()"
            [attr.aria-invalid]="fields.code().touched() && fields.code().invalid()"
        /></app-field>
        <div class="flex flex-wrap gap-3">
          <button appUI type="submit" [disabled]="action.busy()" i18n="@@authApproveDevice">Approve request</button
          ><button
            appUI
            variant="danger"
            [disabled]="action.busy()"
            (click)="decide($event, false)"
            i18n="@@authDenyDevice"
          >
            Deny request
          </button>
        </div>
      </form>
    } @else if (status()) {
      <p role="status" i18n="@@authDeviceReviewComplete">This request is no longer waiting for approval.</p>
    } @else if (!requestId) {
      <p role="status" i18n="@@authDeviceLinkInvalid">Open the review link shown on the requesting device.</p>
    }
    <app-auth-feedback [action]="action" /><a appUI routerLink="/security" i18n="@@authBackSecurity"
      >Back to security</a
    >
  </section>`,
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

import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Button, Heading, Text, Link } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action, errorMessage } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { EmailEntry } from '../shared/email-entry';

import { Devices, type DeviceRequest, type DeviceStatus } from './devices';

@Component({
  selector: 'app-device-approval',
  imports: [Button, Heading, Text, Link, RouterLink, AuthFeedback, EmailEntry],
  providers: [AuthHttp, Devices],
  template: `<section class="space-y-6">
    <h1 appUI i18n="@@authDeviceApprovalTitle">Use your signed-in device</h1>
    @if (request(); as pending) {
      <p appUI tone="muted" i18n="@@authDeviceApprovalInstructions">
        On a device where you are already signed in, open this link and enter the pairing code shown here. Only approve
        a request you started.
      </p>
      <a appUI class="block text-sm break-all" [href]="reviewLink()" target="_blank" rel="noopener noreferrer">{{
        reviewLink()
      }}</a>
      <p class="text-sm" i18n="@@authPairingCode">Pairing code</p>
      <p class="font-mono text-3xl font-semibold tracking-widest">{{ pending.userCode }}</p>
      <p role="status">{{ statusText() }}</p>
      @if (status() === 'approved') {
        <button appUI class="w-full" [disabled]="action.busy()" (click)="consume()" i18n="@@authContinueRecovery">
          Continue recovery
        </button>
      }
      @if (status() === 'pending' || status() === 'approved') {
        <button
          appUI
          variant="secondary"
          class="w-full"
          [disabled]="action.busy()"
          (click)="cancel()"
          i18n="@@authCancelRequest"
        >
          Cancel request
        </button>
      } @else {
        <button appUI variant="secondary" class="w-full" (click)="restart()" i18n="@@authStartAgain">
          Start again
        </button>
      }
    } @else {
      <p appUI tone="muted" i18n="@@authDeviceApprovalDescription">
        Request permission to set up a new sign-in method. Approval comes from a different session where you are already
        signed in.
      </p>
      <app-email-entry [busy]="action.busy()" (confirmed)="start($event)" />
    }
    <app-auth-feedback [action]="action" /><a appUI routerLink="/auth/recovery" i18n="@@authBackRecovery"
      >Back to recovery</a
    >
  </section>`,
})
export class DeviceApproval {
  private readonly api = inject(Devices);
  private readonly navigation = inject(AuthNavigation);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly request = signal<DeviceRequest | null>(null);
  readonly status = signal<DeviceStatus['status']>('pending');

  readonly action = new Action();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private polling = false;

  constructor() {
    const visibility = () => {
      if (this.document.visibilityState !== 'hidden' && this.request() && this.status() === 'pending') {
        void this.poll();
      }
    };

    this.document.addEventListener('visibilitychange', visibility);
    this.destroyRef.onDestroy(() => {
      this.generation++;

      if (this.timer) {
        clearTimeout(this.timer);
      }

      this.document.removeEventListener('visibilitychange', visibility);
    });
  }

  reviewLink(): string {
    const origin = this.document.location?.origin ?? '';
    const base = this.document.querySelector('base')?.getAttribute('href') ?? '/app/en/';

    return origin + base + 'security/devices/review?requestId=' + encodeURIComponent(this.request()?.requestId ?? '');
  }

  statusText(): string {
    switch (this.status()) {
      case 'pending':
        return $localize`:@@authDevicePending:Waiting for approval on your other device.`;
      case 'approved':
        return $localize`:@@authDeviceApproved:Approved. Continue to set up a replacement sign-in method.`;
      case 'denied':
        return $localize`:@@authDeviceDenied:This request was denied.`;
      case 'cancelled':
        return $localize`:@@authDeviceCancelled:This request was cancelled.`;
      case 'consumed':
        return $localize`:@@authDeviceConsumed:This request has already been used.`;
      default:
        return $localize`:@@authDeviceExpired:This request expired. Start again.`;
    }
  }

  start(email: string): void {
    void this.action.run(async () => {
      this.generation++;
      const pending = await this.api.request(email);

      this.request.set(pending);
      this.status.set('pending');
      void this.poll();
    });
  }

  async poll(): Promise<void> {
    if (this.polling) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    const pending = this.request();
    const generation = this.generation;

    if (!pending || this.status() !== 'pending') {
      return;
    }

    if (Date.now() >= Date.parse(pending.expiresAt)) {
      this.status.set('expired');

      return;
    }

    if (this.document.visibilityState === 'hidden') {
      return;
    }

    this.polling = true;

    try {
      const result = await this.api.status(pending.requestId);

      if (generation === this.generation) {
        this.status.set(result.status);
        this.action.error.set('');
      }
    } catch (error) {
      if (generation === this.generation) {
        this.action.error.set(errorMessage(error));
      }
    } finally {
      this.polling = false;

      if (generation === this.generation && this.status() === 'pending') {
        this.timer = setTimeout(() => void this.poll(), 5000);
      }
    }
  }

  cancel(): void {
    const pending = this.request();

    if (pending) {
      void this.action.run(async () => {
        await this.api.cancel(pending.requestId);

        this.generation++;

        if (this.timer) {
          clearTimeout(this.timer);
        }

        this.status.set('cancelled');
      });
    }
  }

  consume(): void {
    const pending = this.request();

    if (pending) {
      void this.action.run(async () => {
        await this.api.consume(pending.requestId, pending.userCode);

        this.generation++;

        await this.navigation.complete();
      });
    }
  }

  restart(): void {
    this.generation++;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.request.set(null);
    this.action.error.set('');
  }
}

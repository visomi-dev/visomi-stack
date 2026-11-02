import { DOCUMENT, Location } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

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
  templateUrl: './request.html',
})
export class DeviceApproval {
  private readonly api = inject(Devices);
  private readonly navigation = inject(AuthNavigation);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  readonly request = signal<DeviceRequest | null>(null);
  readonly status = signal<DeviceStatus['status']>('pending');

  readonly reviewRoute = computed(() => {
    const pending = this.request();

    return pending
      ? this.router.createUrlTree(['/security/devices/review'], { queryParams: { requestId: pending.requestId } })
      : null;
  });
  readonly reviewLink = computed(() => {
    const route = this.reviewRoute();

    if (!route) {
      return '';
    }

    const path = this.location.prepareExternalUrl(this.router.serializeUrl(route));
    const origin = this.document.location?.origin;

    return origin ? new URL(path, origin).href : path;
  });

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

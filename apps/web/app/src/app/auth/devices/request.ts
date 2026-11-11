import { DOCUMENT, Location } from '@angular/common';
import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Link } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action, errorMessage } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { EmailEntry } from '../shared/email-entry';
import { BrowserRealtimeSession } from '../session/browser-realtime-session';

import { Devices, type DeviceRequest, type DeviceStatus } from './devices';

@Component({
  selector: 'app-device-approval',
  imports: [NavigationHeading, Button, Heading, Text, Link, RouterLink, AuthFeedback, EmailEntry],
  providers: [Action, AuthHttp, Devices],
  templateUrl: './request.html',
})
export class DeviceApproval {
  private readonly api = inject(Devices);
  private readonly navigation = inject(AuthNavigation);
  private readonly realtime = inject(BrowserRealtimeSession, { optional: true });
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  readonly action = inject(Action);

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

  private readonly cleanup = this.destroyRef.onDestroy(() => this.stopWatching());

  private timer: ReturnType<typeof setTimeout> | null = null;
  private polling: AbortController | null = null;
  private disconnect: (() => void) | undefined;
  private live = false;
  private refreshQueued = false;

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
    void this.action.run(
      async () => {
        this.stopWatching();

        const pending = await this.api.request(email);

        if (this.destroyRef.destroyed) {
          return;
        }

        this.request.set(pending);
        this.status.set('pending');
        this.disconnect = this.realtime?.watchDeviceApproval(pending.requestId, (event) => {
          if (event === 'disconnected' && !this.live) {
            return;
          }

          this.live = event !== 'disconnected';
          this.refreshStatus();
        });

        void this.poll();
      },
      { name: 'start' },
    );
  }

  async poll(): Promise<void> {
    if (this.polling) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const pending = this.request();

    if (!pending || !['pending', 'approved'].includes(this.status())) {
      return;
    }

    if (Date.now() >= Date.parse(pending.expiresAt)) {
      this.status.set('expired');
      this.stopWatching();

      return;
    }

    if (!this.live && this.document.visibilityState === 'hidden') {
      return;
    }

    const controller = new AbortController();
    let failed = false;

    this.polling = controller;

    try {
      const result = await this.api.status(pending.requestId, controller.signal);

      if (!controller.signal.aborted) {
        this.status.set(result.status);
        this.action.setError('');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        failed = true;
        this.action.setError(errorMessage(error));
      }
    } finally {
      if (this.polling === controller) {
        this.polling = null;

        if (!['pending', 'approved'].includes(this.status())) {
          this.stopWatching();
        } else if (this.refreshQueued) {
          this.refreshQueued = false;
          void this.poll();
        } else {
          const remaining = Math.max(0, Date.parse(pending.expiresAt) - Date.now());
          // Redis Pub/Sub can miss an event even while the browser socket stays connected.
          const interval = this.live && !failed ? 30_000 : 5000;

          this.timer = setTimeout(() => void this.poll(), Math.min(remaining, interval));
        }
      }
    }
  }

  cancel(): void {
    const pending = this.request();

    if (pending) {
      void this.action.run(
        async () => {
          await this.api.cancel(pending.requestId);

          this.stopWatching();
          this.status.set('cancelled');
        },
        { name: 'cancel' },
      );
    }
  }

  consume(): void {
    const pending = this.request();

    if (pending) {
      void this.action.run(
        async () => {
          await this.api.consume(pending.requestId, pending.userCode);

          this.stopWatching();

          await this.navigation.complete();
        },
        { name: 'consume' },
      );
    }
  }

  restart(): void {
    this.stopWatching();
    this.request.set(null);
    this.action.setError('');
  }

  private refreshStatus(): void {
    if (this.polling) {
      this.refreshQueued = true;
    } else {
      void this.poll();
    }
  }

  private stopWatching(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.polling?.abort();
    this.polling = null;
    this.disconnect?.();
    this.disconnect = undefined;
    this.live = false;
    this.refreshQueued = false;
  }

  private readonly watchVisibility = afterNextRender(() => {
    const refresh = () => {
      if (this.document.visibilityState !== 'hidden') {
        this.refreshStatus();
      }
    };

    this.document.addEventListener('visibilitychange', refresh);
    this.destroyRef.onDestroy(() => this.document.removeEventListener('visibilitychange', refresh));
  });
}

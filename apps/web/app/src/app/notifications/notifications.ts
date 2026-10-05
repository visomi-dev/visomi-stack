import { HttpClient } from '@angular/common/http';
import { Component, computed, DestroyRef, effect, inject, linkedSignal, LOCALE_ID } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DateTime } from 'luxon';
import { map, of } from 'rxjs';
import type { Subscription } from 'rxjs';

import { Auth } from '../shared/auth/auth';
import { PageTitle } from '../shared/layout/page-title';
import { Realtime } from '../shared/realtime/realtime';
import { Button } from '../shared/ui/actions/button/button';

import { notificationEnvelope } from './notification-contract';
import type { NotificationSummary } from './notification-contract';
import { NotificationPreferences } from './notification-preferences';
import { DevicePush } from './device-push';

@Component({
  selector: 'app-notifications',
  imports: [Button, PageTitle, NotificationPreferences, DevicePush],
  templateUrl: './notifications.html',
  styleUrl: './notifications.css',
})
export class Notifications {
  private readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly realtime = inject(Realtime);

  private readonly owner = computed(() => (this.auth.isAuthenticated() ? this.auth.user() : null));
  protected readonly busy = linkedSignal(() => {
    this.owner();

    return '';
  });
  protected readonly mutationError = linkedSignal(() => {
    this.owner();

    return '';
  });

  protected readonly feed = rxResource({
    // A null owner still invokes the loader so Angular cancels an in-flight request on logout.
    params: () => this.owner(),
    stream: ({ params }) =>
      params
        ? this.http
            .get<unknown>('/api/notifications', { transferCache: false })
            .pipe(map((input) => notificationEnvelope.parse(input).data))
        : of({ notifications: [], servicePush: false, pushAvailable: false as const }),
  });

  private mutation: Subscription | undefined;

  protected refresh(): void {
    this.feed.reload();
  }

  protected createdAt(notification: NotificationSummary): string {
    return DateTime.fromISO(notification.createdAt).setLocale(this.locale).toLocaleString(DateTime.DATETIME_MED);
  }

  protected markRead(notification: NotificationSummary): void {
    if (this.busy() || notification.read) return;
    const owner = this.owner();

    if (!owner) return;
    this.busy.set(notification.id);
    this.mutationError.set('');
    this.mutation = this.http
      .post<void>(`/api/notifications/${notification.id}/read`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (owner !== this.owner()) return;
          this.busy.set('');
          this.feed.reload();
        },
        error: () => {
          if (owner !== this.owner()) return;
          this.busy.set('');
          this.mutationError.set(
            $localize`:@@notificationsReadError:The notification could not be updated. Try again.`,
          );
        },
      });
  }

  private readonly cancelDepartingOwner = effect((cleanup) => {
    this.owner();
    cleanup(() => {
      this.mutation?.unsubscribe();
      this.mutation = undefined;
    });
  });

  private readonly watchInbox = effect((cleanup) => {
    const owner = this.owner();

    // Connected-state changes re-register after the transport drops old-owner watches.
    if (!owner || !this.realtime.connected()) return;
    cleanup(
      this.realtime.watchNotifications(() => {
        if (owner === this.owner()) this.feed.reload();
      }),
    );
  });
}

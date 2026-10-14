import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom, map, of, Subject, take, takeUntil } from 'rxjs';
import * as z from 'zod/mini';

import { Button } from '../shared/ui/actions/button/button';
import { Auth } from '../shared/auth/auth';

const capabilitiesEnvelope = z.object({
  data: z.strictObject({
    available: z.boolean(),
    publicKey: z.nullable(z.string()),
    registered: z.boolean(),
  }),
});

@Component({
  selector: 'app-device-push',
  imports: [Button],
  templateUrl: './device-push.html',
  styleUrl: './device-push.css',
})
export class DevicePush {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly push = inject(SwPush, { optional: true });
  private readonly auth = inject(Auth);

  protected readonly busy = signal(false);
  protected readonly error = signal(false);

  protected readonly enabled = Boolean(this.document.defaultView && this.push?.isEnabled);
  protected readonly capability = rxResource({
    params: () => (this.auth.isAuthenticated() ? this.auth.user() : null),
    stream: ({ params }) =>
      params
        ? this.http
            .get<unknown>('/api/notifications/subscriptions', { transferCache: false })
            .pipe(map((input) => capabilitiesEnvelope.parse(input).data))
        : of({ available: false, publicKey: null, registered: false }),
  });

  private readonly ownerChanges = new Subject<void>();

  protected async subscribe(): Promise<void> {
    const data = this.capability.value();
    const push = this.push;
    const owner = this.auth.user();

    if (this.busy() || !this.enabled || !push || !data?.available || !data.publicKey || !this.auth.isAuthenticated())
      return;
    this.busy.set(true);
    this.error.set(false);
    let created: PushSubscription | undefined;

    try {
      // Permission is requested only after this explicit action, never on page load.
      const existing = await firstValueFrom(push.subscription.pipe(take(1)));

      if (!this.isCurrent(owner)) return;
      const subscription = existing ?? (await push.requestSubscription({ serverPublicKey: data.publicKey }));

      if (!existing) created = subscription;
      if (!this.isCurrent(owner)) return;
      const serialized = subscription.toJSON();

      // Native JSON includes expirationTime; only the strict vendor/key contract is submitted.
      await firstValueFrom(
        this.http
          .post<void>('/api/notifications/subscriptions', {
            endpoint: serialized.endpoint,
            keys: serialized.keys,
          })
          .pipe(takeUntil(this.ownerChanges), takeUntilDestroyed(this.destroyRef)),
      );
      if (!this.isCurrent(owner)) return;
      created = undefined;
      this.capability.reload();
    } catch {
      if (this.isCurrent(owner)) this.error.set(true);
    } finally {
      // Do not leave a newly created device attached to an aborted/failed enrollment.
      // Never unsubscribe an existing registration belonging to another tab/session.
      if (created) await created.unsubscribe().catch(() => false);
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  protected async unsubscribe(): Promise<void> {
    if (this.busy() || !this.push || !this.auth.isAuthenticated()) return;
    this.busy.set(true);
    this.error.set(false);
    const owner = this.auth.user();

    try {
      // Revoke server delivery first. Local cleanup failure must not retain server authority.
      await firstValueFrom(
        this.http
          .delete<void>('/api/notifications/subscriptions')
          .pipe(takeUntil(this.ownerChanges), takeUntilDestroyed(this.destroyRef)),
      );
      if (!this.isCurrent(owner)) return;
      const subscription = await firstValueFrom(this.push.subscription.pipe(take(1)));

      if (!this.isCurrent(owner)) return;
      if (subscription) await subscription.unsubscribe();
      if (this.isCurrent(owner)) this.capability.reload();
    } catch {
      if (this.isCurrent(owner)) {
        this.error.set(true);
        this.capability.reload();
      }
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  private isCurrent(owner: ReturnType<Auth['user']>): boolean {
    return !this.destroyRef.destroyed && this.auth.isAuthenticated() && owner !== null && owner === this.auth.user();
  }

  private readonly cancelDepartingOwner = effect((cleanup) => {
    this.auth.user();
    this.auth.isAuthenticated();
    cleanup(() => this.ownerChanges.next());
  });
}

import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { DateTime } from 'luxon';

import { Auth } from '../shared/auth/auth';

import { VaultSession } from './vault-session';
import type { VaultBorrower } from './vault-session';

import { createPersistentBrowserSyncHttp, IndexedDbProjections } from 'frontend-shared';
import {
  mergeProjectionChanges,
  openSyncProjection,
  sealSyncProjection,
  deserializeEncryptedEnvelope,
  SyncOfflineError,
  SyncTransportError,
} from 'shared-crypto';
import type {
  BrowserSyncAdapter,
  EncryptedEnvelope,
  ProjectionChange,
  ProjectionMerge,
  ProjectionScope,
} from 'shared-crypto';

type SyncContext = {
  scope: ProjectionScope;
  deviceId: string;
  enrollmentVersion: number;
  generation: number;
  identity: string;
  key: CryptoKey | undefined;
  controller: AbortController;
  adapter: BrowserSyncAdapter;
  archive: IndexedDbProjections;
};
export type SyncReview = { envelopeId: string; revision: number; status: 'pending' | 'blocked' | 'conflict' };

/** A view must explicitly attach an already-enrolled workspace; authentication never unlocks projections. */
@Injectable()
export class VaultSync implements VaultBorrower {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(Auth);
  private readonly vault = inject(VaultSession);
  private readonly destroyRef = inject(DestroyRef);

  private readonly currentProjection = signal<ProjectionMerge | null>(null);
  private readonly currentReview = signal<SyncReview[]>([]);
  private readonly currentState = signal<'detached' | 'ready' | 'offline'>('detached');

  readonly projection = this.currentProjection.asReadonly();
  readonly review = this.currentReview.asReadonly();
  readonly state = this.currentState.asReadonly();

  private context: SyncContext | undefined;
  private releaseLock: (() => void) | undefined;

  constructor() {
    this.destroyRef.onDestroy(() => this.lock());
  }

  lock(): void {
    const borrowed = !!this.context;

    this.context?.controller.abort();
    if (this.context) this.context.key = undefined;
    this.context = undefined;
    this.releaseLock?.();
    this.releaseLock = undefined;
    if (borrowed) this.vault.release(this);
    this.currentProjection.set(null);
    this.currentReview.set([]);
    this.currentState.set('detached');
  }

  async attach(workspaceId: string, deviceId: string, enrollmentVersion: number): Promise<void> {
    this.lock();
    const user = this.auth.user();
    const browser = this.document.defaultView;

    if (
      !user ||
      !this.auth.isAuthenticated() ||
      !browser?.navigator.locks ||
      !browser.indexedDB ||
      !workspaceId ||
      !deviceId ||
      workspaceId.length > 256 ||
      deviceId.length > 256 ||
      !Number.isSafeInteger(enrollmentVersion) ||
      enrollmentVersion < 1 ||
      this.destroyRef.destroyed
    )
      throw new Error('sync_unavailable');
    const scope = { ownerUserId: user.id, accountId: user.accountId, workspaceId };
    const controller = new AbortController();
    const context: SyncContext = {
      scope,
      deviceId,
      enrollmentVersion,
      generation: this.vault.generation(),
      identity: this.identity(),
      key: this.vault.borrow(this),
      controller,
      adapter: createPersistentBrowserSyncHttp(
        user.id,
        {
          baseUrl: '/api',
          workspaceId,
          deviceId,
          enrollmentVersion,
          signal: controller.signal,
          fetcher: browser.fetch.bind(browser),
        },
        browser.indexedDB,
        browser.navigator.locks,
      ),
      archive: new IndexedDbProjections(browser.indexedDB, scope),
    };

    this.context = context;
    this.releaseLock = this.vault.onLock(() => this.lock());
    try {
      await context.adapter.initialize();
      this.assertCurrent(context);
      // Gateway membership and device enrollment authorize the consumer before publishing local plaintext.
      await context.adapter.pull(async (envelopes) => {
        await this.decrypt(context, envelopes);
        this.assertCurrent(context);
        await context.archive.apply(envelopes, context.controller.signal);
        this.assertCurrent(context);
      });
      const pending = context.adapter.snapshot().queue.map((entry) => deserializeEncryptedEnvelope(entry.envelope));

      await this.decrypt(context, pending);
      await context.archive.apply(pending, context.controller.signal);
      this.assertCurrent(context);
      await this.restore(context);
      this.refreshReview(context);
      this.currentState.set('ready');
    } catch (error) {
      if (this.context === context) this.lock();
      throw error;
    }
  }

  async stage(change: ProjectionChange): Promise<void> {
    const context = this.requireContext();

    if (context.adapter.snapshot().tombstones.includes(change.envelopeId)) throw new Error('sync_projection_deleted');
    const envelope = await sealSyncProjection(
      this.crypto(),
      this.key(context),
      context.scope,
      change,
      DateTime.utc().toISO(),
    );

    this.assertCurrent(context);
    await context.adapter.enqueue(envelope);
    this.assertCurrent(context);
    await context.archive.apply([envelope], context.controller.signal);
    this.assertCurrent(context);
    await this.restore(context);
    this.refreshReview(context);
  }

  async synchronize(): Promise<void> {
    const context = this.requireContext();

    try {
      await context.adapter.flush();
      this.assertCurrent(context);
      await context.adapter.pull(async (envelopes) => {
        // Authentication/decryption must succeed before a durable cursor can acknowledge any batch.
        await this.decrypt(context, envelopes);
        this.assertCurrent(context);
        await context.archive.apply(envelopes, context.controller.signal);
        this.assertCurrent(context);
      });
      this.assertCurrent(context);
      await this.restore(context);
      this.refreshReview(context);
      this.currentState.set('ready');
    } catch (error) {
      if (this.context === context && !context.controller.signal.aborted) {
        const cause = error instanceof SyncOfflineError ? error.cause : error;

        if (
          !(error instanceof SyncOfflineError) ||
          (cause instanceof SyncTransportError && cause.status < 500 && cause.status !== 429)
        ) {
          this.lock();
          throw error;
        }
        this.refreshReview(context);
        this.currentState.set('offline');
      }
      throw error;
    }
  }

  /** Only the displayed rejected revision may be discarded; a newer edit is never cleared. */
  async discard(envelopeId: string, revision: number): Promise<void> {
    const context = this.requireContext();
    const entry = this.review().find((value) => value.envelopeId === envelopeId && value.revision === revision);

    if (!entry || entry.status === 'pending') throw new Error('sync_reconciliation_required');
    await context.adapter.discard(envelopeId, revision);
    this.assertCurrent(context);
    this.refreshReview(context);
  }

  private async restore(context: SyncContext): Promise<void> {
    const changes = await this.decrypt(context, await context.archive.list());

    this.assertCurrent(context);
    this.currentProjection.set(mergeProjectionChanges(changes));
  }

  private async decrypt(
    context: SyncContext,
    envelopes: ReadonlyArray<EncryptedEnvelope>,
  ): Promise<ProjectionChange[]> {
    const changes: ProjectionChange[] = [];

    for (const envelope of envelopes) {
      this.assertCurrent(context);
      changes.push(await openSyncProjection(this.crypto(), this.key(context), context.scope, envelope));
    }
    this.assertCurrent(context);

    return changes;
  }

  private refreshReview(context: SyncContext): void {
    this.assertCurrent(context);
    this.currentReview.set(
      context.adapter.snapshot().queue.map((entry) => {
        const envelope = deserializeEncryptedEnvelope(entry.envelope);

        return { envelopeId: envelope.envelopeId, revision: envelope.revision, status: entry.status ?? 'pending' };
      }),
    );
  }

  private requireContext(): SyncContext {
    if (!this.context) throw new Error('sync_unavailable');
    this.assertCurrent(this.context);

    return this.context;
  }

  private assertCurrent(context: SyncContext): void {
    context.controller.signal.throwIfAborted();
    if (
      this.destroyRef.destroyed ||
      this.context !== context ||
      this.vault.state() !== 'unlocked' ||
      context.generation !== this.vault.generation() ||
      context.identity !== this.identity()
    ) {
      if (this.context === context) this.lock();
      throw new Error('vault_locked');
    }
  }

  private identity(): string {
    const user = this.auth.user();

    return this.auth.isAuthenticated() && user ? JSON.stringify([user.id, user.accountId, user.authVersion ?? 1]) : '';
  }

  private crypto(): Crypto {
    const crypto = this.document.defaultView?.crypto;

    if (!crypto) throw new Error('sync_unavailable');

    return crypto;
  }

  private key(context: SyncContext): CryptoKey {
    this.assertCurrent(context);
    if (!context.key) throw new Error('vault_locked');

    return context.key;
  }

  private readonly cancelDepartingOwner = effect((cleanup) => {
    this.identity();
    cleanup(() => this.lock());
  });
}

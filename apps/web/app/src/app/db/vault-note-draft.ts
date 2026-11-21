import { computed, signal } from '@angular/core';

import type { VaultSyncStatus } from '../shared/vault/vault-sync-status';

import type { ExamplePrivateResource, ExampleTarget } from './example-private-resource';

/** A null draft follows verified content; an empty string is an intentional edit. */
export class VaultNoteDraft {
  private readonly text = signal<string | null>(null);

  private timer?: ReturnType<typeof setTimeout>;

  readonly saveFailed = signal(false);

  readonly displayed = computed(() => this.text() ?? this.resource.vault.plaintext());
  readonly readOnly = computed(
    () => this.resource.pending() || (!this.resource.synchronized() && this.resource.verifiedCursor() === null),
  );

  readonly value = this.text.asReadonly();

  constructor(
    private readonly document: Document,
    private readonly resource: ExamplePrivateResource,
    private readonly status: VaultSyncStatus,
  ) {}

  edit(text: string, save: () => void): void {
    this.clear();

    if (text === this.resource.vault.plaintext()) {
      return;
    }

    this.text.set(text);
    this.document.defaultView?.addEventListener('beforeunload', this.warn);
    this.status.show('idle');
    this.timer = setTimeout(save, 600);
  }

  async persist(target: ExampleTarget, current: () => void, retryBackup: () => void): Promise<void> {
    const draft = this.text();

    if (draft === null) {
      return;
    }

    clearTimeout(this.timer);
    this.saveFailed.set(false);

    try {
      await this.resource.save(target, draft);

      current();
      this.clear();
    } catch (error) {
      current();

      if (this.resource.vault.ready()) {
        this.saveFailed.set(true);
      }

      throw error;
    }

    await this.track(() => this.resource.synchronize(target, true), current, retryBackup);
  }

  async track(work: () => Promise<void>, current: () => void, retry: () => void): Promise<void> {
    this.status.show('syncing');

    try {
      await work();

      current();

      if (this.resource.vault.ready()) {
        this.status.show(this.resource.synchronized() ? 'synced' : 'idle');
      }
    } catch (error) {
      current();

      if (this.resource.vault.ready()) {
        if (this.resource.conflict()) {
          this.status.show('idle');
        } else {
          this.status.show('retry', retry);
        }
      }

      throw error;
    }
  }

  clear(): void {
    clearTimeout(this.timer);
    this.document.defaultView?.removeEventListener('beforeunload', this.warn);
    this.text.set(null);
    this.saveFailed.set(false);
  }

  private readonly warn = (event: BeforeUnloadEvent) => event.preventDefault();
}

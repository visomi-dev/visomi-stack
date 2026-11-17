import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { VaultError, type DataContext, type DataEnvelope, type WrappingContext } from '@visomi-stack/shared-db';

import { Button, Field, Heading, Text, Textarea, Input } from '../ui';

import { VaultSession } from './vault-session';
import { vaultMessage } from './vault-messages';

/** Consumers supply a configured scope and an explicit local unlock binding. */
@Component({
  selector: 'app-vault-panel',
  imports: [Button, Field, Heading, Text, Textarea, Input],
  providers: [VaultSession],
  templateUrl: './vault-panel.html',
})
export class VaultPanel {
  private readonly destroyRef = inject(DestroyRef);

  private readonly latest = signal<DataContext | null>(null);
  private readonly unlocked = signal<string | null>(null);

  readonly binding = input.required<WrappingContext>();
  readonly context = input.required<DataContext>();
  readonly rpId = input.required<string>({ alias: 'rp-id' });
  private readonly selection = computed(() => JSON.stringify([this.binding(), this.context(), this.rpId()]));

  readonly vault = inject(VaultSession);
  private readonly selected = computed(
    () => this.unlocked() === this.selection() && this.vault.isSelected(this.binding()),
  );

  private readonly cleanup = this.destroyRef.onDestroy(() => this.invalidate(true));

  private epoch = 0;

  readonly allowInitialize = input(false, { alias: 'allow-initialize' });
  readonly saved = output<DataEnvelope>();

  readonly busy = signal(false);
  readonly editor = signal('');
  readonly pinDraft = signal('');
  readonly pinConfirmation = signal('');
  readonly notice = signal('');

  readonly status = computed(() => vaultMessage(this.selected() ? this.vault.state() : 'locked'));
  readonly ready = computed(() => this.selected() && this.vault.ready());
  readonly controlId = computed(() => `vault-${this.context().objectId}`);

  async unlock(initialize = false): Promise<void> {
    if (initialize && !this.allowInitialize()) {
      return;
    }

    await this.run(async (current) => {
      const pin = this.binding().method === 'pin-argon2id' ? new TextEncoder().encode(this.pinDraft()) : undefined;
      const confirmation = this.pinConfirmation();

      this.pinDraft.set('');
      this.pinConfirmation.set('');

      try {
        if (pin && initialize && new TextDecoder().decode(pin) !== confirmation) {
          throw new VaultError('pin-invalid');
        }

        await (pin
          ? this.vault.connect(this.binding(), this.rpId(), initialize, pin)
          : this.vault.connect(this.binding(), this.rpId(), initialize));

        current();
        this.unlocked.set(this.selection());
      } finally {
        pin?.fill(0);
      }
    });
  }

  async save(): Promise<void> {
    await this.run(async (current) => {
      this.requireReady();
      const latest = this.latest();
      const context = latest ? { ...latest, revision: latest.revision + 1 } : this.context();
      const envelope = await this.vault.seal(context, this.editor());

      current();
      this.latest.set(envelope.context);
      this.editor.set('');
      this.saved.emit(envelope);
      current();
      this.notice.set(
        $localize`:@@vaultSaved:The encrypted change is stored on this device. Synchronization is a separate operation.`,
      );
    });
  }

  async read(): Promise<void> {
    await this.run(async (current) => {
      this.requireReady();

      await this.vault.read(this.latest() ?? this.context());

      current();
    });
  }

  lock(): void {
    this.invalidate(false, true);
  }

  private requireReady(): void {
    if (!this.ready()) {
      throw new VaultError('locked');
    }
  }

  private invalidate(clearRevision: boolean, broadcast = false): void {
    this.epoch++;
    this.unlocked.set(null);
    this.editor.set('');
    this.pinDraft.set('');
    this.pinConfirmation.set('');
    this.notice.set('');
    this.busy.set(false);

    if (clearRevision) {
      this.latest.set(null);
    }

    this.vault.lock(broadcast);
  }

  private async run(work: (current: () => void) => Promise<void>): Promise<void> {
    if (this.busy()) {
      return;
    }

    const epoch = this.epoch;
    const selection = this.selection();
    const valid = () => !this.destroyRef.destroyed && epoch === this.epoch && selection === this.selection();
    const current = () => {
      if (!valid()) {
        throw new VaultError('stale-operation');
      }
    };

    this.busy.set(true);
    this.notice.set('');

    try {
      current();

      await work(current);
    } catch (error) {
      if (!valid()) {
        return;
      }

      const code = (error as { code?: unknown })?.code;

      this.notice.set(vaultMessage(typeof code === 'string' ? code : 'unavailable'));
    } finally {
      if (valid()) {
        this.busy.set(false);
      }
    }
  }

  private readonly clearLockedEditor = effect(() => {
    if (!this.ready()) {
      this.editor.set('');
      this.notice.set('');
    }
  });

  private readonly scopeChanged = effect(() => {
    this.selection();
    untracked(() => this.invalidate(true));
  });
}

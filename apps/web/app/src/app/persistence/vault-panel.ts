import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import type { DataContext, DataEnvelope, WrappingContext } from '@visomi-stack/shared-persistence';

import { Button, Field, Heading, Text, Textarea } from '../ui';

import { VaultSession } from './vault-session';
import { vaultMessage } from './vault-messages';


/** Consumers supply a configured scope and a separately provisioned PRF credential. */
@Component({
  selector: 'app-vault-panel',
  imports: [Button, Field, Heading, Text, Textarea],
  templateUrl: './vault-panel.html',
})
export class VaultPanel {
  readonly vault = inject(VaultSession);

  readonly binding = input.required<WrappingContext>();
  readonly context = input.required<DataContext>();
  readonly rpId = input.required<string>({ alias: 'rp-id' });
  readonly allowInitialize = input(false, { alias: 'allow-initialize' });
  readonly saved = output<DataEnvelope>();

  readonly busy = signal(false);
  readonly editor = signal('');
  readonly notice = signal('');
  private readonly latest = signal<DataContext | null>(null);

  readonly status = computed(() => vaultMessage(this.vault.isSelected(this.binding()) ? this.vault.state() : 'locked'));
  readonly ready = computed(() => this.vault.isSelected(this.binding()) && this.vault.ready());
  readonly controlId = computed(() => `vault-${this.context().objectId}`);

  async unlock(initialize = false): Promise<void> {
    if (initialize && !this.allowInitialize()) {
      return;
    }

    await this.run(() => this.vault.connect(this.binding(), this.rpId(), initialize));
  }

  async save(): Promise<void> {
    const latest = this.latest();
    const context = latest ? { ...latest, revision: latest.revision + 1 } : this.context();

    await this.run(async () => {
      const envelope = await this.vault.seal(context, this.editor());

      this.latest.set(envelope.context);
      this.editor.set('');
      this.saved.emit(envelope);
      this.notice.set(
        $localize`:@@vaultSaved:The encrypted change is stored on this device. Synchronization is a separate operation.`,
      );
    });
  }

  async read(): Promise<void> {
    await this.run(() => this.vault.read(this.latest() ?? this.context()));
  }

  lock(): void {
    this.editor.set('');
    this.notice.set('');
    this.vault.lock();
  }

  private async run(work: () => Promise<void>): Promise<void> {
    if (this.busy()) {
      return;
    }

    this.busy.set(true);
    this.notice.set('');

    try {
      await work();
    } catch (error) {
      const code = (error as { code?: unknown })?.code;

      this.notice.set(vaultMessage(typeof code === 'string' ? code : 'unavailable'));
    } finally {
      this.busy.set(false);
    }
  }

  private readonly clearLockedEditor = effect(() => {
    if (!this.ready()) {
      this.editor.set('');
      this.notice.set('');
    }
  });

  private readonly scopeChanged = effect(() => {
    this.context();
    this.binding();
    this.editor.set('');
    this.latest.set(null);
    this.vault.clearDisplay();
  });
}

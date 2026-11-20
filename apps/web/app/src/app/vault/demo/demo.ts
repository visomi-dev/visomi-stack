import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { VaultError, vaultUnitId, type DataContext, type WrappingContext } from '@visomi-stack/shared-db';
import { createPinMethodId, exportEncryptedBackup, PrfUnlock } from '@visomi-stack/web-frontend-db';

import { Session } from '../../auth/session/session';
import { ExampleAvailability } from '../../db/example-availability';
import { ClientDatabase, VAULT_DATABASE_NAMESPACE } from '../../shared/db/database';
import { NavigationHeading } from '../../shared/navigation-heading';
import { vaultMessage } from '../../shared/vault/vault-messages';
import { VaultSession } from '../../shared/vault/vault-session';
import { Button, Card, Field, Heading, PinInput, Text } from '../../ui';

const scope = { kind: 'tenant', tenantId: '786cc156-1520-40d6-b884-353508731b31' } as const;
const context: DataContext = {
  key: { product: 'visomi-stack-demo', domain: 'vault-sample', scope, generation: 1 },
  target: scope,
  objectId: '9a4bbdf9-cb57-437b-a800-123847530b16',
  schemaVersion: 1,
  revision: 1,
  kind: 'record',
  previousCheckpoint: null,
};

@Component({
  selector: 'app-vault-demo',
  imports: [Button, Card, Field, Heading, NavigationHeading, PinInput, Text],
  providers: [ClientDatabase, VaultSession, { provide: VAULT_DATABASE_NAMESPACE, useValue: 'reference-demo' }],
  templateUrl: './demo.html',
})
export class VaultDemo {
  private readonly document = inject(DOCUMENT);
  private readonly session = inject(Session);
  private readonly vault = inject(VaultSession);
  private readonly database = inject(ClientDatabase);

  private readonly lifetime = new AbortController();
  private readonly cleanup = inject(DestroyRef).onDestroy(() => this.lifetime.abort());

  private additionCancellation = new AbortController();

  protected readonly examples = inject(ExampleAvailability, { optional: true });

  protected readonly binding = signal<WrappingContext | undefined>(undefined);
  protected readonly passkeyBinding = signal<WrappingContext | undefined>(undefined);
  protected readonly setup = signal<'loading' | 'passkey' | 'pin-option' | 'pin' | 'unavailable'>('loading');
  protected readonly pendingPasskey = signal<WrappingContext | undefined>(undefined);
  protected readonly pendingAddition = signal<string | undefined>(undefined);
  protected readonly pinSelected = signal(false);
  protected readonly pinDraft = signal('');
  protected readonly pinConfirmation = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal('');
  protected readonly confirmation = signal('');

  protected readonly ready = computed(() => {
    const binding = this.binding();
    const passkey = this.passkeyBinding();

    return Boolean((binding && this.vault.isOpen(binding)) || (passkey && this.vault.isOpen(passkey)));
  });
  protected readonly isPin = computed(() => {
    const binding = this.binding();

    return binding ? binding.method === 'pin-argon2id' : this.setup() === 'pin';
  });
  protected readonly pinOpen = computed(() => {
    const binding = this.binding();

    return binding?.method === 'pin-argon2id' && this.vault.isOpen(binding);
  });
  protected readonly status = computed(() => vaultMessage(this.ready() ? 'ready' : 'locked'));

  protected readonly plaintext = this.vault.plaintext;

  protected async setupPasskey(): Promise<void> {
    if (this.binding() || !['passkey', 'pin-option'].includes(this.setup())) {
      return;
    }

    await this.run(
      async (signal) => {
        const view = this.document.defaultView!;

        this.setup.set('passkey');

        try {
          let binding = this.pendingPasskey();

          if (!binding) {
            const methodId = await this.discoverPasskey(signal);

            signal.throwIfAborted();
            binding = this.newBinding('passkey-prf', methodId);
            this.pendingPasskey.set(binding);

            // A verification tap can supply fresh activation after the credential picker.
            if (view.navigator.userActivation?.isActive === false) {
              return;
            }
          }

          await this.connect(binding, true, signal);

          this.pendingPasskey.set(undefined);
        } catch (error) {
          signal.throwIfAborted();

          if (!(error instanceof VaultError) || error.code !== 'unsupported-prf') {
            throw error;
          }

          this.pendingPasskey.set(undefined);
          this.setup.set('pin-option');
        }
      },
      $localize`:@@vaultDemoPasskeyError:We couldn’t verify your passkey. Try again.`,
    );
  }

  protected choosePin(): void {
    if (!this.busy() && this.setup() === 'pin-option') {
      this.setup.set('pin');
    }
  }

  protected async addPasskey(): Promise<void> {
    const pin = this.binding();

    if (!pin || !this.pinOpen() || this.passkeyBinding()) {
      return;
    }

    await this.run(
      async (signal) => {
        const cancellation = AbortSignal.any([signal, this.additionCancellation.signal]);
        const view = this.document.defaultView!;

        try {
          let methodId = this.pendingAddition();

          if (!methodId) {
            const discovered = await this.discoverPasskey(cancellation);

            methodId = discovered;
            cancellation.throwIfAborted();

            if (!this.pinOpen()) {
              throw new VaultError('locked');
            }

            this.pendingAddition.set(methodId);

            if (view.navigator.userActivation?.isActive === false) {
              return;
            }
          }

          const passkey = await this.vault.addLocalPasskey(pin, view.location.hostname, methodId, cancellation);

          cancellation.throwIfAborted();
          this.passkeyBinding.set(passkey);
          this.pendingAddition.set(undefined);
          this.confirmation.set($localize`:@@vaultDemoPasskeyAdded:Passkey added. You can still unlock with your PIN.`);
        } catch (error) {
          if (cancellation.aborted) {
            return;
          }

          if (error instanceof VaultError && error.code === 'cancelled') {
            this.notice.set($localize`:@@vaultDemoAddCancelled:Passkey addition canceled. You can try again.`);

            return;
          }

          if (error instanceof VaultError && error.code === 'unsupported-prf') {
            this.pendingAddition.set(undefined);
            this.notice.set(
              $localize`:@@vaultDemoAddUnsupported:This passkey can’t unlock your vault. Try another passkey.`,
            );

            return;
          }

          if (error instanceof VaultError && error.code === 'revision-conflict') {
            this.pendingAddition.set(undefined);
            this.notice.set(
              $localize`:@@vaultDemoAddConflict:The vault changed in another tab. Reload to see its current unlock methods.`,
            );

            return;
          }

          throw error;
        }
      },
      $localize`:@@vaultDemoAddError:We couldn’t add the passkey. Try again.`,
    );
  }

  protected async unlockPasskey(): Promise<void> {
    const passkey = this.passkeyBinding();

    if (!passkey) {
      return this.unlock();
    }

    await this.run(async () => {
      this.pinDraft.set('');
      this.pinConfirmation.set('');
      this.pinSelected.set(false);

      await this.vault.connectLocalPasskey(passkey, this.document.defaultView!.location.hostname);
    });
  }

  protected async unlock(): Promise<void> {
    const existing = this.binding();

    if ((!existing && this.setup() !== 'pin') || this.ready()) {
      return;
    }

    await this.run(async (signal) => {
      const pin = this.isPin() ? new TextEncoder().encode(this.pinDraft()) : undefined;
      const confirmation = this.pinConfirmation();

      this.pinDraft.set('');
      this.pinConfirmation.set('');

      try {
        if (pin && !existing && new TextDecoder().decode(pin) !== confirmation) {
          throw new VaultError('pin-invalid');
        }

        const binding =
          existing ?? this.newBinding('pin-argon2id', createPinMethodId(this.document.defaultView!.crypto));

        try {
          await this.connect(binding, !existing, signal, pin);
        } catch (error) {
          signal.throwIfAborted();

          if (existing && pin && error instanceof VaultError && error.code === 'corrupt') {
            this.notice.set(
              $localize`:@@vaultDemoPinError:This PIN couldn’t unlock your vault. Check your PIN and try again.`,
            );

            return;
          }

          throw error;
        }
      } finally {
        pin?.fill(0);
      }
    });
  }

  protected async read(): Promise<void> {
    const binding = this.binding();

    if (!binding || !this.ready()) {
      return;
    }

    await this.run(async (signal) => {
      const storage = await this.database.vault(binding.ownerId, signal);

      try {
        const existing = await storage.getUnit(vaultUnitId(binding.ownerId, context));

        signal.throwIfAborted();

        if (!existing) {
          // A first read also finishes setup after an interrupted or failed sample write.
          // The revision check in seal prevents replacing a note written by another tab.
          const sample = $localize`:@@vaultDemoSample:Sample note: Garden workshop at 10:00.`;

          await this.vault.seal(context, sample);
        }

        signal.throwIfAborted();

        await this.vault.read(context);
      } finally {
        storage.close();
      }
    });
  }

  protected async downloadBackup(): Promise<void> {
    const binding = this.binding();
    const view = this.document.defaultView;

    if (!binding || !view || !this.ready() || !this.plaintext() || !this.examples?.enabled()) {
      return;
    }

    await this.run(async (signal) => {
      const storage = await this.database.vault(binding.ownerId, signal);

      try {
        const serialized = await exportEncryptedBackup(storage, binding, [context]);

        signal.throwIfAborted();

        if (!this.ready() || !this.examples?.enabled()) {
          return;
        }

        const file = new Blob([serialized], { type: 'application/json' });
        const url = URL.createObjectURL(file);
        const link = this.document.createElement('a');

        try {
          link.href = url;
          link.download = 'visomi-vault-example.backup.json';
          link.click();
        } finally {
          view.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        }
      } finally {
        storage.close();
      }
    });
  }

  protected lock(): void {
    this.cancelAddition();
    this.vault.lock();
    this.pinDraft.set('');
    this.pinConfirmation.set('');
    this.pinSelected.set(false);
    this.notice.set('');
    this.confirmation.set('');
  }

  private discoverPasskey(signal: AbortSignal): Promise<string> {
    const view = this.document.defaultView!;
    const prf = new PrfUnlock({
      origin: view.location.origin,
      rpId: view.location.hostname,
      credentials: view.navigator.credentials,
      crypto: view.crypto,
    });

    return prf.discover(signal);
  }

  private cancelAddition(): void {
    this.additionCancellation.abort();
    this.additionCancellation = new AbortController();
    this.pendingAddition.set(undefined);
  }

  private newBinding(method: WrappingContext['method'], methodId: string): WrappingContext {
    const view = this.document.defaultView!;

    return {
      key: context.key,
      ownerId: this.session.user()!.id,
      deviceId: view.crypto.randomUUID(),
      method,
      methodId,
      origin: view.location.origin,
    };
  }

  private async connect(binding: WrappingContext, initialize: boolean, signal: AbortSignal, pin?: Uint8Array) {
    const rpId = this.document.defaultView!.location.hostname;

    try {
      await this.vault.connect(binding, rpId, initialize, pin);

      signal.throwIfAborted();
      this.binding.set(binding);
    } catch (error) {
      if (initialize && error instanceof VaultError && error.code === 'revision-conflict') {
        const existing = await this.vault.localBinding(context.key);

        signal.throwIfAborted();

        if (existing) {
          this.binding.set(existing);

          return;
        }
      }

      throw error;
    }
  }

  private async run(work: (signal: AbortSignal) => Promise<void>, unavailable?: string): Promise<void> {
    const signal = AbortSignal.any([this.lifetime.signal, this.session.cancellation()]);

    if (this.busy() || signal.aborted || !this.session.full() || !this.session.user()) {
      return;
    }

    this.busy.set(true);
    this.notice.set('');
    this.confirmation.set('');

    try {
      await work(signal);
    } catch (error) {
      if (!signal.aborted) {
        const code = error instanceof VaultError ? error.code : 'unavailable';

        this.notice.set(code === 'unavailable' && unavailable ? unavailable : vaultMessage(code));
      }
    } finally {
      if (!signal.aborted) {
        this.busy.set(false);
      }
    }
  }

  private readonly prepare = afterNextRender(async () => {
    const view = this.document.defaultView;
    const signal = AbortSignal.any([this.lifetime.signal, this.session.cancellation()]);

    if (!view?.isSecureContext || !view.crypto?.subtle || !this.session.full() || !this.session.user()) {
      this.setup.set('unavailable');

      return;
    }

    try {
      const existing = await this.vault.localBinding(context.key);
      const passkey =
        existing?.method === 'pin-argon2id'
          ? this.vault.localBinding(context.key, true).catch(() => undefined)
          : undefined;
      const alternate = await passkey;

      if (!signal.aborted) {
        this.binding.set(existing);
        this.passkeyBinding.set(alternate);
        this.setup.set('passkey');
      }
    } catch {
      if (!signal.aborted) {
        this.setup.set('unavailable');
      }
    }
  });

  private readonly clearLockedAddition = effect(() => {
    if (!this.pinOpen()) {
      untracked(() => this.cancelAddition());
    }
  });
}

import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { disabled, form, required, submit, validate } from '@angular/forms/signals';

import { SecurityAction } from '../shared/auth/security-action';
import { SecurityConfirmation } from '../shared/auth/security-confirmation/security-confirmation';
import { PageTitle } from '../shared/layout/page-title';
import { Button } from '../shared/ui/actions/button/button';
import { Field } from '../shared/ui/forms/field/field';
import { Form } from '../shared/ui/forms/form/form';
import { Label } from '../shared/ui/forms/label/label';
import { Input } from '../shared/ui/forms/input/input';
import { ErrorMessage } from '../shared/ui/forms/error-message/error-message';

import { PinUnlock } from './pin-unlock';
import { VaultSession } from './vault-session';
import { VaultPasskeys } from './vault-passkeys';
import { BrowserEnrollment } from './browser-enrollment';
import { SyncStatus } from './sync-status';

import { encodeRecoveryBytes, isVaultPinValid } from 'shared-crypto';

@Component({
  selector: 'app-vault-settings',
  imports: [
    SecurityConfirmation,
    PageTitle,
    Button,
    Field,
    Form,
    Label,
    Input,
    ErrorMessage,
    VaultPasskeys,
    BrowserEnrollment,
    SyncStatus,
  ],
  providers: [SecurityAction, PinUnlock],
  templateUrl: './vault-settings.html',
  styleUrl: './vault-settings.css',
})
export class VaultSettings {
  private readonly document = inject(DOCUMENT);
  private readonly vault = inject(VaultSession);
  private readonly pin = inject(PinUnlock);
  private readonly action = inject(SecurityAction);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly recovery = linkedSignal(() => {
    this.vault.generation();

    return '';
  });
  protected readonly recoveryModel = linkedSignal(() => {
    this.vault.generation();

    return { recovery: '' };
  });
  protected readonly pinModel = linkedSignal(() => {
    this.vault.generation();

    return { pin: '' };
  });

  protected readonly recoveryForm = form(this.recoveryModel, (path) => {
    required(path.recovery, { message: $localize`:@@vaultRecoveryRequired:Enter your vault recovery key.` });
    disabled(path, { when: () => this.busy() });
  });
  protected readonly pinForm = form(this.pinModel, (path) => {
    required(path.pin, { message: $localize`:@@vaultPinRequired:Enter your vault PIN.` });
    validate(path.pin, ({ value }) =>
      isVaultPinValid(value())
        ? null
        : {
            kind: 'pin',
            message: $localize`:@@vaultPinPolicy:Use six digits, without repeated digits or a consecutive sequence.`,
          },
    );
    disabled(path, { when: () => this.busy() });
  });

  protected readonly state = this.vault.state;

  constructor() {
    this.destroyRef.onDestroy(() => this.pin.cancel());
  }

  protected lock(): void {
    this.pin.cancel();
    this.vault.lock();
  }

  protected async unlockRecovery(): Promise<void> {
    await submit(this.recoveryForm, async () =>
      this.perform(async () => {
        await this.vault.unlockRecovery(this.recoveryModel().recovery.trim());
        this.recoveryModel.set({ recovery: '' });
      }),
    );
  }

  protected async unlockPin(): Promise<void> {
    await submit(this.pinForm, async () =>
      this.perform(async () => {
        await this.pin.unlock(this.pinModel().pin);
        this.pinModel.set({ pin: '' });
      }),
    );
  }

  protected async savePin(replaceCanonical = false, create = false): Promise<void> {
    await submit(this.pinForm, async () =>
      this.perform(async () => {
        const pin = this.pinModel().pin;

        await this.action.run(
          {
            authority: 'operation',
            purpose: 'vault_unlock_manage',
            targetId: 'vault-pin',
            summary: $localize`:@@vaultPinConfirm:Confirm your identity to set up or change your vault PIN.`,
          },
          async (grantId) => {
            if (this.destroyRef.destroyed) return;
            if (create) {
              const crypto = this.document.defaultView?.crypto;

              if (!crypto) throw new Error('vault_locked');
              const bytes = crypto.getRandomValues(new Uint8Array(32));

              try {
                await this.vault.unlockRecovery(encodeRecoveryBytes(bytes));
              } finally {
                bytes.fill(0);
              }
            }
            await this.pin.enroll(pin, grantId, replaceCanonical);
            if (!this.destroyRef.destroyed) {
              this.pinModel.set({ pin: '' });
              this.notice.set(
                $localize`:@@vaultPinSaved:Vault PIN saved on this browser. Export and store your recovery key safely.`,
              );
            }
          },
        );
      }),
    );
  }

  protected async removePin(): Promise<void> {
    await this.perform(async () => {
      await this.action.run(
        {
          authority: 'operation',
          purpose: 'vault_unlock_manage',
          targetId: 'vault-pin',
          summary: $localize`:@@vaultPinRemoveConfirm:Confirm your identity to revoke the vault PIN on all browsers.`,
        },
        (grantId) => this.pin.remove(grantId),
      );
    });
  }

  protected async exportRecovery(): Promise<void> {
    await this.perform(async () => {
      await this.action.run(
        {
          authority: 'operation',
          purpose: 'vault_recovery_export',
          targetId: 'vault-recovery',
          summary: $localize`:@@vaultRecoveryConfirm:Confirm your identity to reveal your vault recovery key.`,
        },
        async (grantId) => {
          const generation = this.vault.generation();
          const value = await this.vault.exportRecovery(grantId);

          if (!this.destroyRef.destroyed && generation === this.vault.generation() && this.vault.state() === 'unlocked')
            this.recovery.set(value);
        },
      );
    });
  }

  private async perform(operation: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await operation();
    } catch {
      if (!this.destroyRef.destroyed)
        this.error.set(
          $localize`:@@vaultActionError:Vault action failed. Check your recovery key, PIN, browser support or cooldown before trying again.`,
        );
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  private readonly clearDepartingSecrets = effect(() => {
    this.vault.generation();
    untracked(() => {
      // linkedSignal already clears departing-generation values synchronously. Preserve any new
      // input entered before this scheduled effect resets touched/submission state.
      this.recoveryForm().reset(this.recoveryModel());
      this.pinForm().reset(this.pinModel());
    });
  });
}

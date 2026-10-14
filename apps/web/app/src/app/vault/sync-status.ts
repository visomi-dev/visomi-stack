import { Component, DestroyRef, inject, linkedSignal, signal } from '@angular/core';
import { disabled, form, required, submit, validate } from '@angular/forms/signals';

import { Button } from '../shared/ui/actions/button/button';
import { Form } from '../shared/ui/forms/form/form';
import { Field } from '../shared/ui/forms/field/field';
import { Label } from '../shared/ui/forms/label/label';
import { Input } from '../shared/ui/forms/input/input';
import { ErrorMessage } from '../shared/ui/forms/error-message/error-message';

import { VaultSession } from './vault-session';
import { VaultSync } from './vault-sync';

@Component({
  selector: 'app-sync-status',
  providers: [VaultSync],
  imports: [Button, Form, Field, Label, Input, ErrorMessage],
  templateUrl: './sync-status.html',
  styleUrl: './sync-status.css',
})
export class SyncStatus {
  private readonly sync = inject(VaultSync);
  private readonly vault = inject(VaultSession);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly model = linkedSignal(() => {
    this.vault.generation();

    return { workspaceId: '', deviceId: '', enrollmentVersion: '1' };
  });

  protected readonly connectionForm = form(this.model, (path) => {
    required(path.workspaceId, { message: $localize`:@@vaultSyncWorkspaceRequired:Enter an enrolled workspace ID.` });
    required(path.deviceId, { message: $localize`:@@vaultSyncDeviceRequired:Enter the enrolled device ID.` });
    validate(path.enrollmentVersion, ({ value }) =>
      /^[1-9]\d{0,8}$/.test(value())
        ? null
        : { kind: 'version', message: $localize`:@@vaultSyncVersionInvalid:Enter a positive enrollment version.` },
    );
    disabled(path, {
      when: () => this.busy() || this.vault.state() !== 'unlocked' || this.sync.state() !== 'detached',
    });
  });

  protected readonly vaultState = this.vault.state;
  protected readonly state = this.sync.state;
  protected readonly review = this.sync.review;
  protected readonly projection = this.sync.projection;

  protected async connect(): Promise<void> {
    await submit(this.connectionForm, async () =>
      this.perform(async () => {
        const model = this.model();

        await this.sync.attach(model.workspaceId.trim(), model.deviceId.trim(), Number(model.enrollmentVersion));
      }),
    );
  }

  protected async synchronize(): Promise<void> {
    await this.perform(() => this.sync.synchronize());
  }

  protected disconnect(): void {
    this.sync.lock();
    this.error.set('');
  }

  protected async discard(envelopeId: string, revision: number): Promise<void> {
    await this.perform(() => this.sync.discard(envelopeId, revision));
  }

  private async perform(operation: () => Promise<void>): Promise<void> {
    if (this.busy() || this.vault.state() !== 'unlocked') return;
    const generation = this.vault.generation();

    this.busy.set(true);
    this.error.set('');
    try {
      await operation();
    } catch {
      if (!this.destroyRef.destroyed && generation === this.vault.generation())
        this.error.set(
          $localize`:@@vaultSyncFailed:Synchronization could not finish. Local encrypted changes are retained. Check your connection and workspace enrollment before retrying.`,
        );
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }
}

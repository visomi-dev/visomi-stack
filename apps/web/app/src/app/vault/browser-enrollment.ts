import { HttpClient } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { disabled, form, required, submit, validate } from '@angular/forms/signals';
import { firstValueFrom, Subject, takeUntil, timeout } from 'rxjs';
import { z } from 'zod';

import { Auth } from '../shared/auth/auth';
import { SecurityAction } from '../shared/auth/security-action';
import { Button } from '../shared/ui/actions/button/button';
import { Form } from '../shared/ui/forms/form/form';
import { Field } from '../shared/ui/forms/field/field';
import { Label } from '../shared/ui/forms/label/label';
import { Input } from '../shared/ui/forms/input/input';
import { ErrorMessage } from '../shared/ui/forms/error-message/error-message';

import { BrowserUnlock } from './browser-unlock';
import { VaultSession } from './vault-session';

@Component({
  selector: 'app-browser-enrollment',
  imports: [Button, Form, Field, Label, Input, ErrorMessage],
  providers: [BrowserUnlock],
  templateUrl: './browser-enrollment.html',
  styleUrl: './browser-enrollment.css',
})
export class BrowserEnrollment {
  private readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);
  private readonly browser = inject(BrowserUnlock);
  private readonly vault = inject(VaultSession);
  private readonly action = inject(SecurityAction);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly busy = signal(false);
  protected readonly enabled = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly model = linkedSignal(() => {
    this.vault.generation();

    return { requestId: '', code: '' };
  });

  protected readonly approvalForm = form(this.model, (path) => {
    required(path.requestId, {
      message: $localize`:@@vaultBrowserRequestRequired:Enter the request ID from the new browser.`,
    });
    required(path.code, {
      message: $localize`:@@vaultBrowserCodeRequired:Enter the comparison code from the new browser.`,
    });
    validate(path.requestId, ({ value }) =>
      z.uuid().safeParse(value().trim()).success
        ? null
        : {
            kind: 'request',
            message: $localize`:@@vaultBrowserRequestInvalid:Use the complete request ID from the new browser.`,
          },
    );
    disabled(path, {
      when: () => this.busy() || !!this.action.pending() || this.vault.state() !== 'unlocked' || !this.enabled(),
    });
  });

  private readonly identity = computed(() => {
    const owner = this.auth.user();

    return this.auth.isAuthenticated() && owner
      ? JSON.stringify([owner.id, owner.accountId, owner.authVersion ?? 1])
      : null;
  });

  protected readonly state = this.vault.state;
  protected readonly request = this.browser.request;
  protected readonly confirming = this.action.pending;

  private readonly cancelled = new Subject<void>();

  private epoch = 0;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.epoch++;
      this.cancelled.next();
    });
  }

  protected async refresh(): Promise<void> {
    const owner = this.auth.user();
    const identity = this.identity();

    if (!owner || !identity) return;
    try {
      const result = await firstValueFrom(
        this.http
          .get<unknown>(`/api/vault-unlock/${owner.accountId}/config`, { transferCache: false })
          .pipe(takeUntil(this.cancelled), timeout(10_000)),
      );
      const config = z.object({ data: z.object({ browser: z.boolean() }) }).parse(result).data;

      if (!this.destroyRef.destroyed && identity === this.identity()) this.enabled.set(config.browser);
    } catch {
      if (!this.destroyRef.destroyed && identity === this.identity()) this.enabled.set(false);
    }
  }

  protected async begin(): Promise<void> {
    await this.perform(() => this.browser.begin());
  }

  protected async receive(): Promise<void> {
    await this.perform(async () => {
      await this.browser.receive();
      if (!this.destroyRef.destroyed)
        this.notice.set(
          $localize`:@@vaultBrowserReceived:Vault unlocked on this browser. Set up a local PIN or passkey separately if you want to unlock again after reloading.`,
        );
    });
  }

  protected cancel(): void {
    this.epoch++;
    this.browser.cancel();
    this.notice.set('');
    this.error.set('');
  }

  protected async approve(): Promise<void> {
    await submit(this.approvalForm, async () =>
      this.perform(async () => {
        const input = this.model();
        const identity = this.identity();
        const generation = this.vault.generation();
        const epoch = this.epoch;
        const recipient = await this.browser.inspect(input.requestId, input.code);

        this.assertCurrent(identity, generation, epoch);
        await this.action.run(
          {
            authority: 'operation',
            purpose: 'vault_unlock_manage',
            targetId: recipient.pairing.requestId,
            summary: $localize`:@@vaultBrowserApproveConfirm:Allow the browser with this code to open your vault. Compare the complete code on both browsers before confirming.`,
          },
          async (grantId) => {
            this.assertCurrent(identity, generation, epoch);
            await this.browser.approve(recipient, grantId);
            this.assertCurrent(identity, generation, epoch);
            this.approvalForm().reset({ requestId: '', code: '' });
            this.notice.set(
              $localize`:@@vaultBrowserApproved:Connection approved. Return to the new browser and receive the vault key.`,
            );
          },
        );
      }),
    );
  }

  private assertCurrent(identity: string | null, generation: number, epoch: number): void {
    if (
      !identity ||
      identity !== this.identity() ||
      generation !== this.vault.generation() ||
      epoch !== this.epoch ||
      this.destroyRef.destroyed
    )
      throw new Error('vault_locked');
  }

  private async perform(operation: () => Promise<void>): Promise<void> {
    if (this.busy() || this.confirming() || !this.enabled()) return;
    const identity = this.identity();

    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await operation();
    } catch {
      if (!this.destroyRef.destroyed && identity === this.identity())
        this.error.set(
          $localize`:@@vaultBrowserFailed:Could not connect this browser. Check approval, both codes and expiry, or use your recovery key.`,
        );
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  private readonly initialize = afterNextRender(() => {
    void this.refresh();
  });

  private readonly clearDepartingOwner = effect((cleanup) => {
    this.identity();
    cleanup(() => {
      this.epoch++;
      this.cancelled.next();
      untracked(() => {
        this.enabled.set(false);
        this.approvalForm().reset({ requestId: '', code: '' });
        this.notice.set('');
        this.error.set('');
      });
    });
  });
}

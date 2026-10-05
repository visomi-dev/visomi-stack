import { HttpClient } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom, Subject, takeUntil, timeout } from 'rxjs';
import { z } from 'zod';

import { Auth } from '../shared/auth/auth';
import { Passkey } from '../shared/auth/passkey';
import type { PasskeyCredential } from '../shared/auth/passkey';
import { SecurityAction } from '../shared/auth/security-action';
import { Button } from '../shared/ui/actions/button/button';

import { PrfUnlock } from './prf-unlock';
import type { UnlockMethod } from './prf-unlock';
import { VaultSession } from './vault-session';

@Component({
  selector: 'app-vault-passkeys',
  imports: [Button],
  providers: [PrfUnlock],
  templateUrl: './vault-passkeys.html',
  styleUrl: './vault-passkeys.css',
})
export class VaultPasskeys {
  private readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);
  private readonly passkey = inject(Passkey);
  private readonly prf = inject(PrfUnlock);
  private readonly vault = inject(VaultSession);
  private readonly action = inject(SecurityAction);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly enabled = signal(false);
  protected readonly methods = signal<UnlockMethod[]>([]);
  private readonly credentials = signal<PasskeyCredential[]>([]);

  protected readonly candidates = computed(() =>
    this.credentials().filter(
      (credential) => !credential.revokedAt && !this.methods().some((method) => method.credentialId === credential.id),
    ),
  );
  private readonly identity = computed(() => {
    const owner = this.auth.user();

    return this.auth.isAuthenticated() && owner
      ? JSON.stringify([owner.id, owner.accountId, owner.authVersion ?? 1])
      : null;
  });

  protected readonly state = this.vault.state;
  protected readonly confirming = this.action.pending;

  private readonly cancelled = new Subject<void>();

  private attempt = 0;

  constructor() {
    this.destroyRef.onDestroy(() => this.cancel());
  }

  protected label(method: UnlockMethod): string {
    return (
      this.credentials().find((credential) => credential.id === method.credentialId)?.label ??
      $localize`:@@vaultPasskeyUnnamed:Enrolled passkey`
    );
  }

  protected async refresh(): Promise<void> {
    const owner = this.auth.user();
    const identity = this.identity();
    const attempt = ++this.attempt;

    if (!owner || !identity || this.destroyRef.destroyed) return;
    this.error.set('');
    try {
      const result = await firstValueFrom(
        this.http
          .get<unknown>(`/api/vault-unlock/${owner.accountId}/config`, { transferCache: false })
          .pipe(takeUntil(this.cancelled), timeout(10_000)),
      );
      const config = z.object({ data: z.object({ prf: z.boolean() }) }).parse(result).data;

      if (!this.current(attempt, identity)) return;
      this.enabled.set(config.prf);
      if (!config.prf) return;
      const [methods, credentials] = await Promise.all([this.prf.methods(), this.passkey.listCredentials()]);

      if (!this.current(attempt, identity)) return;
      this.methods.set(methods);
      this.credentials.set(credentials);
    } catch {
      if (this.current(attempt, identity))
        this.error.set(
          $localize`:@@vaultPasskeyLoadError:Passkey methods could not be loaded. Retry before making changes.`,
        );
    }
  }

  protected async enroll(credential: PasskeyCredential): Promise<void> {
    await this.perform(async () => {
      const identity = this.identity();
      const generation = this.vault.generation();

      await this.action.run(
        {
          authority: 'operation',
          purpose: 'vault_unlock_manage',
          targetId: credential.id,
          summary: $localize`:@@vaultPasskeyEnrollConfirm:Confirm your identity to let this passkey unlock your vault.`,
        },
        async (grantId) => {
          this.assertOwner(identity, generation);
          await this.prf.enroll(credential.id, grantId);
          this.assertOwner(identity, generation);
          this.notice.set(
            $localize`:@@vaultPasskeySaved:Passkey vault unlock saved. Keep your recovery key safely offline.`,
          );
          await this.refresh();
        },
      );
    });
  }

  protected async unlock(method: UnlockMethod): Promise<void> {
    await this.perform(() => this.prf.unlock(method.methodId));
  }

  protected async revoke(method: UnlockMethod): Promise<void> {
    await this.perform(async () => {
      const identity = this.identity();
      const generation = this.vault.generation();

      await this.action.run(
        {
          authority: 'operation',
          purpose: 'vault_unlock_manage',
          targetId: method.methodId,
          summary: $localize`:@@vaultPasskeyRevokeConfirm:Confirm your identity to revoke this passkey's vault unlock. Account sign-in is unaffected.`,
        },
        async (grantId) => {
          this.assertOwner(identity, generation);
          await this.prf.revoke(method, grantId);
          if (!this.destroyRef.destroyed && identity === this.identity()) {
            this.notice.set(
              $localize`:@@vaultPasskeyRevoked:Passkey vault unlock revoked. Previously downloaded keys cannot be recalled.`,
            );
            await this.refresh();
          }
        },
      );
    });
  }

  private cancel(): void {
    this.attempt++;
    this.prf.cancel();
    this.cancelled.next();
  }

  private current(attempt: number, identity: string): boolean {
    return !this.destroyRef.destroyed && attempt === this.attempt && identity === this.identity();
  }

  private assertOwner(identity: string | null, generation: number): void {
    if (
      !identity ||
      this.destroyRef.destroyed ||
      identity !== this.identity() ||
      generation !== this.vault.generation()
    )
      throw new Error('vault_locked');
  }

  private async perform(operation: () => Promise<void>): Promise<void> {
    if (this.busy() || this.confirming() || !this.enabled()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    const identity = this.identity();

    try {
      await operation();
    } catch {
      if (!this.destroyRef.destroyed && identity === this.identity())
        this.error.set(
          $localize`:@@vaultPasskeyError:Passkey vault unlock failed. Use a PRF-capable passkey, your browser PIN or your recovery key. No weaker fallback was used.`,
        );
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  private readonly loadAfterRender = afterNextRender(() => {
    void this.refresh();
  });

  private readonly clearDepartingOwner = effect((cleanup) => {
    this.identity();
    cleanup(() => {
      this.cancel();
      untracked(() => {
        this.methods.set([]);
        this.credentials.set([]);
        this.enabled.set(false);
        this.notice.set('');
        this.error.set('');
      });
    });
  });
}

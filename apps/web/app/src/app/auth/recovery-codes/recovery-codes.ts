import { Component, inject, signal } from '@angular/core';

import { Passkey } from '../../shared/auth/passkey';
import { SecurityAuth } from '../../shared/auth/security-auth';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';

@Component({
  imports: [AuthCard, AuthLayout],
  selector: 'app-recovery-codes',
  templateUrl: './recovery-codes.html',
  styleUrl: './recovery-codes.css',
})
export class RecoveryCodes {
  private readonly passkey = inject(Passkey);
  private readonly security = inject(SecurityAuth);
  readonly loading = signal(false);
  readonly codes = signal<string[]>([]);
  readonly error = signal('');

  protected async regenerate(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const grant = await this.security.startReauthentication('recovery_codes_regenerate');
      const authentication = await this.passkey.beginAuthentication();

      if (!authentication.challengeId || !authentication.options) throw new Error('Passkey options were not returned.');
      const credential = await this.passkey.getCredential(authentication.options);

      await this.passkey.completeAuthentication(authentication.challengeId, credential);
      await this.security.completeReauthentication({ grantId: grant.grantId, method: 'passkey' });
      this.codes.set(await this.security.regenerateRecoveryCodes(grant.grantId));
    } catch {
      this.error.set('Recovery codes could not be regenerated.');
    } finally {
      this.loading.set(false);
    }
  }
}

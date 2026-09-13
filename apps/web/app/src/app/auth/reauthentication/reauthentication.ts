import { Component, inject, signal } from '@angular/core';

import { Auth } from '../../shared/auth/auth';
import { Passkey } from '../../shared/auth/passkey';
import { SecurityAuth, type ReauthenticationPurpose } from '../../shared/auth/security-auth';
import { APP_URL } from '../../shared/constants/routes';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';

@Component({
  imports: [AuthCard, AuthLayout],
  selector: 'app-reauthentication',
  templateUrl: './reauthentication.html',
  styleUrl: './reauthentication.css',
})
export class Reauthentication {
  private readonly auth = inject(Auth);
  private readonly passkey = inject(Passkey);
  private readonly security = inject(SecurityAuth);

  readonly loading = signal(false);
  readonly confirmed = signal(false);
  readonly error = signal('');
  protected readonly purpose: ReauthenticationPurpose = 'password_change';

  protected async confirmIdentity(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');

    try {
      const grant = await this.security.startReauthentication(this.purpose);
      const begin = await this.passkey.beginAuthentication();

      if (!begin.challengeId || !begin.options) throw new Error('Passkey options were not returned.');
      const credential = await this.passkey.getCredential(begin.options);

      await this.passkey.completeAuthentication(begin.challengeId, credential);
      await this.security.completeReauthentication({ grantId: grant.grantId, method: 'passkey' });
      await this.auth.ensureSessionLoaded(true);
      this.confirmed.set(true);
    } catch (error) {
      this.error.set(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Passkey confirmation was cancelled.'
          : 'We could not confirm your passkey.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected readonly appUrl = APP_URL;
}

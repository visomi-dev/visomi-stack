import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';

import { Auth } from '../../shared/auth/auth';
import { GoogleIdentity } from '../../shared/auth/google-identity';
import { Passkey } from '../../shared/auth/passkey';
import { SecurityAuth } from '../../shared/auth/security-auth';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';

@Component({
  imports: [AuthCard, AuthLayout],
  selector: 'app-google-link',
  templateUrl: './google-link.html',
  styleUrl: './google-link.css',
})
export class GoogleLink {
  private readonly auth = inject(Auth);
  private readonly google = inject(GoogleIdentity);
  private readonly passkey = inject(Passkey);
  private readonly security = inject(SecurityAuth);
  private readonly button = viewChild<ElementRef<HTMLElement>>('googleButton');
  readonly loading = signal(false);
  readonly linked = signal(false);
  readonly error = signal('');

  protected async begin(): Promise<void> {
    if (this.loading() || this.linked()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const grant = await this.security.startReauthentication('google_link');
      const flow = await this.auth.startIdentityFlow();

      if (!flow.google?.enabled || !flow.google.clientId || !flow.nonce || !this.button())
        throw new Error('Google linking is not configured.');
      const authentication = await this.passkey.beginAuthentication();

      if (!authentication.challengeId || !authentication.options) throw new Error('Passkey options were not returned.');
      const credential = await this.passkey.getCredential(authentication.options);

      await this.passkey.completeAuthentication(authentication.challengeId, credential);
      await this.security.completeReauthentication({ grantId: grant.grantId, method: 'passkey' });
      await this.google.renderLinkButton(
        this.button()!.nativeElement,
        flow.google.clientId,
        grant.grantId,
        flow.nonce,
        () => this.linked.set(true),
      );
    } catch {
      this.error.set('Google linking could not be started.');
    } finally {
      this.loading.set(false);
    }
  }
}

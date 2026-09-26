import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';

import { Auth } from '../../shared/auth/auth';
import { GoogleIdentity } from '../../shared/auth/google-identity';
import { SecurityAction } from '../../shared/auth/security-action';
import { SecurityConfirmation } from '../../shared/auth/security-confirmation/security-confirmation';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';

@Component({
  imports: [AuthCard, AuthLayout, SecurityConfirmation],
  providers: [SecurityAction],
  selector: 'app-google-link',
  templateUrl: './google-link.html',
  styleUrl: './google-link.css',
})
export class GoogleLink {
  private readonly auth = inject(Auth);
  private readonly google = inject(GoogleIdentity);
  private readonly action = inject(SecurityAction);
  private readonly destroyRef = inject(DestroyRef);
  private attempt = 0;
  private disposed = false;
  private readonly button = viewChild<ElementRef<HTMLElement>>('googleButton');
  readonly loading = signal(false);
  readonly linking = signal(false);
  readonly ready = signal(false);
  readonly linked = signal(false);
  readonly error = signal('');

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.disposed = true;
      this.attempt += 1;
    });
  }

  protected async begin(): Promise<void> {
    if (this.loading() || this.ready() || this.linking() || this.linked()) return;
    const attempt = ++this.attempt;
    const active = () => !this.disposed && attempt === this.attempt && !this.linked();

    this.loading.set(true);
    this.error.set('');
    try {
      await this.action.run(
        {
          authority: 'operation',
          purpose: 'google_link',
          targetId: 'google',
          summary: $localize`:@@securityLinkGoogle:Confirm your identity before connecting your Google account.`,
        },
        async (grantId) => {
          const flow = await this.auth.startIdentityFlow();

          if (!flow.google?.enabled || !flow.google.clientId || !flow.nonce || !this.button())
            throw new Error('Google linking is not configured.');
          await this.google.renderLinkButton(
            this.button()!.nativeElement,
            flow.google.clientId,
            grantId,
            flow.nonce,
            () => {
              if (active()) {
                this.linking.set(false);
                this.linked.set(true);
              }
            },
            () => {
              if (active()) {
                this.linking.set(false);
                this.ready.set(false);
                this.attempt += 1;
                this.button()?.nativeElement.replaceChildren();
                this.error.set($localize`:@@securityGoogleLinkFailed:Google linking could not be started.`);
              }
            },
            active,
            () => this.linking.set(true),
          );
          if (active()) this.ready.set(true);
        },
      );
    } catch {
      this.error.set($localize`:@@securityGoogleLinkFailed:Google linking could not be started.`);
    } finally {
      this.loading.set(false);
    }
  }
}

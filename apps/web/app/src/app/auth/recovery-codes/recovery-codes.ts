import { Component, inject, signal } from '@angular/core';

import { SecurityAction } from '../../shared/auth/security-action';
import { SecurityConfirmation } from '../../shared/auth/security-confirmation/security-confirmation';
import { SecurityAuth } from '../../shared/auth/security-auth';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';

@Component({
  imports: [AuthCard, AuthLayout, SecurityConfirmation],
  providers: [SecurityAction],
  selector: 'app-recovery-codes',
  templateUrl: './recovery-codes.html',
  styleUrl: './recovery-codes.css',
})
export class RecoveryCodes {
  private readonly action = inject(SecurityAction);
  private readonly security = inject(SecurityAuth);
  readonly loading = signal(false);
  readonly codes = signal<string[]>([]);
  readonly error = signal('');

  protected async regenerate(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      await this.action.run(
        {
          authority: 'operation',
          purpose: 'recovery_codes_regenerate',
          targetId: 'recovery-codes',
          summary: $localize`:@@securityReplaceCodes:Confirm your identity to replace your recovery codes. Previous codes will stop working.`,
        },
        async (grantId) => {
          this.codes.set(await this.security.regenerateRecoveryCodes(grantId));
        },
      );
    } catch {
      this.error.set($localize`:@@securityRecoveryFailed:Recovery codes could not be regenerated.`);
    } finally {
      this.loading.set(false);
    }
  }
}

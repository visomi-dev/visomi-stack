import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Sessions as SessionApi } from '../../shared/auth/sessions';
import type { ActiveSession } from '../../shared/auth/sessions';
import { SecurityAction } from '../../shared/auth/security-action';
import { SecurityConfirmation } from '../../shared/auth/security-confirmation/security-confirmation';
import { Auth } from '../../shared/auth/auth';
import { SIGN_IN_PATH } from '../../shared/constants/routes';

@Component({
  selector: 'app-sessions',
  imports: [DatePipe, RouterLink, SecurityConfirmation],
  providers: [SecurityAction],
  templateUrl: './sessions.html',
  styleUrl: './sessions.css',
})
export class Sessions {
  private readonly api = inject(SessionApi);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  protected readonly action = inject(SecurityAction);
  protected readonly sessions = signal<ActiveSession[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly hasOthers = computed(() => this.sessions().some((session) => !session.current));

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.sessions.set(await this.api.list());
    } catch {
      this.error.set($localize`:@@sessionsLoadError:Sessions could not be loaded. Try again.`);
    } finally {
      this.loading.set(false);
    }
  }

  protected method(session: ActiveSession): string {
    switch (session.method) {
      case 'password':
        return $localize`:@@sessionsMethodPassword:Password`;
      case 'passkey':
        return $localize`:@@sessionsMethodPasskey:Passkey`;
      case 'google':
        return 'Google';
      default:
        return $localize`:@@sessionsMethodUnknown:Not recorded`;
    }
  }

  protected async signOut(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.signOut();
      await this.router.navigateByUrl(`/${SIGN_IN_PATH}`);
    } catch {
      this.error.set($localize`:@@sessionsRevokeError:Sessions could not be revoked. Try again.`);
    } finally {
      this.busy.set(false);
    }
  }

  protected async revoke(session?: ActiveSession): Promise<void> {
    if (this.busy() || session?.current) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await this.action.run(
        {
          authority: 'operation',
          purpose: 'sessions_revoke',
          targetId: session?.id ?? 'other-sessions',
          summary: session
            ? $localize`:@@sessionsConfirmOne:Sign out this session?`
            : $localize`:@@sessionsConfirmOthers:Sign out all other sessions? This session will stay signed in.`,
        },
        async (grantId) => {
          await this.api.revoke(grantId, session?.id);
          this.notice.set($localize`:@@sessionsRevoked:Session revocation completed.`);
          await this.load();
        },
      );
    } catch {
      this.error.set($localize`:@@sessionsRevokeError:Sessions could not be revoked. Try again.`);
    } finally {
      this.busy.set(false);
    }
  }
}

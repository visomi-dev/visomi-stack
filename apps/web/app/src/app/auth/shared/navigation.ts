import { Location } from '@angular/common';
import { Service, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Session } from '../session/session';
import type { Notified } from '../session/models';
import { destination, safeReturnTo } from '../session/navigation';

@Service()
export class AuthNavigation {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly session = inject(Session);

  readonly notificationFailed = signal(false);

  returnPath(): string | null {
    const value = this.router.parseUrl(this.router.url).queryParams['returnTo'];

    return safeReturnTo(typeof value === 'string' ? value : null, this.location.prepareExternalUrl('/'));
  }

  returnQuery(): { returnTo?: string } {
    const value = this.returnPath();

    return value ? { returnTo: value } : {};
  }

  async complete(result?: Notified): Promise<void> {
    this.notificationFailed.set(result?.notificationSent === false);

    await this.router.navigateByUrl(
      this.session.status() !== 'ready'
        ? '/auth/sign-in'
        : this.session.full()
          ? (this.returnPath() ?? '/home')
          : destination(this.session.snapshot()),
    );
  }
}

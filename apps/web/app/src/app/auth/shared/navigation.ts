import { Location } from '@angular/common';
import { Service, inject, signal } from '@angular/core';
import { Router, type UrlTree } from '@angular/router';

import { Session } from '../session/session';
import type { Notified } from '../session/models';
import { destination, safeReturnTo } from '../session/navigation';

@Service()
export class AuthNavigation {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly session = inject(Session);

  private readonly failedNotification = signal(false);

  readonly notificationFailed = this.failedNotification.asReadonly();

  clearNotification(): void {
    this.failedNotification.set(false);
  }

  returnPath(): string | null {
    const value = this.router.parseUrl(this.router.url).queryParams['returnTo'];

    return safeReturnTo(typeof value === 'string' ? value : null, this.location.prepareExternalUrl('/'));
  }

  returnQuery(): { returnTo?: string } {
    const value = this.returnPath();

    return value ? { returnTo: value } : {};
  }

  returnLink(): UrlTree {
    return this.router.parseUrl(this.returnPath() ?? '/security');
  }

  async complete(result?: Notified): Promise<void> {
    this.failedNotification.set(result?.notificationSent === false);

    await this.router.navigateByUrl(
      this.session.status() !== 'ready'
        ? '/auth/sign-in'
        : this.session.full()
          ? (this.returnPath() ?? '/home')
          : destination(this.session.snapshot()),
    );
  }
}

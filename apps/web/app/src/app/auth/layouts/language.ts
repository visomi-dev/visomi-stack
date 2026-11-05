import { Component, LOCALE_ID, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

import { Link } from '../../ui';

@Component({
  selector: 'app-auth-language',
  imports: [Link],
  templateUrl: './language.html',
})
export class AuthLanguage {
  private readonly router = inject(Router);
  readonly locale = inject(LOCALE_ID);

  // Compile-time locales use separate bundles, so switching language requires document navigation.
  readonly english = computed(() => '/app/en' + this.stablePath());
  readonly spanish = computed(() => '/app/es' + this.stablePath());

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  private stablePath(): string {
    const path = this.url().split(/[?#]/, 1)[0];
    const restarts: Record<string, string> = {
      '/auth/sign-in/verify': '/auth/sign-in/password',
      '/auth/reset-password': '/auth/forgot-password',
      '/auth/google/verify-email': '/auth/sign-in',
      '/auth/recovery/verify': '/auth/recovery',
    };

    if (path === '/security/devices/review') {
      const request = this.router.parseUrl(this.url()).queryParams['requestId'];

      if (typeof request === 'string' && /^[a-f0-9-]{36}$/.test(request)) {
        return path + '?requestId=' + encodeURIComponent(request);
      }
    }

    return restarts[path] ?? (path === '/' ? '/auth/sign-in' : path);
  }
}

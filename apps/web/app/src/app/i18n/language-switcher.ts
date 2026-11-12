import { Component, LOCALE_ID, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Link } from '../ui';
import { AuthNavigation } from '../auth/shared/navigation';

const authRestarts: Record<string, string> = Object.freeze({
  '/auth/sign-in/verify': '/auth/sign-in/password',
  '/auth/reset-password': '/auth/forgot-password',
  '/auth/google/verify-email': '/auth/sign-in',
  '/auth/recovery/verify': '/auth/recovery',
});

@Component({
  selector: 'app-language-switcher',
  imports: [Link],
  templateUrl: './language-switcher.html',
  host: { class: 'inline-flex shrink-0' },
})
export class LanguageSwitcher {
  private readonly router = inject(Router);
  private readonly navigation = inject(AuthNavigation);
  readonly locale = inject(LOCALE_ID);

  private readonly url = computed(() => {
    const url = this.router.lastSuccessfulNavigation()?.finalUrl;

    return url ? this.router.serializeUrl(url) : this.router.url;
  });
  private readonly localizedPath = computed(() => this.stablePath());
  // Compile-time locales use separate bundles, so switching language requires document navigation.
  readonly english = computed(() => '/app/en' + this.localizedPath());
  readonly spanish = computed(() => '/app/es' + this.localizedPath());

  readonly languages = [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' },
  ] as const;

  private stablePath(): string {
    const path = this.url().split(/[?#]/, 1)[0];

    if (path === '/security/devices/review') {
      const request = this.router.parseUrl(this.url()).queryParams['requestId'];

      if (typeof request === 'string' && /^[a-f0-9-]{36}$/.test(request)) {
        return path + '?requestId=' + encodeURIComponent(request);
      }

      return path;
    }

    if (path.startsWith('/auth/')) {
      const restart = authRestarts[path] ?? path;
      const queryParams = this.navigation.returnQuery();

      return this.router.serializeUrl(this.router.createUrlTree([restart], { queryParams }));
    }

    return this.url();
  }
}

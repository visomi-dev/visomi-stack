import { Component, LOCALE_ID, booleanAttribute, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

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
  host: { '[class]': "compact() ? 'contents' : ''" },
})
export class LanguageSwitcher {
  private readonly router = inject(Router);
  private readonly navigation = inject(AuthNavigation);
  readonly locale = inject(LOCALE_ID);

  readonly compact = input(false, { transform: booleanAttribute });
  readonly path = input<string>();

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly linkClasses = computed(() =>
    this.compact() ? 'inline-flex min-h-11 min-w-11 items-center px-2' : 'inline-flex min-h-11 items-center text-sm',
  );
  private readonly localizedPath = computed(() => this.path() ?? this.stablePath());
  // Compile-time locales use separate bundles, so switching language requires document navigation.
  readonly english = computed(() => '/app/en' + this.localizedPath());
  readonly spanish = computed(() => '/app/es' + this.localizedPath());

  private stablePath(): string {
    const path = this.url().split(/[?#]/, 1)[0];

    if (path === '/security/devices/review') {
      const request = this.router.parseUrl(this.url()).queryParams['requestId'];

      if (typeof request === 'string' && /^[a-f0-9-]{36}$/.test(request)) {
        return path + '?requestId=' + encodeURIComponent(request);
      }
    }

    if (path.startsWith('/auth/')) {
      const restart = authRestarts[path] ?? path;
      const queryParams = this.navigation.returnQuery();

      return this.router.serializeUrl(this.router.createUrlTree([restart], { queryParams }));
    }

    return path;
  }
}

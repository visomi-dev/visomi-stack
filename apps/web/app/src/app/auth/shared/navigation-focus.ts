import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injector, Service, afterNextRender, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

@Service()
export class NavigationFocus {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      let initialNavigationCompleted = this.router.navigated;
      let previousPath = this.router.url.split('#')[0];

      this.router.events
        .pipe(
          filter((event) => event instanceof NavigationEnd),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((event) => {
          const path = event.urlAfterRedirects.split('#')[0];
          const changedPage = path !== previousPath;

          previousPath = path;

          if (!initialNavigationCompleted) {
            initialNavigationCompleted = true;

            return;
          }

          if (!changedPage) {
            return;
          }

          afterNextRender(
            () => {
              const heading = this.document.querySelector<HTMLElement>('main h1');

              if (heading) {
                heading.setAttribute('tabindex', '-1');
                heading.setAttribute('data-navigation-focus', '');
                heading.focus();
              }
            },
            { injector: this.injector },
          );
        });
    });
  }
}

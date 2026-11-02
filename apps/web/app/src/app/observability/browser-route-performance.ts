import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, PLATFORM_ID, Service, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationStart,
  Router,
} from '@angular/router';

import { BROWSER_ERROR_REPORTER } from './browser-telemetry';

@Service()
export class BrowserRoutePerformance {
  constructor() {
    const reporter = inject(BROWSER_ERROR_REPORTER, { optional: true });

    if (!isPlatformBrowser(inject(PLATFORM_ID)) || !reporter) {
      return;
    }

    const router = inject(Router);
    const lifetime = inject(DestroyRef);

    void reporter.performanceReady.then((enabled) => {
      if (!enabled || lifetime.destroyed) {
        return;
      }

      let initialNavigationCompleted = router.navigated;
      // Keep only the active operation's internal ID and monotonic start time.
      let pending: { id: number; started: number } | undefined;

      router.events.pipe(takeUntilDestroyed(lifetime)).subscribe((event) => {
        if (event instanceof NavigationStart) {
          pending = initialNavigationCompleted ? { id: event.id, started: performance.now() } : undefined;

          return;
        }

        if (event instanceof NavigationEnd) {
          initialNavigationCompleted = true;
        }

        if (
          !(
            event instanceof NavigationEnd ||
            event instanceof NavigationCancel ||
            event instanceof NavigationError ||
            event instanceof NavigationSkipped
          ) ||
          pending?.id !== event.id
        ) {
          return;
        }

        const duration = performance.now() - pending.started;

        pending = undefined;

        if (!(event instanceof NavigationSkipped)) {
          reporter.routeTransition(
            event instanceof NavigationEnd
              ? 'route_completed'
              : event instanceof NavigationCancel
                ? 'route_cancelled'
                : 'route_failed',
            duration,
          );
        }
      });
    });
  }
}

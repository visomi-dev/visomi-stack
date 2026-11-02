import { Component, PLATFORM_ID, provideEnvironmentInitializer, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserRoutePerformance } from './browser-route-performance';
import { BROWSER_ERROR_REPORTER } from './browser-telemetry';

@Component({ template: '' })
class Page {}

const marker = 'SYNTHETIC_PRIVATE_ROUTE_DATA';

function fixture(enabled = true, platform = 'browser') {
  const routeTransition = vi.fn();
  let enterSlow!: () => void;
  const slowEntered = new Promise<void>((resolve) => {
    enterSlow = resolve;
  });
  const reporter = { performanceReady: Promise.resolve(enabled), routeTransition };

  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Page },
        { path: 'customer/:id', component: Page },
        { path: 'blocked', component: Page, canActivate: [() => false] },
        {
          path: 'slow',
          component: Page,
          canActivate: [
            () => {
              enterSlow();

              return new Promise<boolean>(() => undefined);
            },
          ],
        },
        {
          path: 'failure',
          component: Page,
          resolve: {
            value: () => {
              throw new Error(marker);
            },
          },
        },
        { path: 'redirect', redirectTo: '/customer/redirected', pathMatch: 'full' },
      ]),
      { provide: PLATFORM_ID, useValue: platform },
      { provide: BROWSER_ERROR_REPORTER, useValue: reporter },
      provideEnvironmentInitializer(() => {
        inject(BrowserRoutePerformance);
      }),
    ],
  });

  return { routeTransition, slowEntered };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('Angular route transition performance', () => {
  it('measures real router completions, cancellations and failures without retaining route data', async () => {
    const f = fixture();
    const harness = await RouterTestingHarness.create('/');

    expect(f.routeTransition).not.toHaveBeenCalled();

    await harness.navigateByUrl(`/customer/${marker}?secret=${marker}#${marker}`);

    await harness.navigateByUrl('/blocked');

    await expect(harness.navigateByUrl('/failure')).rejects.toThrow(marker);

    await harness.navigateByUrl('/redirect');

    expect(f.routeTransition.mock.calls.map(([name]) => name)).toEqual([
      'route_completed',
      'route_cancelled',
      'route_failed',
      'route_completed',
    ]);
    for (const [, duration] of f.routeTransition.mock.calls) {
      expect(Number.isFinite(duration)).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(0);
    }
    expect(JSON.stringify(f.routeTransition.mock.calls)).not.toContain(marker);

    // Same-URL requests are skipped rather than counted as transitions.
    await harness.navigateByUrl('/customer/redirected');

    expect(f.routeTransition).toHaveBeenCalledTimes(4);
  });

  it.each([
    [false, 'browser'],
    [true, 'server'],
  ] as const)('does not capture when enabled=%s on %s', async (enabled, platform) => {
    const f = fixture(enabled, platform);
    const harness = await RouterTestingHarness.create('/');

    await harness.navigateByUrl('/customer/synthetic');

    expect(f.routeTransition).not.toHaveBeenCalled();
  });

  it('removes its subscription when the owning injector is destroyed', async () => {
    const f = fixture();

    await RouterTestingHarness.create('/');

    const router = TestBed.inject(Router);

    await router.navigateByUrl('/customer/synthetic');

    expect(f.routeTransition).toHaveBeenCalledOnce();
    TestBed.resetTestingModule();

    await router.navigateByUrl('/customer/after-destroy');

    expect(f.routeTransition).toHaveBeenCalledOnce();
  });

  it('finishes a superseded attempt and measures the replacement as its own operation', async () => {
    const f = fixture();
    const harness = await RouterTestingHarness.create('/');
    const first = harness.navigateByUrl('/slow');

    await f.slowEntered;

    await TestBed.inject(Router).navigateByUrl('/customer/replacement');

    await first;

    expect(f.routeTransition.mock.calls.map(([name]) => name)).toEqual(['route_cancelled', 'route_completed']);
  });
});

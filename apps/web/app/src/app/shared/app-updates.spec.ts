import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import type { VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';

import { AppUpdates } from './app-updates';

describe('AppUpdates', () => {
  function fixture(enabled = true, browser = true) {
    const events = new Subject<VersionEvent>();
    const checkForUpdate = vi.fn().mockResolvedValue(false);
    const reload = vi.fn();
    const host = new EventTarget();
    const document = Object.assign(new EventTarget(), {
      visibilityState: 'visible',
      defaultView: browser ? Object.assign(host, { setInterval, clearInterval, location: { reload } }) : null,
    });

    TestBed.configureTestingModule({
      providers: [
        AppUpdates,
        { provide: DOCUMENT, useValue: document },
        { provide: SwUpdate, useValue: { isEnabled: enabled, versionUpdates: events, checkForUpdate } },
      ],
    });

    return { service: TestBed.inject(AppUpdates), events, checkForUpdate, reload, document, host };
  }

  afterEach(() => vi.useRealTimers());

  it('offers an update without automatically reloading or deleting storage', () => {
    const value = fixture();
    const stop = value.service.start();

    value.events.next({ type: 'VERSION_DETECTED', version: { hash: 'next' } });
    value.service.reload();
    expect(value.reload).not.toHaveBeenCalled();
    value.events.next({ type: 'VERSION_READY', currentVersion: { hash: 'old' }, latestVersion: { hash: 'next' } });
    expect(value.service.ready()).toBe(true);
    expect(value.reload).not.toHaveBeenCalled();
    value.service.reload();
    expect(value.reload).toHaveBeenCalledOnce();
    stop();
  });

  it.each([
    [false, true],
    [true, false],
  ])('is inert for disabled workers or SSR (%s, %s)', (enabled, browser) => {
    const value = fixture(enabled, browser);
    const stop = value.service.start();

    expect(value.checkForUpdate).not.toHaveBeenCalled();
    stop();
  });

  it('retries offline checks only while visible and releases timers and listeners', async () => {
    vi.useFakeTimers();
    const value = fixture();

    value.checkForUpdate.mockRejectedValueOnce(new Error('offline'));
    const stop = value.service.start();

    await Promise.resolve();
    value.document.visibilityState = 'hidden';
    value.document.dispatchEvent(new Event('visibilitychange'));
    expect(value.checkForUpdate).toHaveBeenCalledTimes(1);
    value.document.visibilityState = 'visible';
    value.host.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(value.checkForUpdate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(value.checkForUpdate).toHaveBeenCalledTimes(3);
    stop();
    value.host.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(value.checkForUpdate).toHaveBeenCalledTimes(3);
  });
});

import { APP_BASE_HREF } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Session } from '../session/session';
import { AuthNavigation } from '../shared/navigation';

import { DeviceApproval } from './request';
import { Devices, type DeviceStatus } from './devices';

describe('device review links', () => {
  it.each(['en', 'es'])('uses the localized router base for %s without sharing the pairing code', async (locale) => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: APP_BASE_HREF, useValue: `/app/${locale}/` },
        { provide: Session, useValue: {} },
        { provide: AuthNavigation, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(DeviceApproval);
    const pending = {
      requestId: '9aef148d-8d52-4e4d-aace-18eabaeec543',
      userCode: '123456',
      expiresAt: '2099-01-01T00:00:00Z',
    };

    expect(fixture.componentInstance.reviewRoute()).toBeNull();
    expect(fixture.componentInstance.reviewLink()).toBe('');
    fixture.componentInstance.request.set(pending);

    await fixture.whenStable();

    const anchor = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a[target="_blank"]')!;
    const shared = new URL(anchor.textContent!.trim());

    expect(anchor.getAttribute('href')).toBe(`/app/${locale}/security/devices/review?requestId=${pending.requestId}`);
    expect(anchor.href).toBe(shared.href);
    expect(shared.pathname).toBe(`/app/${locale}/security/devices/review`);
    expect([...shared.searchParams.entries()]).toEqual([['requestId', pending.requestId]]);
    expect(shared.href).not.toContain(pending.userCode);
  });
});

describe('device status polling', () => {
  const firstId = '9aef148d-8d52-4e4d-aace-18eabaeec543';
  const secondId = '6bdc2d63-7da7-4ac9-856f-4732a60ea10a';
  const expiresAt = '2099-01-01T00:00:00Z';
  const polls: { id: string; signal: AbortSignal; resolve: (value: DeviceStatus) => void }[] = [];
  const request = vi.fn();
  const cancel = vi.fn();
  const status = vi.fn(
    (id: string, signal: AbortSignal) =>
      new Promise<DeviceStatus>((resolve) => {
        polls.push({ id, signal, resolve });
      }),
  );

  beforeEach(() => {
    polls.length = 0;
    status.mockClear();
    request.mockReset().mockResolvedValueOnce({ requestId: firstId, userCode: '001234', expiresAt });
    request.mockResolvedValueOnce({ requestId: secondId, userCode: '005678', expiresAt });
    cancel.mockReset().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Session, useValue: { full: () => false } },
        { provide: AuthNavigation, useValue: {} },
      ],
    });
    TestBed.overrideComponent(DeviceApproval, {
      set: { providers: [{ provide: Devices, useValue: { request, status, cancel } }] },
    });
  });

  it('starts polling a replacement request and ignores the cancelled poll even when it resolves late', async () => {
    const fixture = TestBed.createComponent(DeviceApproval);
    const page = fixture.componentInstance;

    await fixture.whenStable();

    page.start('demo@example.test');

    await fixture.whenStable();

    expect(polls).toHaveLength(1);
    page.cancel();

    await fixture.whenStable();

    expect(polls[0].signal.aborted).toBe(true);
    page.restart();
    page.start('demo@example.test');

    await fixture.whenStable();

    expect(polls).toHaveLength(2);
    expect(polls[1].id).toBe(secondId);
    polls[0].resolve({ requestId: firstId, status: 'approved', expiresAt });

    await fixture.whenStable();

    expect(page.status()).toBe('pending');

    await page.poll();

    expect(polls).toHaveLength(2);
    polls[1].resolve({ requestId: secondId, status: 'approved', expiresAt });

    await fixture.whenStable();

    expect(page.status()).toBe('approved');
  });

  it('expires an approved request on the next scheduled check and lets the user restart', async () => {
    const fixture = TestBed.createComponent(DeviceApproval);
    const page = fixture.componentInstance;

    await fixture.whenStable();

    page.start('demo@example.test');

    await fixture.whenStable();

    const timers = vi.spyOn(globalThis, 'setTimeout');
    const clock = vi.spyOn(Date, 'now');

    try {
      polls[0].resolve({ requestId: firstId, status: 'approved', expiresAt });

      await fixture.whenStable();

      expect(page.status()).toBe('approved');
      const check = timers.mock.calls.find(([, delay]) => delay === 5000)?.[0];

      expect(check).toBeTypeOf('function');
      clock.mockReturnValue(Date.parse(expiresAt) + 1);
      (check as () => void)();

      await fixture.whenStable();

      expect(page.status()).toBe('expired');
      expect(status).toHaveBeenCalledTimes(1);
      const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
      const restart = buttons.find((button) => button.textContent?.trim() === 'Start again');

      expect(restart).toBeDefined();
      expect(buttons.some((button) => button.textContent?.trim() === 'Continue recovery')).toBe(false);
      restart!.click();
      clock.mockRestore();

      await fixture.whenStable();

      expect(page.request()).toBeNull();
      page.start('demo@example.test');

      await fixture.whenStable();

      expect(polls).toHaveLength(2);
      expect(polls[1].id).toBe(secondId);
    } finally {
      clock.mockRestore();
      timers.mockRestore();
      fixture.destroy();
    }
  });

  it('aborts a pending status request when the page is destroyed', async () => {
    const fixture = TestBed.createComponent(DeviceApproval);
    const page = fixture.componentInstance;

    await fixture.whenStable();

    page.start('demo@example.test');

    await fixture.whenStable();

    fixture.destroy();
    expect(polls[0].signal.aborted).toBe(true);
    polls[0].resolve({ requestId: firstId, status: 'approved', expiresAt });

    await Promise.resolve();

    expect(page.status()).toBe('pending');
    expect(page.action.error()).toBe('');
  });

  it('waits for the page to become visible before starting a status request', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    try {
      const fixture = TestBed.createComponent(DeviceApproval);
      const page = fixture.componentInstance;

      await fixture.whenStable();

      page.start('demo@example.test');

      await fixture.whenStable();

      expect(status).not.toHaveBeenCalled();
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));

      await fixture.whenStable();

      expect(polls).toHaveLength(1);
      polls[0].resolve({ requestId: firstId, status: 'denied', expiresAt });

      await fixture.whenStable();

      expect(page.status()).toBe('denied');
    } finally {
      visibility.mockRestore();
    }
  });
});

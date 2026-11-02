import { APP_BASE_HREF } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Session } from '../session/session';
import { AuthNavigation } from '../shared/navigation';

import { DeviceApproval } from './request';

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

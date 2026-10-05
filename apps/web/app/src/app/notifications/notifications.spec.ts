import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LOCALE_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';

import { Auth } from '../shared/auth/auth';
import type { AuthUser } from '../shared/auth/auth.models';
import { Realtime } from '../shared/realtime/realtime';

import { Notifications } from './notifications';

const id = 'b8a11261-af37-4026-99e2-54cf982a96a1';
const notification = { id, kind: 'service', read: false, createdAt: '2026-10-03T12:00:00Z' };

describe('notification inbox', () => {
  let fixture: ComponentFixture<Notifications>;
  let http: HttpTestingController;
  const authenticated = signal(true);
  const user = signal<AuthUser | null>(null);
  const connected = signal(false);
  const unwatch = vi.fn();
  const watchNotifications = vi.fn((_callback: () => void) => unwatch);

  beforeEach(async () => {
    authenticated.set(true);
    connected.set(false);
    watchNotifications.mockClear();
    unwatch.mockClear();
    user.set({ id: 'user', accountId: 'account', email: 'person@example.test', emailVerifiedAt: null, role: 'owner' });
    await TestBed.configureTestingModule({
      imports: [Notifications],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LOCALE_ID, useValue: 'es' },
        { provide: Auth, useValue: { isAuthenticated: authenticated, user } },
        { provide: Realtime, useValue: { connected, watchNotifications } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Notifications);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      fixture.destroy();
      TestBed.resetTestingModule();
    }
  });

  async function load(notifications = [notification], servicePush = false): Promise<void> {
    http.expectOne('/api/notifications').flush({ data: { notifications, servicePush, pushAvailable: false } });
    await fixture.whenStable();
  }

  function button(name: string): HTMLButtonElement {
    const found = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === name,
    );

    if (!found) throw new Error(`Missing button: ${name}`);

    return found;
  }

  it('renders generic activity, locale-aware time, read state and explicit push availability', async () => {
    await load();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('h1')?.textContent).toContain('Notifications');
    expect(root.querySelector('time')?.textContent).toMatch(/oct/i);
    expect(root.textContent).toContain('Account activity completed');
    expect(root.textContent).toContain('Device push notifications are not available yet');
    button('Mark as read').click();
    fixture.detectChanges();
    const mutation = http.expectOne(`/api/notifications/${id}/read`);

    expect(mutation.request.method).toBe('POST');
    expect(button('Mark as read').disabled).toBe(true);
    mutation.flush(null);
    TestBed.tick();
    await load([{ ...notification, read: true }]);
    expect(button('Mark as read').disabled).toBe(true);
  });

  it('offers a retry after load failure and a bounded empty state', async () => {
    http.expectOne('/api/notifications').flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('[role=alert]')?.textContent).toContain(
      'could not be loaded',
    );
    button('Refresh').click();
    TestBed.tick();
    await load([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('all caught up');
  });

  it('clears old-account content and cancels pending read and feed requests on identity change or destruction', async () => {
    await load();
    button('Mark as read').click();
    const mutation = http.expectOne(`/api/notifications/${id}/read`);

    user.set({ ...user()!, accountId: 'other' });
    TestBed.tick();
    expect(mutation.cancelled).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Account activity completed');
    const pending = http.expectOne('/api/notifications');

    authenticated.set(false);
    user.set(null);
    TestBed.tick();
    expect(pending.cancelled).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Account activity completed');
    authenticated.set(true);
    user.set({ id: 'next', accountId: 'next', email: 'next@example.test', emailVerifiedAt: null, role: 'owner' });
    TestBed.tick();
    const departing = http.expectOne('/api/notifications');

    fixture.destroy();
    expect(departing.cancelled).toBe(true);
  });

  it('reports read failure without hiding the inbox and rejects malformed server content', async () => {
    await load();
    button('Mark as read').click();
    http.expectOne(`/api/notifications/${id}/read`).flush({}, { status: 500, statusText: 'Unavailable' });
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('[role=alert]')?.textContent).toContain(
      'could not be updated',
    );
    button('Refresh').click();
    TestBed.tick();
    http.expectOne('/api/notifications').flush({
      data: {
        notifications: [{ ...notification, plaintext: 'secret-payload-must-not-render' }],
        servicePush: false,
        pushAvailable: false,
      },
    });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('secret-payload-must-not-render');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('could not be loaded');
  });

  it('reloads on a live invalidation and drops departing-account callbacks and reconnect watches', async () => {
    await load();
    connected.set(true);
    TestBed.tick();
    const invalidate = watchNotifications.mock.calls[0][0];

    invalidate();
    TestBed.tick();
    await load([{ ...notification, read: true }]);
    connected.set(false);
    TestBed.tick();
    expect(unwatch).toHaveBeenCalledTimes(1);
    connected.set(true);
    TestBed.tick();
    expect(watchNotifications).toHaveBeenCalledTimes(2);
    user.set({ ...user()!, accountId: 'other' });
    TestBed.tick();
    await load([]);
    invalidate();
    TestBed.tick();
    http.expectNone('/api/notifications');
    authenticated.set(false);
    TestBed.tick();
    expect(unwatch).toHaveBeenCalledTimes(3);
  });

  function preference(): HTMLInputElement {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#notifications-service-push')!;
  }

  it('uses an associated label and saves only the explicit preference with Signal Forms submission', async () => {
    await load([], true);
    expect(preference().checked).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('label[for=notifications-service-push]'),
    ).not.toBeNull();
    preference().click();
    button('Save preferences').click();
    await fixture.whenStable();
    const save = http.expectOne('/api/notifications/preferences');

    expect(save.request.body).toEqual({ servicePush: false });
    expect(save.request.method).toBe('POST');
    expect(preference().disabled).toBe(true);
    expect(button('Save preferences').disabled).toBe(true);
    save.flush(null);
    await fixture.whenStable();
    await expect.poll(() => preference().disabled).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Delivery preferences saved.');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Device push notifications are not available yet',
    );
  });

  it('retains a failed preference choice for retry and does not report false success', async () => {
    await load([]);
    preference().click();
    button('Save preferences').click();
    await fixture.whenStable();
    http.expectOne('/api/notifications/preferences').flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(preference().checked).toBe(true);
    await expect.poll(() => button('Save preferences').disabled).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('could not be saved');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Delivery preferences saved.');
    button('Save preferences').click();
    await fixture.whenStable();
    http.expectOne('/api/notifications/preferences').flush(null);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('could not be saved');
  });

  it('cancels a pending preference save and resets its form when the account changes', async () => {
    await load([], true);
    button('Save preferences').click();
    await fixture.whenStable();
    const save = http.expectOne('/api/notifications/preferences');

    user.set({ ...user()!, accountId: 'other' });
    TestBed.tick();
    expect(save.cancelled).toBe(true);
    await load([], false);
    expect(preference().checked).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Delivery preferences saved.');
    button('Save preferences').click();
    await fixture.whenStable();
    const departing = http.expectOne('/api/notifications/preferences');

    fixture.destroy();
    expect(departing.cancelled).toBe(true);
  });
});

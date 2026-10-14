import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { SwPush } from '@angular/service-worker';
import { of } from 'rxjs';

import { Auth } from '../shared/auth/auth';
import type { AuthUser } from '../shared/auth/auth.models';

import { DevicePush } from './device-push';

describe('explicit session-bound device push UI', () => {
  let fixture: ComponentFixture<DevicePush>;
  let http: HttpTestingController;
  const authenticated = signal(true);
  const owner = signal<AuthUser | null>(null);
  const unsubscribe = vi.fn(async () => true);
  const subscription = {
    toJSON: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      expirationTime: null,
      keys: { p256dh: 'public-browser-key', auth: 'private-browser-auth' },
    }),
    unsubscribe,
  };
  const requestSubscription = vi.fn(async () => subscription);
  const push = { isEnabled: true, subscription: of<unknown>(null), requestSubscription };

  beforeEach(async () => {
    authenticated.set(true);
    owner.set({ id: 'user', accountId: 'account', email: 'person@example.test', emailVerifiedAt: null, role: 'owner' });
    unsubscribe.mockReset().mockResolvedValue(true);
    requestSubscription.mockReset().mockResolvedValue(subscription);
    push.subscription = of(null);
    push.isEnabled = true;
    await TestBed.configureTestingModule({
      imports: [DevicePush],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SwPush, useValue: push },
        { provide: Auth, useValue: { user: owner, isAuthenticated: authenticated } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DevicePush);
    http = TestBed.inject(HttpTestingController);
    TestBed.tick();
  });
  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  async function load(registered = false, available = true): Promise<void> {
    http
      .expectOne('/api/notifications/subscriptions')
      .flush({ data: { available, publicKey: available ? 'public-vapid-key' : null, registered } });
    await fixture.whenStable();
  }
  function click(name: string): void {
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')];

    buttons.find((button) => button.textContent?.trim() === name)!.click();
  }

  it('does not prompt on mount and submits only vendor/key fields after explicit consent', async () => {
    await load();
    expect(requestSubscription).not.toHaveBeenCalled();
    click('Enable device alerts');
    await fixture.whenStable();
    const request = http.expectOne('/api/notifications/subscriptions');

    expect(requestSubscription).toHaveBeenCalledWith({ serverPublicKey: 'public-vapid-key' });
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: subscription.toJSON().keys,
    });
    request.flush(null);
    await Promise.resolve();
    TestBed.tick();
    await load(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('registered for your current session');
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('cleans only a newly created device on registration failure and keeps a retryable error', async () => {
    await load();
    click('Enable device alerts');
    await fixture.whenStable();
    http.expectOne('/api/notifications/subscriptions').flush({}, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    await expect.poll(() => unsubscribe.mock.calls.length).toBe(1);
    await expect.poll(() => (fixture.nativeElement as HTMLElement).textContent).toContain('could not be updated');
  });

  it('does not delete an existing browser registration after a foreign endpoint conflict', async () => {
    push.subscription = of(subscription);
    await load();
    click('Enable device alerts');
    await fixture.whenStable();
    http.expectOne('/api/notifications/subscriptions').flush({}, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    expect(requestSubscription).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('drops a late permission result after route destruction without posting or retaining its new device', async () => {
    let resolve: (value: typeof subscription) => void = () => undefined;
    const pending = new Promise<typeof subscription>((done) => {
      resolve = done;
    });

    requestSubscription.mockReturnValue(pending);
    await load();
    click('Enable device alerts');
    await fixture.whenStable();
    fixture.destroy();
    resolve(subscription);
    await expect.poll(() => unsubscribe.mock.calls.length).toBe(1);
    http.expectNone('/api/notifications/subscriptions');
  });

  it('cancels pending enrollment and clears new local state on account change', async () => {
    await load();
    click('Enable device alerts');
    await fixture.whenStable();
    const request = http.expectOne('/api/notifications/subscriptions');

    owner.set({ ...owner()!, accountId: 'other' });
    TestBed.tick();
    expect(request.cancelled).toBe(true);
    await load();
    await expect.poll(() => unsubscribe.mock.calls.length).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('could not be updated');
  });

  it('does not attach a late permission result to a logged-out identity whose user signal is retained', async () => {
    let resolve: (value: typeof subscription) => void = () => undefined;
    const pending = new Promise<typeof subscription>((done) => {
      resolve = done;
    });

    requestSubscription.mockReturnValue(pending);
    await load();
    click('Enable device alerts');
    await fixture.whenStable();
    authenticated.set(false);
    TestBed.tick();
    resolve(subscription);
    await expect.poll(() => unsubscribe.mock.calls.length).toBe(1);
    http.expectNone('/api/notifications/subscriptions');
  });

  it('revokes server authority before local unsubscription and refreshes session-scoped status', async () => {
    push.subscription = of(subscription);
    await load(true);
    click('Remove device alerts');
    await fixture.whenStable();
    const request = http.expectOne('/api/notifications/subscriptions');

    expect(request.request.method).toBe('DELETE');
    expect(unsubscribe).not.toHaveBeenCalled();
    request.flush(null);
    await Promise.resolve();
    await Promise.resolve();
    TestBed.tick();
    await expect.poll(() => (fixture.nativeElement as HTMLElement).textContent).toContain('Checking device alerts');
    await load();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

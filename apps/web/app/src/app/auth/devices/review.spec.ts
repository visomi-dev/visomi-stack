import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { Action } from '../shared/action';
import { Session } from '../session/session';

import { Devices, type DeviceStatus } from './devices';
import { DeviceReview } from './review';

const firstId = '9aef148d-8d52-4e4d-aace-18eabaeec543';
const secondId = '6bdc2d63-7da7-4ac9-856f-4732a60ea10a';
const reviews: { id: string; signal: AbortSignal; resolve: (status: DeviceStatus) => void }[] = [];
const review = vi.fn(
  (id: string, signal: AbortSignal) =>
    new Promise<DeviceStatus>((resolve) => {
      reviews.push({ id, signal, resolve });
    }),
);
const decide = vi.fn();

beforeEach(() => {
  reviews.length = 0;
  review.mockClear();
  decide.mockReset().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'security/devices/review', component: DeviceReview }]),
      { provide: Session, useValue: { full: () => true } },
    ],
  });
  TestBed.overrideComponent(DeviceReview, {
    set: { providers: [Action, { provide: Devices, useValue: { review, decide } }] },
  });
});

it('cancels stale reviews and clears pairing codes when Angular reuses the page for another request', async () => {
  const harness = await RouterTestingHarness.create();
  const page = await harness.navigateByUrl(`/security/devices/review?requestId=${firstId}`, DeviceReview);

  page.model.set({ code: '001234' });
  page.fields().markAsTouched();
  const reused = await harness.navigateByUrl(`/security/devices/review?requestId=${secondId}`, DeviceReview);

  expect(reused).toBe(page);
  expect(reviews[0].signal.aborted).toBe(true);
  expect(page.requestId()).toBe(secondId);
  expect(page.model().code).toBe('');
  expect(page.fields().touched()).toBe(false);
  expect(page.status()).toBeNull();
  reviews[0].resolve({ requestId: firstId, status: 'approved', expiresAt: '2099-01-01T00:00:00Z' });

  await harness.fixture.whenStable();

  expect(page.status()).toBeNull();
  expect(page.action.busy()).toBe(true);
  reviews[1].resolve({ requestId: secondId, status: 'pending', expiresAt: '2099-01-01T00:00:00Z' });

  await harness.fixture.whenStable();

  expect(page.status()).toBe('pending');

  await vi.waitFor(() => expect(page.action.busy()).toBe(false));

  await harness.fixture.whenStable();

  page.model.set({ code: '001234' });

  await harness.fixture.whenStable();

  page.decide(new Event('submit'), true);

  await harness.fixture.whenStable();

  expect(decide).toHaveBeenCalledExactlyOnceWith(secondId, '001234', true, reviews[1].signal);
  expect(page.status()).toBe('approved');
});

it('ignores an approval result after the review link changes and cancels on destruction', async () => {
  let finishApproval: () => void = () => undefined;

  decide.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishApproval = resolve;
      }),
  );
  const harness = await RouterTestingHarness.create();
  const page = await harness.navigateByUrl(`/security/devices/review?requestId=${firstId}`, DeviceReview);

  reviews[0].resolve({ requestId: firstId, status: 'pending', expiresAt: '2099-01-01T00:00:00Z' });

  await harness.fixture.whenStable();

  page.model.set({ code: '001234' });

  await harness.fixture.whenStable();

  page.decide(new Event('submit'), true);

  await harness.navigateByUrl(`/security/devices/review?requestId=${secondId}`, DeviceReview);

  finishApproval();

  await harness.fixture.whenStable();

  expect(page.status()).toBeNull();
  expect(page.action.busy()).toBe(true);
  expect(page.action.error()).toBe('');
  harness.fixture.destroy();
  expect(reviews[1].signal.aborted).toBe(true);
});

it('rejects an invalid request ID without reviewing or submitting', async () => {
  const harness = await RouterTestingHarness.create();
  const page = await harness.navigateByUrl('/security/devices/review?requestId=invalid', DeviceReview);

  page.decide(new Event('submit'), true);
  expect(review).not.toHaveBeenCalled();
  expect(decide).not.toHaveBeenCalled();
  expect(harness.routeNativeElement?.textContent).toContain('Open the review link');
});

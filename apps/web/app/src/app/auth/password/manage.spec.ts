import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Action } from '../shared/action';
import { Session } from '../session/session';
import { Methods } from '../session/methods';

import { ManagePassword } from './manage';
import { Passwords } from './passwords';

const secret = 'Synthetic pending password 42!';
const save = vi.fn();
const user = signal({ id: 'synthetic-owner' });
const full = signal(true);
const cancellation = signal(new AbortController().signal);

beforeEach(() => {
  save.mockReset().mockResolvedValue({ notificationSent: true });
  user.set({ id: 'synthetic-owner' });
  full.set(true);
  cancellation.set(new AbortController().signal);

  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Session, useValue: { user, full, cancellation } }],
  });

  TestBed.overrideComponent(ManagePassword, {
    set: {
      template: '',
      providers: [
        Action,
        { provide: Passwords, useValue: { save } },
        { provide: Methods, useValue: { list: async () => ({ password: false }) } },
      ],
    },
  });
});

async function pending() {
  const fixture = TestBed.createComponent(ManagePassword);
  const page = fixture.componentInstance;

  await fixture.whenStable();

  save.mockRejectedValueOnce(new HttpErrorResponse({ status: 401, error: { error: 'reauthentication_required' } }));
  page.model.set({ password: secret });
  page.save(new Event('submit'));

  await fixture.whenStable();

  return { fixture, page };
}

it('retains the submitted password in its owner and saves it once proof succeeds without navigating', async () => {
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
  const { fixture, page } = await pending();

  expect(page.phase()).toBe('verify');
  expect(page.model().password).toBe(secret);
  expect(navigate).not.toHaveBeenCalled();
  page.verified();
  expect(page.phase()).toBe('saving');
  page.verified();

  await fixture.whenStable();

  expect(save.mock.calls).toEqual([
    [secret, false],
    [secret, false],
  ]);

  expect(page.model().password).toBe('');
  expect(page.phase()).toBe('saved');
  expect(page.exists()).toBe(true);
  expect(page.action.notice()).toBe('');
  page.verified();

  await fixture.whenStable();

  expect(save).toHaveBeenCalledTimes(2);
});

it('discards a cancelled password change and ignores late verification', async () => {
  const { fixture, page } = await pending();

  page.cancelVerification();
  page.verified();

  await fixture.whenStable();

  expect(save).toHaveBeenCalledOnce();
  expect(page.model().password).toBe('');
  expect(page.phase()).toBe('edit');
});

it('discards a draft when the account changes and never submits it for the next account', async () => {
  const { fixture, page } = await pending();

  user.set({ id: 'another-synthetic-owner' });

  await fixture.whenStable();

  expect(page.model().password).toBe('');
  expect(page.phase()).toBe('edit');
  page.model.set({ password: secret });
  page.save(new Event('submit'));

  await fixture.whenStable();

  expect(save).toHaveBeenCalledOnce();
  expect(page.model().password).toBe('');
});

it('discards a draft when operations are cancelled or the page is destroyed', async () => {
  const controller = new AbortController();

  cancellation.set(controller.signal);

  const { fixture, page } = await pending();

  controller.abort();

  expect(page.model().password).toBe('');
  page.model.set({ password: secret });

  fixture.destroy();
  expect(page.model().password).toBe('');
});

it('keeps the draft available after an ordinary save failure', async () => {
  const fixture = TestBed.createComponent(ManagePassword);
  const page = fixture.componentInstance;

  await fixture.whenStable();

  save.mockRejectedValueOnce(new HttpErrorResponse({ status: 400, error: { error: 'request_invalid' } }));
  page.model.set({ password: secret });
  page.save(new Event('submit'));

  await fixture.whenStable();

  expect(page.phase()).toBe('edit');
  expect(page.model().password).toBe(secret);
  expect(page.action.error()).not.toBe('');
});

it('returns to editing with the draft after the verified save fails', async () => {
  const { fixture, page } = await pending();

  save.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
  page.verified();

  await fixture.whenStable();

  expect(page.phase()).toBe('edit');
  expect(page.model().password).toBe(secret);

  await vi.waitFor(() => expect(page.action.error()).toContain('temporarily unavailable'));
});

it('requires an explicit new edit after success and keeps notification failure separate from saving', async () => {
  const { fixture, page } = await pending();

  save.mockResolvedValueOnce({ notificationSent: false });
  page.verified();

  await fixture.whenStable();

  expect(page.phase()).toBe('saved');
  expect(page.model().password).toBe('');
  expect(page.action.notice()).toContain('notification could not be sent');
  page.save(new Event('submit'));

  await fixture.whenStable();

  expect(save).toHaveBeenCalledTimes(2);
  page.editAgain();
  expect(page.phase()).toBe('edit');
  expect(page.model().password).toBe('');
  expect(page.exists()).toBe(true);
  expect(page.action.notice()).toBe('');
});

it('does not show a saved result for a different account after a late response', async () => {
  const fixture = TestBed.createComponent(ManagePassword);
  const page = fixture.componentInstance;
  let finish!: (result: { notificationSent: boolean }) => void;

  await fixture.whenStable();

  save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );

  page.model.set({ password: secret });
  page.save(new Event('submit'));

  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());

  user.set({ id: 'another-synthetic-owner' });
  finish({ notificationSent: true });

  await fixture.whenStable();

  expect(page.phase()).toBe('edit');
  expect(page.model().password).toBe('');
});

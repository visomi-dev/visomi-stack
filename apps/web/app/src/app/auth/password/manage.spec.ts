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

  expect(page.verifying()).toBe(true);
  expect(page.model().password).toBe(secret);
  expect(navigate).not.toHaveBeenCalled();
  page.verified();

  await fixture.whenStable();

  expect(save.mock.calls).toEqual([
    [secret, false],
    [secret, false],
  ]);

  expect(page.model().password).toBe('');
  expect(page.verifying()).toBe(false);
  expect(page.exists()).toBe(true);
  expect(page.action.notice()).toBe('Your password has been saved.');
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
  expect(page.verifying()).toBe(false);
});

it('discards a draft when the account changes and never submits it for the next account', async () => {
  const { fixture, page } = await pending();

  user.set({ id: 'another-synthetic-owner' });

  await fixture.whenStable();

  expect(page.model().password).toBe('');
  expect(page.verifying()).toBe(false);
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

  expect(page.verifying()).toBe(false);
  expect(page.model().password).toBe(secret);
  expect(page.action.error()).not.toBe('');
});

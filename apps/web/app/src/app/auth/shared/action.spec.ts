import { Component, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { Session } from '../session/session';
import { BackupDisplay } from '../totp/backup-display';

import { Action, errorMessage } from './action';

@Component({
  imports: [BackupDisplay],
  providers: [Action],
  template: '<app-backup-display [codes]="[]" />',
})
class ActionOwner {
  readonly action = inject(Action);
}

it('distinguishes network failures from server unavailability without exposing internal details', () => {
  const internal = { error: 'synthetic_internal_error', message: 'synthetic private detail' };
  const network = errorMessage(new HttpErrorResponse({ status: 0, error: internal }));

  expect(network).toBe('We could not reach authentication. Check your connection and try again.');

  for (const status of [500, 502, 503, 504]) {
    expect(errorMessage(new HttpErrorResponse({ status, error: internal }))).toBe(
      'Authentication is temporarily unavailable. Please try again later.',
    );
  }

  expect(errorMessage(new Error('authentication_unavailable'))).toBe(
    'Authentication is temporarily unavailable. Please try again later.',
  );
});

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Session, useValue: { full: () => true } }],
  });
});

it('isolates pending actions between screen instances and nested controls', async () => {
  const first = TestBed.createComponent(ActionOwner);
  const second = TestBed.createComponent(ActionOwner);

  await Promise.all([first.whenStable(), second.whenStable()]);

  const action = first.componentInstance.action;
  const other = second.componentInstance.action;
  const child = first.debugElement.query(By.directive(BackupDisplay)).injector.get(Action);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = action.run(() => gate, { name: 'passkey' });

  expect(action.busy()).toBe(true);
  expect(action.pending()).toBe('passkey');
  expect(other.busy()).toBe(false);
  expect(child.busy()).toBe(false);
  const duplicate = vi.fn();

  await action.run(duplicate, { name: 'retry' });

  expect(duplicate).not.toHaveBeenCalled();
  expect(action.pending()).toBe('passkey');
  child.setNotice('Synthetic child notice');
  expect(action.notice()).toBe('');
  release();

  await work;

  expect(action.busy()).toBe(false);
  expect(action.pending()).toBeNull();
  expect(child.notice()).toBe('Synthetic child notice');
});

it('ignores late failures and external callbacks after the owning screen is destroyed', async () => {
  const fixture = TestBed.createComponent(ActionOwner);

  await fixture.whenStable();

  const action = fixture.componentInstance.action;
  let fail!: (error: Error) => void;
  const gate = new Promise<void>((_resolve, reject) => {
    fail = reject;
  });
  const work = action.run(() => gate, { name: 'passkey' });

  fixture.destroy();
  action.setNotice('Synthetic stale notice');
  action.setError('Synthetic stale error');
  fail(new Error('synthetic-failure'));

  await work;

  expect(action.error()).toBe('');
  expect(action.notice()).toBe('');
  expect(action.errorFocus()).toBe(0);
});

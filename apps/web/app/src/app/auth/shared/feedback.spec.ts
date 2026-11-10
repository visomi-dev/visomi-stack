import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Session } from '../session/session';

import { Action } from './action';
import { AuthFeedback } from './feedback';

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Session, useValue: { full: signal(true) } }],
  });

  TestBed.overrideComponent(AuthFeedback, { add: { providers: [Action] } });
});

it('keeps inline progress accessible without clipping errors or notices', async () => {
  const fixture = TestBed.createComponent(AuthFeedback);
  const action = fixture.debugElement.injector.get(Action);

  fixture.componentRef.setInput('action', action);
  fixture.componentRef.setInput('indicator', false);

  await fixture.whenStable();

  action.setProcessing(true);

  await fixture.whenStable();

  const host = fixture.nativeElement as HTMLElement;

  expect(host.classList.contains('sr-only')).toBe(true);
  expect(host.hidden).toBe(false);
  expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Working…');
  action.setError('Synthetic action error');

  await fixture.whenStable();

  expect(host.classList.contains('sr-only')).toBe(false);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Synthetic action error');
  action.setError('');
  action.setNotice('Synthetic action notice');

  await fixture.whenStable();

  expect(host.classList.contains('sr-only')).toBe(false);
  expect(host.textContent).toContain('Synthetic action notice');
});

it('focuses the owning alert after rendering and supports repeating the same failed action', async () => {
  const first = TestBed.createComponent(AuthFeedback);
  const second = TestBed.createComponent(AuthFeedback);
  const firstAction = first.debugElement.injector.get(Action);
  const secondAction = second.debugElement.injector.get(Action);

  first.componentRef.setInput('action', firstAction);
  second.componentRef.setInput('action', secondAction);
  firstAction.setError('Synthetic background error');

  await Promise.all([first.whenStable(), second.whenStable()]);

  for (let attempt = 0; attempt < 2; attempt++) {
    const button = document.createElement('button');

    document.body.append(button);
    button.focus();

    await secondAction.run(async () => {
      throw new Error('synthetic-failure');
    });

    await second.whenStable();

    expect(document.activeElement).toBe(second.nativeElement.querySelector('[role="alert"]'));
    expect(document.activeElement).not.toBe(first.nativeElement.querySelector('[role="alert"]'));
    button.remove();
  }
});

it('announces background failures without moving focus', async () => {
  const fixture = TestBed.createComponent(AuthFeedback);
  const action = fixture.debugElement.injector.get(Action);

  fixture.componentRef.setInput('action', action);

  await fixture.whenStable();

  const button = document.createElement('button');

  document.body.append(button);

  try {
    button.focus();
    action.setError('Synthetic polling failure');

    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Synthetic polling failure');
    expect(document.activeElement).toBe(button);
  } finally {
    button.remove();
  }
});

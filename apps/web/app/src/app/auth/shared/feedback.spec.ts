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
});

it('focuses the owning alert after rendering and supports repeating the same failed action', async () => {
  const first = TestBed.createComponent(AuthFeedback);
  const second = TestBed.createComponent(AuthFeedback);
  const firstAction = TestBed.runInInjectionContext(() => new Action());
  const secondAction = TestBed.runInInjectionContext(() => new Action());

  first.componentRef.setInput('action', firstAction);
  second.componentRef.setInput('action', secondAction);
  firstAction.error.set('Synthetic background error');

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
  const action = TestBed.runInInjectionContext(() => new Action());

  fixture.componentRef.setInput('action', action);

  await fixture.whenStable();

  const button = document.createElement('button');

  document.body.append(button);

  try {
    button.focus();
    action.error.set('Synthetic polling failure');

    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Synthetic polling failure');
    expect(document.activeElement).toBe(button);
  } finally {
    button.remove();
  }
});

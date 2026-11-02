import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';

import { passwordPolicy } from './validation';

it('counts normalized Unicode characters instead of UTF-16 code units', () => {
  const model = signal({ password: '😀'.repeat(12) });
  const fields = TestBed.runInInjectionContext(() => form(model, (path) => passwordPolicy(path.password)));

  expect(fields().valid()).toBe(true);
  model.set({ password: 'e\u0301'.repeat(11) });
  expect(fields().invalid()).toBe(true);
  model.set({ password: 'e\u0301'.repeat(12) });
  expect(fields().valid()).toBe(true);
  model.set({ password: '😀'.repeat(128) });
  expect(fields().valid()).toBe(true);
  model.set({ password: '😀'.repeat(129) });
  expect(fields().invalid()).toBe(true);
});

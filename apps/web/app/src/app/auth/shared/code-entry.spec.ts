import { TestBed } from '@angular/core/testing';

import { CodeEntry } from './code-entry';

it('keeps a code as text, accepts leading zeroes and submits only explicitly', async () => {
  const fixture = TestBed.createComponent(CodeEntry);
  const received = vi.fn();

  fixture.componentInstance.confirmed.subscribe(received);

  await fixture.whenStable();

  const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

  input.value = '001234';
  input.dispatchEvent(new Event('input', { bubbles: true }));

  await fixture.whenStable();

  expect(received).not.toHaveBeenCalled();
  fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  await fixture.whenStable();

  expect(received).toHaveBeenCalledWith('001234');
  expect(input.type).toBe('text');
  expect(input.autocomplete).toBe('one-time-code');
});
it('accepts backup codes without imposing a numeric code format', async () => {
  const fixture = TestBed.createComponent(CodeEntry);

  fixture.componentRef.setInput('backup', true);

  await fixture.whenStable();

  fixture.componentInstance.model.set({ code: 'SYNTHETIC-BACKUP' });

  await fixture.whenStable();

  expect(fixture.componentInstance.fields().valid()).toBe(true);
});

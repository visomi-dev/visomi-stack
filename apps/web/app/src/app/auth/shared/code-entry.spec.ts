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
  expect(input.inputMode).toBe('numeric');
  expect(input.labels?.[0].textContent).toBe('Verification code');
  expect(input.getAttribute('aria-describedby')).toBe('verification-code-help');
});

it('accepts backup codes without imposing a numeric code format', async () => {
  const fixture = TestBed.createComponent(CodeEntry);

  const received = vi.fn();

  fixture.componentInstance.confirmed.subscribe(received);

  await fixture.whenStable();

  fixture.componentInstance.fields.code().value.set('001');
  fixture.componentRef.setInput('backup', true);

  await fixture.whenStable();

  const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

  expect(input.value).toBe('');
  expect(input.autocomplete).toBe('off');
  expect(input.getAttribute('maxlength')).toBeNull();

  input.value = 'SYNTHETIC-BACKUP';
  input.dispatchEvent(new Event('input', { bubbles: true }));

  await fixture.whenStable();

  expect(fixture.componentInstance.fields().valid()).toBe(true);

  fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  await fixture.whenStable();

  expect(received).toHaveBeenCalledExactlyOnceWith('SYNTHETIC-BACKUP');
});

it('replaces the selected digits with a formatted paste up to the available length', async () => {
  const fixture = TestBed.createComponent(CodeEntry);
  const received = vi.fn();

  fixture.componentInstance.confirmed.subscribe(received);
  fixture.componentInstance.fields.code().value.set('009956');

  await fixture.whenStable();

  const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
  const paste = new Event('paste', { bubbles: true, cancelable: true });

  Object.defineProperty(paste, 'clipboardData', { value: { getData: () => ' 1-2-3 ' } });
  input.setSelectionRange(2, 4);
  input.dispatchEvent(paste);

  await fixture.whenStable();

  expect(paste.defaultPrevented).toBe(true);
  expect(input.value).toBe('001256');
  expect(input.selectionStart).toBe(4);
  expect(input.selectionEnd).toBe(4);
  expect(fixture.componentInstance.fields.code().value()).toBe('001256');
  expect(received).not.toHaveBeenCalled();
});

it('focuses its own invalid control even when another form has an invalid field', async () => {
  const otherForm = document.createElement('form');
  const otherInput = document.createElement('input');

  otherInput.setAttribute('aria-invalid', 'true');
  otherForm.append(otherInput);
  document.body.prepend(otherForm);

  try {
    const fixture = TestBed.createComponent(CodeEntry);

    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await fixture.whenStable();

    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('verification-code-help verification-code-error');
    expect(fixture.nativeElement.querySelector('#verification-code-error').textContent).toBe('Complete this field.');
  } finally {
    otherForm.remove();
  }
});

it('marks an edit as touched on blur and presents errors after submission', async () => {
  const fixture = TestBed.createComponent(CodeEntry);

  await fixture.whenStable();

  const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

  input.value = '001';
  input.dispatchEvent(new Event('input', { bubbles: true }));

  await fixture.whenStable();

  expect(input.hasAttribute('aria-invalid')).toBe(false);

  input.focus();
  input.blur();

  await fixture.whenStable();

  expect(fixture.componentInstance.fields.code().touched()).toBe(true);
  expect(input.hasAttribute('aria-invalid')).toBe(false);

  fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  await fixture.whenStable();

  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(fixture.nativeElement.querySelector('#verification-code-error').textContent).toBe('Enter the 6-digit code.');
});

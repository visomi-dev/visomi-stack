import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Field, PinInput } from '../../index';

@Component({
  imports: [Field, PinInput],
  template: `
    <app-field control-id="approval-pin" label="Approval PIN" [manual-error]="error()">
      <app-pin-input
        required
        [digits]="grouped() ? 8 : 5"
        [accept-spaces]="grouped()"
        [accept-formatted-paste]="grouped()"
        [value]="code()"
        (valueChange)="changeCode($event)"
      />
    </app-field>
  `,
})
class ApprovalForm {
  readonly code = signal('');
  readonly error = signal('');
  readonly grouped = signal(false);

  protected changeCode(value: string): void {
    this.code.set(value);
  }
}

it('uses a caller-selected PIN length in a form independent of vault services', () => {
  const view = TestBed.createComponent(ApprovalForm);

  view.detectChanges();
  const container = view.nativeElement as HTMLElement;
  const control = container.querySelector('input')!;

  expect(control.labels?.[0].textContent).toBe('Approval PIN');
  expect(control.type).toBe('password');
  expect(control.hasAttribute('aria-invalid')).toBe(false);
  view.componentInstance.error.set('Check the PIN.');
  view.detectChanges();
  expect(control.getAttribute('aria-invalid')).toBe('true');
  expect(control.getAttribute('aria-describedby')).toBe('approval-pin-error');
  expect(container.querySelector('#approval-pin-error')?.textContent).toContain('Check the PIN.');
  view.componentInstance.error.set('');
  view.detectChanges();
  expect(control.hasAttribute('aria-invalid')).toBe(false);
  expect(control.minLength).toBe(5);
  expect(control.maxLength).toBe(5);
  expect(container.querySelectorAll('[aria-hidden=true] > span')).toHaveLength(5);
  control.value = '0012';
  expect(control.checkValidity()).toBe(false);
  control.value = '00123';
  control.dispatchEvent(new Event('input'));
  expect(control.checkValidity()).toBe(true);
  expect(view.componentInstance.code()).toBe('00123');
  view.componentInstance.code.set('');
  view.detectChanges();
  expect(control.value).toBe('');
});

it('emits a native edit once and restores the supplied value when the owner declines it', () => {
  const view = TestBed.createComponent(ApprovalForm);
  const owner = view.componentInstance;

  owner.code.set('00123');
  const handleEdit = vi.spyOn(owner.code, 'set').mockImplementation(() => undefined);

  view.detectChanges();
  const control = (view.nativeElement as HTMLElement).querySelector('input')!;

  expect(control.value).toBe('00123');
  control.value = '00124';
  control.dispatchEvent(new Event('input'));
  view.detectChanges();

  expect(handleEdit).toHaveBeenCalledExactlyOnceWith('00124');
  expect(owner.code()).toBe('00123');
  expect(control.value).toBe('00123');
});

it('accepts an eight-digit code with a space, including on paste', () => {
  const view = TestBed.createComponent(ApprovalForm);

  view.componentInstance.grouped.set(true);
  view.detectChanges();
  const control = (view.nativeElement as HTMLElement).querySelector('input')!;

  expect(control.maxLength).toBe(9);
  control.value = '0123 4567';
  control.dispatchEvent(new Event('input'));
  expect(control.checkValidity()).toBe(true);
  expect(control.value).toBe('01234567');
  expect(view.componentInstance.code()).toBe('01234567');
  control.select();
  const paste = new Event('paste', { cancelable: true });

  Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '8765 4321' } });
  control.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(true);
  expect(view.componentInstance.code()).toBe('87654321');
});

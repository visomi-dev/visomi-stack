import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Field, PinInput } from '../index';

@Component({
  imports: [Field, PinInput],
  template: `
    <app-field control-id="approval-pin" label="Approval PIN" [manual-error]="error()">
      <app-pin-input required [digits]="5" [draft]="code" />
    </app-field>
  `,
})
class ApprovalForm {
  readonly code = signal('');
  readonly error = signal('');
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

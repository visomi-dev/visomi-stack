import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Field, PinInput } from '../index';

@Component({
  imports: [Field, PinInput],
  template: `
    <app-field control-id="approval-pin" label="Approval PIN">
      <app-pin-input required [digits]="5" [draft]="code" />
    </app-field>
  `,
})
class ApprovalForm {
  readonly code = signal('');
}

it('uses a caller-selected PIN length in a form independent of vault services', () => {
  const view = TestBed.createComponent(ApprovalForm);

  view.detectChanges();
  const container = view.nativeElement as HTMLElement;
  const control = container.querySelector('input')!;

  expect(control.labels?.[0].textContent).toBe('Approval PIN');
  expect(control.type).toBe('password');
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

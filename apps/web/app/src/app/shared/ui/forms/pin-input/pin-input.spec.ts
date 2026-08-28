import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, type FieldTree } from '@angular/forms/signals';

import { PinInput } from './pin-input';

@Component({
  imports: [FormField, PinInput],
  template: '<app-pin-input idPrefix="pin" [digits]="6" [formField]="f.pin" />',
})
class Host {
  readonly model = signal({ pin: '123456' });
  readonly f: FieldTree<{ pin: string }> = form(this.model, () => undefined);
}

describe('PinInput', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders one input per digit from a signal form value', () => {
    const inputs = fixture.nativeElement.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

    expect(inputs.length).toBe(6);
    expect([...inputs].map((inputElement) => inputElement.value).join('')).toBe('123456');
  });

  it('exposes the OTP group and digit positions to assistive technology', () => {
    const group = fixture.nativeElement.querySelector('[data-slot="pin-input"]') as HTMLElement;
    const inputs = fixture.nativeElement.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Verification code');
    expect(inputs[0]?.getAttribute('aria-posinset')).toBe('1');
    expect(inputs[0]?.getAttribute('aria-setsize')).toBe('6');
    expect(inputs[5]?.getAttribute('aria-posinset')).toBe('6');
    expect(inputs[0]?.getAttribute('aria-required')).toBe('true');
  });
});

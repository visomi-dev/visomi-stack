import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, type FieldTree } from '@angular/forms/signals';

import { PasswordInput } from './password-input';

@Component({
  imports: [FormField, PasswordInput],
  template: '<app-password-input [formField]="f.password" />',
})
class Host {
  readonly model = signal({ password: 'secret123!' });
  readonly f: FieldTree<{ password: string }> = form(this.model, () => undefined);
}

describe('PasswordInput', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('reflects the signal form value onto the inner input', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    expect(input.value).toBe('secret123!');
    expect(input.type).toBe('password');
  });
});

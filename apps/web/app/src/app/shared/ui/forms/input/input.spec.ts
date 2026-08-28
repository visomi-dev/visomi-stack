import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, type FieldTree } from '@angular/forms/signals';

import { Input } from './input';

@Component({
  imports: [FormField, Input],
  template: '<app-input controlId="name" [formField]="f.name" />',
})
class Host {
  readonly model = signal({ name: 'Ada' });
  readonly f: FieldTree<{ name: string }> = form(this.model, () => undefined);
}

describe('Input', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('reflects the signal form value onto the inner input', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    expect(input.value).toBe('Ada');
  });

  it('updates the form field when the user types', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const event = new Event('input', { bubbles: true });

    input.value = 'Grace';
    input.dispatchEvent(event);
    fixture.detectChanges();

    expect(fixture.componentInstance.f.name().value()).toBe('Grace');
  });
});

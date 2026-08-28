import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, type FieldTree } from '@angular/forms/signals';

import { ColorPicker } from './color-picker';

@Component({
  imports: [FormField, ColorPicker],
  template: '<app-color-picker [formField]="f.color" />',
})
class Host {
  readonly model = signal({ color: 'PINK' });
  readonly f: FieldTree<{ color: string }> = form(this.model, () => undefined);
}

describe('ColorPicker', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('marks the option that matches the signal form value as checked', () => {
    const inputs = fixture.nativeElement.querySelectorAll('input[type="radio"]') as NodeListOf<HTMLInputElement>;

    expect(inputs[1]?.checked).toBe(true);
  });
});

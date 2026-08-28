import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, type FieldTree } from '@angular/forms/signals';

import { RadioCard } from './radio-card';

@Component({
  imports: [FormField, RadioCard],
  template: '<app-radio-card optionValue="standard" [formField]="f.plan">Standard</app-radio-card>',
})
class Host {
  readonly model = signal({ plan: 'standard' });
  readonly f: FieldTree<{ plan: string }> = form(this.model, () => undefined);
}

describe('RadioCard', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders a checked radio card when the signal form value matches', () => {
    const input = fixture.nativeElement.querySelector('input[type="radio"]') as HTMLInputElement;

    expect(input.checked).toBe(true);
  });
});

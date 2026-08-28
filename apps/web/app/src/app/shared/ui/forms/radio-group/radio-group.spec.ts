import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, type FieldTree } from '@angular/forms/signals';

import { RadioGroup, type RadioOption } from './radio-group';

const options: readonly RadioOption[] = [
  { label: 'Standard', value: 'standard' },
  { label: 'Pro', value: 'pro' },
  { label: 'Team', value: 'team' },
];

@Component({
  imports: [FormField, RadioGroup],
  template: '<app-radio-group [options]="options" [formField]="f.plan" />',
})
class Host {
  readonly model = signal({ plan: 'pro' });
  readonly f: FieldTree<{ plan: string }> = form(this.model, () => undefined);
  readonly options = options;
}

describe('RadioGroup', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('marks the option that matches the signal form value as checked', () => {
    const inputs = fixture.nativeElement.querySelectorAll('input[type="radio"]') as NodeListOf<HTMLInputElement>;

    expect(inputs[0]?.checked).toBe(false);
    expect(inputs[1]?.checked).toBe(true);
    expect(inputs[2]?.checked).toBe(false);
  });
});

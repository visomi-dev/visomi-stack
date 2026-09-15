import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { disabled, form, FormField, type FieldTree } from '@angular/forms/signals';

import { RadioGroup, type RadioOption } from './radio-group';

const options: readonly RadioOption[] = [
  { label: 'Standard', value: 'standard' },
  { label: 'Pro', value: 'pro' },
  { label: 'Team', value: 'team', disabled: true, description: 'Available on request.' },
];

@Component({
  imports: [FormField, RadioGroup],
  template: '<app-radio-group [options]="options" [formField]="f.plan" [loading]="loading()" legend="Plan" />',
})
class Host {
  readonly model = signal({ plan: 'pro' });
  readonly locked = signal(false);
  readonly loading = signal(false);
  readonly f: FieldTree<{ plan: string }> = form(this.model, (path) => disabled(path.plan, () => this.locked()));
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

  it('selects an enabled option and marks the field touched on blur', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.click();
    input.dispatchEvent(new Event('blur'));
    expect(fixture.componentInstance.model().plan).toBe('standard');
    expect(fixture.componentInstance.f.plan().touched()).toBe(true);
  });

  it('keeps individually disabled options unchanged when clicked', () => {
    const input = fixture.nativeElement.querySelector('input[value="team"]') as HTMLInputElement;

    expect(input.disabled).toBe(true);
    input.click();
    expect(fixture.componentInstance.model().plan).toBe('pro');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('respects Signal Forms disabled state and loading state', async () => {
    fixture.componentInstance.locked.set(true);
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    expect(input.disabled).toBe(true);
    input.click();
    expect(fixture.componentInstance.model().plan).toBe('pro');
    fixture.componentInstance.locked.set(false);
    fixture.componentInstance.loading.set(true);
    await fixture.whenStable();
    expect(input.disabled).toBe(true);
    fixture.componentInstance.loading.set(false);
    await fixture.whenStable();
    expect(input.disabled).toBe(false);
  });
});

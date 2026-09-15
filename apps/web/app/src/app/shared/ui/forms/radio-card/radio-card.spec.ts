import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { disabled, form, FormField, type FieldTree } from '@angular/forms/signals';

import { RadioCard } from './radio-card';

@Component({
  imports: [FormField, RadioCard],
  template: '<app-radio-card optionValue="standard" [formField]="f.plan">Standard</app-radio-card>',
})
class Host {
  readonly model = signal({ plan: 'standard' });
  readonly locked = signal(false);
  readonly f: FieldTree<{ plan: string }> = form(this.model, (path) => disabled(path.plan, () => this.locked()));
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

  it('keeps a selected radio selected when clicked again', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.click();
    expect(fixture.componentInstance.model().plan).toBe('standard');
    expect(input.checked).toBe(true);
    expect(fixture.nativeElement.querySelector('label').hasAttribute('tabindex')).toBe(false);
  });

  it('updates the model from a native change event', async () => {
    fixture.componentInstance.model.set({ plan: '' });
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.click();
    expect(fixture.componentInstance.model().plan).toBe('standard');
  });

  it('prevents selection when Signal Forms disables the field', async () => {
    fixture.componentInstance.model.set({ plan: '' });
    fixture.componentInstance.locked.set(true);
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    expect(input.disabled).toBe(true);
    input.click();
    expect(fixture.componentInstance.model().plan).toBe('');
  });
});

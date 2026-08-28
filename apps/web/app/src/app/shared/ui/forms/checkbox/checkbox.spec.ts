import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, type FieldTree } from '@angular/forms/signals';

import { Checkbox } from './checkbox';

@Component({
  imports: [FormField, Checkbox],
  template: '<app-checkbox controlId="remember" [formField]="f.remember" [disabled]="disabled()" />',
})
class Host {
  readonly model = signal({ remember: true });
  readonly disabled = signal(false);
  readonly f: FieldTree<{ remember: boolean }> = form(this.model, () => undefined);
}

describe('Checkbox', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('reflects the signal form value onto the inner checkbox', () => {
    const input = fixture.nativeElement.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(input.checked).toBe(true);
  });

  it('updates the signal form value when toggled', () => {
    const input = fixture.nativeElement.querySelector('input[type="checkbox"]') as HTMLInputElement;

    input.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.model().remember).toBe(false);
    expect(input.checked).toBe(false);
  });

  it('forwards disabled state to the native checkbox', () => {
    const input = fixture.nativeElement.querySelector('input[type="checkbox"]') as HTMLInputElement;

    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();

    expect(input.disabled).toBe(true);
  });
});

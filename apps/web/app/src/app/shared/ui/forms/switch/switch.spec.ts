import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, type FieldTree } from '@angular/forms/signals';

import { Switch } from './switch';

@Component({
  imports: [FormField, Switch],
  template: '<app-switch id="dark-mode" ariaLabel="Dark mode" [formField]="f.darkMode" />',
})
class Host {
  readonly model = signal({ darkMode: true });
  readonly f: FieldTree<{ darkMode: boolean }> = form(this.model, () => undefined);
}

describe('Switch', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('reflects the signal form value as aria-checked on the inner button', () => {
    const button = fixture.nativeElement.querySelector('button[role="switch"]') as HTMLButtonElement;

    expect(button.getAttribute('aria-checked')).toBe('true');
  });
});

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, type FieldTree } from '@angular/forms/signals';

import { Switch } from './switch';

@Component({
  imports: [FormField, Switch],
  template:
    '<app-switch id="dark-mode" ariaLabel="Dark mode" i18n-ariaLabel="@@SwitchSpecTemplateText1" [formField]="f.darkMode" />',
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

  it('tracks toggles separately from loaded values and preserves accessibility after reset', async () => {
    const button = fixture.nativeElement.querySelector('button[role="switch"]') as HTMLButtonElement;

    fixture.componentInstance.model.set({ darkMode: false });
    await fixture.whenStable();
    expect(button.getAttribute('aria-checked')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Dark mode');
    expect(fixture.componentInstance.f().dirty()).toBe(false);
    button.click();
    button.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(fixture.componentInstance.model().darkMode).toBe(true);
    expect(fixture.componentInstance.f.darkMode().dirty()).toBe(true);
    expect(fixture.componentInstance.f.darkMode().touched()).toBe(true);
    expect(fixture.componentInstance.f().dirty()).toBe(true);
    fixture.componentInstance.f().reset();
    await fixture.whenStable();
    expect(fixture.componentInstance.f().dirty()).toBe(false);
    expect(fixture.componentInstance.f.darkMode().touched()).toBe(false);
    expect(button.getAttribute('aria-checked')).toBe('true');
  });
});

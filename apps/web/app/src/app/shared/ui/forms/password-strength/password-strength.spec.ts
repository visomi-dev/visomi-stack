import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PasswordStrength, computePasswordStrength } from './password-strength';

@Component({
  imports: [PasswordStrength],
  template: `<app-password-strength [password]="password" />`,
})
class Host {
  readonly password = signal('');
}

describe('computePasswordStrength', () => {
  it('returns 0 for an empty value', () => {
    expect(computePasswordStrength('')).toBe(0);
  });

  it.each([
    { value: 'password', expected: 1 as const },
    { value: 'Password', expected: 2 as const },
    { value: 'Password1', expected: 3 as const },
    { value: 'Strong-Pass-12!', expected: 4 as const },
  ])('maps "$value" to level $expected', ({ value, expected }) => {
    expect(computePasswordStrength(value)).toBe(expected);
  });
});

describe('PasswordStrength', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('reflects the live password strength via data-level and label', () => {
    const meter = fixture.nativeElement.querySelector('[data-slot="password-strength"]') as HTMLElement;
    const label = fixture.nativeElement.querySelector('[data-slot="password-strength-label"]') as HTMLElement;

    expect(meter.getAttribute('data-level')).toBe('0');
    expect(label.textContent?.trim()).toBe('—');
    expect(label.classList.contains('opacity-0')).toBe(true);

    fixture.componentInstance.password.set('Strong-Pass-12!');
    fixture.detectChanges();

    expect(meter.getAttribute('data-level')).toBe('4');
    expect(label.textContent?.trim()).toBe('Excellent');
  });
});

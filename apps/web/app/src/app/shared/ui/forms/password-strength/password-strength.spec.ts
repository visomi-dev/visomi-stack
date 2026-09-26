import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Deps } from '../../../deps';

import { PasswordStrength } from './password-strength';

@Component({
  imports: [PasswordStrength],
  template: `<app-password-strength [password]="password" />`,
})
class Host {
  readonly password = signal('');
}

describe('PasswordStrength', () => {
  it('penalizes common substitutions, sequences, and repeated strings despite their length', async () => {
    const estimator = await TestBed.inject(Deps).loadPasswordEstimator();

    for (const value of ['Password123!', '1234567890123456', 'Abc!Abc!Abc!Abc!', 'a'.repeat(64)]) {
      expect(estimator.check(value).score).toBeLessThan(3);
    }
    expect(estimator.check('cobalt hammock orchard lantern').score).toBeGreaterThanOrEqual(3);
  });

  it('updates the estimate and guidance while keeping an empty value neutral', async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);

    await fixture.whenStable();
    const label = () => fixture.nativeElement.querySelector('[data-slot="password-strength-label"]') as HTMLElement;

    expect(label().textContent?.trim()).toBe('—');
    fixture.componentInstance.password.set('Password123!');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Try several unrelated words');
    expect(label().textContent).not.toContain('Very strong');
    fixture.componentInstance.password.set('cobalt hammock orchard lantern');
    await fixture.whenStable();
    expect(label().textContent).toMatch(/strong/i);
    fixture.componentInstance.password.set('');
    await fixture.whenStable();
    expect(label().textContent?.trim()).toBe('—');
  });
});

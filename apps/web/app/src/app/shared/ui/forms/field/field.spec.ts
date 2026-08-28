import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Field } from './field';

@Component({
  imports: [Field],
  template: `
    <app-field [invalid]="invalid()" [manualError]="manualError()">
      <input type="text" />
    </app-field>
  `,
})
class Host {
  readonly invalid = signal(false);
  readonly manualError = signal<string | null>(null);
}

describe('Field', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('always carries data-control on the host', async () => {
    const field = fixture.nativeElement.querySelector('app-field') as HTMLElement;

    expect(field.getAttribute('data-control')).toBe('');
    expect(field.hasAttribute('data-invalid')).toBe(false);
    expect(field.hasAttribute('data-manual-invalid')).toBe(false);
  });

  it('flips data-invalid when [invalid] is set to true', async () => {
    host.invalid.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const field = fixture.nativeElement.querySelector('app-field') as HTMLElement;

    expect(field.getAttribute('data-invalid')).toBe('');
  });

  it('flips data-manual-invalid when [manualError] is non-empty', async () => {
    host.manualError.set('Something went wrong.');
    fixture.detectChanges();
    await fixture.whenStable();

    const field = fixture.nativeElement.querySelector('app-field') as HTMLElement;

    expect(field.getAttribute('data-manual-invalid')).toBe('');
  });

  it('drops data-manual-invalid when [manualError] resets to empty', async () => {
    host.manualError.set('Something went wrong.');
    fixture.detectChanges();
    await fixture.whenStable();
    host.manualError.set('');
    fixture.detectChanges();
    await fixture.whenStable();

    const field = fixture.nativeElement.querySelector('app-field') as HTMLElement;

    expect(field.hasAttribute('data-manual-invalid')).toBe(false);
  });

  it('keeps both attributes set when both inputs are truthy', async () => {
    host.invalid.set(true);
    host.manualError.set('Cross-field mismatch.');
    fixture.detectChanges();
    await fixture.whenStable();

    const field = fixture.nativeElement.querySelector('app-field') as HTMLElement;

    expect(field.getAttribute('data-invalid')).toBe('');
    expect(field.getAttribute('data-manual-invalid')).toBe('');
  });
});

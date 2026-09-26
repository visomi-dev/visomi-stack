import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, required, type FieldTree } from '@angular/forms/signals';

import { Form } from './form';

@Component({
  imports: [Form, FormField],
  template: `
    <app-form [(submitted)]="submitted" [form]="f" (ngSubmit)="onSubmit()">
      <input [formField]="f.email" required />
    </app-form>
  `,
})
class Host {
  readonly submitted = signal(false);
  readonly model = signal({ email: '' });
  readonly f: FieldTree<{ email: string }> = form(this.model, (p) => {
    required(p.email, { message: 'Enter your email address.' });
  });
  onSubmit(): void {
    // counted as an emission indicator; no DOM work required.
  }
}

describe('Form', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('flips data-submitted when the inner <form> is submitted', async () => {
    const form = fixture.nativeElement.querySelector('app-form') as HTMLElement;

    expect(form.hasAttribute('data-submitted')).toBe(false);

    const innerForm = fixture.nativeElement.querySelector('form') as HTMLFormElement;

    innerForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.submitted()).toBe(true);
    expect(form.getAttribute('data-submitted')).toBe('');
  });

  it('mirrors an externally-set submitted signal onto the host', async () => {
    fixture.componentInstance.submitted.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const form = fixture.nativeElement.querySelector('app-form') as HTMLElement;

    expect(form.getAttribute('data-submitted')).toBe('');
  });

  it('forwards the novalidate attribute to the inner <form>', async () => {
    expect((fixture.nativeElement.querySelector('form') as HTMLFormElement).hasAttribute('novalidate')).toBe(true);
  });

  it('explains invalid submission, focuses the summary, and does not emit until valid', async () => {
    const submit = vi.spyOn(fixture.componentInstance, 'onSubmit');
    const innerForm = fixture.nativeElement.querySelector('form') as HTMLFormElement;

    innerForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await fixture.whenStable();
    expect(submit).not.toHaveBeenCalled();
    expect(fixture.componentInstance.f.email().touched()).toBe(true);
    const summary = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;

    expect(summary.textContent).toContain('Enter your email address.');
    expect(document.activeElement).toBe(summary);
    fixture.componentInstance.model.set({ email: 'person@example.test' });
    await fixture.whenStable();
    innerForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await fixture.whenStable();
    expect(submit).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    fixture.componentInstance.model.set({ email: '' });
    await fixture.whenStable();
    expect(fixture.componentInstance.submitted()).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-form').hasAttribute('data-submitted')).toBe(false);
    innerForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(submit).toHaveBeenCalledOnce();
  });
});

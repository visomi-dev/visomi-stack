import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { disabled, form, FormField, type FieldTree } from '@angular/forms/signals';
import { vi } from 'vitest';

import { Textarea } from './textarea';

@Component({
  imports: [FormField, Textarea],
  template: '<app-textarea [formField]="f.summary" />',
})
class Host {
  readonly model = signal({ summary: 'A short summary.' });
  readonly unavailable = signal(false);

  readonly f: FieldTree<{ summary: string }> = form(this.model, (path) => {
    disabled(path.summary, { when: () => this.unavailable() });
  });
}

describe('Textarea', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies disabled form state to the native control and preserves loaded values on re-enable', async () => {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;

    fixture.componentInstance.unavailable.set(true);
    await fixture.whenStable();
    expect(textarea.disabled).toBe(true);
    fixture.componentInstance.model.set({ summary: 'Loaded while disabled' });
    await fixture.whenStable();
    expect(textarea.value).toBe('Loaded while disabled');
    fixture.componentInstance.unavailable.set(false);
    await fixture.whenStable();
    expect(textarea.disabled).toBe(false);
    expect(textarea.value).toBe('Loaded while disabled');
    expect(fixture.componentInstance.f().dirty()).toBe(false);
  });

  it('keeps a replacement disabled until the newly loaded value reaches the native control', async () => {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    const disabledDuringWrites: boolean[] = [];

    vi.spyOn(textarea, 'value', 'set').mockImplementation((value: string) => {
      disabledDuringWrites.push(textarea.disabled);
      setter?.call(textarea, value);
    });
    fixture.componentInstance.model.set({ summary: 'Replacement pairing request' });
    await fixture.whenStable();
    expect(disabledDuringWrites).toEqual([true]);
    expect(textarea.disabled).toBe(false);
    expect(textarea.value).toBe('Replacement pairing request');
  });

  it('preserves native select-all replacement, focus and caret through the following render', async () => {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;

    textarea.focus();
    textarea.select();
    textarea.setRangeText('New pairing request', 0, textarea.value.length, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(textarea.value).toBe('New pairing request');
    expect(textarea.selectionStart).toBe('New pairing request'.length);
    expect(textarea.ownerDocument.activeElement).toBe(textarea);
    expect(fixture.componentInstance.f.summary().value()).toBe('New pairing request');
    expect(fixture.componentInstance.f().dirty()).toBe(true);
  });

  it('reflects the signal form value onto the inner textarea', () => {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;

    expect(textarea.value).toBe('A short summary.');
  });

  it('tracks user edits, blur and confirmed resets without treating loaded values as edits', async () => {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    const field = fixture.componentInstance.f.summary;

    fixture.componentInstance.model.set({ summary: 'Loaded sample' });
    await fixture.whenStable();
    expect(textarea.value).toBe('Loaded sample');
    expect(field().dirty()).toBe(false);
    textarea.value = 'Unsaved sample';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(field().value()).toBe('Unsaved sample');
    expect(field().dirty()).toBe(true);
    expect(fixture.componentInstance.f().dirty()).toBe(true);
    expect(field().touched()).toBe(false);
    textarea.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(field().touched()).toBe(true);
    fixture.componentInstance.f().reset();
    await fixture.whenStable();
    expect(field().dirty()).toBe(false);
    expect(field().touched()).toBe(false);
    expect(textarea.value).toBe('Unsaved sample');
  });
});

import { Component, PLATFORM_ID, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { disabled, form, FormField, required } from '@angular/forms/signals';
import { vi } from 'vitest';

import { Input } from './input';

@Component({
  imports: [FormField, Input],
  template: `
    <label i18n="@@inputSpecLabel" [attr.for]="controlId()">Planned amount</label>
    <app-input
      [controlId]="controlId()"
      [formField]="useOther() ? f.other : f.name"
      [disabled]="explicitDisabled()"
      [invalid]="explicitInvalid()"
      [ariaDescribedBy]="descriptionId()"
      [autocomplete]="autocomplete()"
      [type]="type()"
      [inputmode]="inputmode()"
      [required]="isRequired()"
      [placeholder]="placeholder()"
      [name]="controlName()"
      [spellcheck]="spellcheck()"
      (valueChange)="changes.push($event)"
    />
    <p i18n="@@inputSpecHelp" [id]="descriptionId()">Enter the planned amount.</p>
  `,
})
class Host {
  readonly model = signal({ name: 'Ada', other: 'Ada' });
  readonly useOther = signal(false);
  readonly explicitDisabled = signal(false);
  readonly fieldDisabled = signal(false);
  readonly explicitInvalid = signal(false);
  readonly controlId = signal('name');
  readonly descriptionId = signal('name-help');
  readonly autocomplete = signal('off');
  readonly type = signal('text');
  readonly inputmode = signal('text');
  readonly isRequired = signal(true);
  readonly placeholder = signal('Your name');
  readonly controlName = signal('name');
  readonly spellcheck = signal(false);

  readonly f = form(this.model, (path) => {
    required(path.name);
    disabled(path.name, { when: () => this.fieldDisabled() });
  });

  readonly changes: string[] = [];
}

describe('Input', () => {
  let fixture: ComponentFixture<Host>;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('reflects the signal form value onto the inner input', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    expect(input.value).toBe('Ada');
    expect(input.disabled).toBe(false);
  });

  it('updates the form field when the user types', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const event = new Event('input', { bubbles: true });

    input.value = 'Grace';
    input.dispatchEvent(event);
    fixture.detectChanges();

    expect(fixture.componentInstance.f.name().value()).toBe('Grace');
    expect(fixture.componentInstance.f.name().dirty()).toBe(true);
    expect(fixture.componentInstance.f().dirty()).toBe(true);
    fixture.componentInstance.f().reset();
    expect(fixture.componentInstance.f().dirty()).toBe(false);
  });

  it('does not mark loaded values as unsaved user edits', async () => {
    fixture.componentInstance.model.update((value) => ({ ...value, name: 'Loaded sample' }));
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    expect(input.value).toBe('Loaded sample');
    expect(fixture.componentInstance.f().dirty()).toBe(false);
    expect(fixture.componentInstance.changes).toEqual([]);
  });

  it('does not expose an enabled input while writing a newly loaded model value', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const disabledDuringWrites: boolean[] = [];
    const write = vi.spyOn(input, 'value', 'set').mockImplementation((value: string) => {
      disabledDuringWrites.push(input.disabled);
      setter?.call(input, value);
    });

    fixture.componentInstance.model.update((value) => ({ ...value, name: '7000.00' }));
    await fixture.whenStable();

    expect(disabledDuringWrites).toEqual([true]);
    expect(input.value).toBe('7000.00');
    expect(input.disabled).toBe(false);
    write.mockRestore();
  });

  it('keeps select-all replacement and the following render from appending to a loaded amount', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    fixture.componentInstance.model.update((value) => ({ ...value, name: '7000.00' }));
    await fixture.whenStable();
    input.focus();
    input.select();
    input.setRangeText('12000', input.selectionStart ?? 0, input.selectionEnd ?? 0, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    expect(input.value).toBe('12000');
    expect(input.selectionStart).toBe(5);
    expect(input.ownerDocument.activeElement).toBe(input);
    expect(fixture.componentInstance.f.name().value()).toBe('12000');
    expect(fixture.componentInstance.changes).toEqual(['12000']);
    expect(fixture.componentInstance.f.name().dirty()).toBe(true);
    expect(fixture.componentInstance.f.name().invalid()).toBe(false);
  });

  it('does not insert a pending replacement into a late-loaded value while synchronization is incomplete', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const host = fixture.componentInstance;

    host.model.update((value) => ({ ...value, name: '' }));
    await fixture.whenStable();
    input.focus();
    input.select();

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    let acceptedPendingInsertion = false;
    const replaceSelection = () => {
      input.setRangeText('12000', input.selectionStart ?? 0, input.selectionEnd ?? 0, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const write = vi.spyOn(input, 'value', 'set').mockImplementation((value: string) => {
      setter?.call(input, value);

      // A native value assignment collapses the earlier select-all selection.
      // Model the next insertion only if the control is still accepting input.
      acceptedPendingInsertion = !input.disabled;
    });

    host.model.update((value) => ({ ...value, name: '7000.00' }));
    await fixture.whenStable();

    expect(input.disabled).toBe(false);

    if (!acceptedPendingInsertion) {
      input.select();
    }

    replaceSelection();
    await fixture.whenStable();

    expect(input.value).toBe('12000');
    expect(host.f.name().value()).toBe('12000');
    expect(host.changes).toEqual(['12000']);
    write.mockRestore();
  });

  it('does not rewrite native typing or disturb a selection after an input event', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.focus();
    input.setRangeText('Grace', 0, input.value.length, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.setSelectionRange(1, 4, 'backward');

    const write = vi.spyOn(input, 'value', 'set');

    await fixture.whenStable();

    expect(write).not.toHaveBeenCalled();
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(4);
    expect(input.selectionDirection).toBe('backward');
    expect(input.ownerDocument.activeElement).toBe(input);
    expect(input.disabled).toBe(false);
    write.mockRestore();
  });

  it('preserves unchanged native values and selection when the bound field changes', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.focus();
    input.setSelectionRange(0, 2);

    const write = vi.spyOn(input, 'value', 'set');

    fixture.componentInstance.useOther.set(true);
    await fixture.whenStable();

    expect(write).not.toHaveBeenCalled();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);
    expect(input.ownerDocument.activeElement).toBe(input);
    input.setRangeText('E', 0, 2, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    expect(fixture.componentInstance.f.other().value()).toBe('Ea');
    expect(fixture.componentInstance.f.name().value()).toBe('Ada');
    write.mockRestore();
  });

  it('lets immediate native input supersede a pending programmatic value', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    fixture.componentInstance.model.update((value) => ({ ...value, name: '7000.00' }));
    input.value = '12000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    expect(input.value).toBe('12000');
    expect(input.disabled).toBe(false);
    expect(fixture.componentInstance.f.name().value()).toBe('12000');
  });

  it('preserves conditional and explicit disabled states through value synchronization', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const host = fixture.componentInstance;

    host.fieldDisabled.set(true);
    host.model.update((value) => ({ ...value, name: 'Loaded while disabled' }));
    await fixture.whenStable();

    expect(input.disabled).toBe(true);
    expect(input.value).toBe('Loaded while disabled');
    host.explicitDisabled.set(true);
    host.fieldDisabled.set(false);
    await fixture.whenStable();

    expect(input.disabled).toBe(true);
    host.explicitDisabled.set(false);
    await fixture.whenStable();

    expect(input.disabled).toBe(false);
  });

  it('keeps dynamic labels, help, autocomplete and validation associated with the native control', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const host = fixture.componentInstance;

    host.controlId.set('amount');
    host.descriptionId.set('amount-help');
    host.autocomplete.set('transaction-amount');
    host.inputmode.set('decimal');
    host.placeholder.set('Amount');
    host.controlName.set('amount');
    host.spellcheck.set(true);
    host.model.update((value) => ({ ...value, name: '' }));
    await fixture.whenStable();

    expect(input.labels?.[0]?.textContent).toBe('Planned amount');
    expect(input.id).toBe('amount');
    expect(fixture.nativeElement.querySelector('app-input').id).toBe('');
    expect(input.getAttribute('aria-describedby')).toBe('amount-help');
    expect(fixture.nativeElement.querySelector('#amount-help').textContent).toContain('Enter the planned amount.');
    expect(input.autocomplete).toBe('transaction-amount');
    expect(input.inputMode).toBe('decimal');
    expect(input.placeholder).toBe('Amount');
    expect(input.name).toBe('amount');
    expect(input.getAttribute('spellcheck')).toBe('true');
    expect(input.required).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('false');
    input.dispatchEvent(new Event('blur'));
    await fixture.whenStable();

    expect(host.f.name().touched()).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    host.model.update((value) => ({ ...value, name: '12' }));
    await fixture.whenStable();

    expect(input.getAttribute('aria-invalid')).toBe('false');
    host.explicitInvalid.set(true);
    host.isRequired.set(false);
    await fixture.whenStable();

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.required).toBe(false);
  });

  it('synchronizes a dynamic native type before restoring the model value', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const host = fixture.componentInstance;

    host.model.update((value) => ({ ...value, name: '2026-09-10' }));
    host.type.set('date');
    await fixture.whenStable();

    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-09-10');
    host.type.set('number');
    await fixture.whenStable();

    expect(input.value).toBe('');
    host.type.set('text');
    await fixture.whenStable();

    expect(input.value).toBe('2026-09-10');
  });
});

describe('Input server rendering', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the labeled control disabled without imperative browser value writes', async () => {
    // Angular's render callbacks use the server runtime flag, not PLATFORM_ID alone.
    vi.stubGlobal('ngServerMode', true);
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();

    const write = vi.spyOn(HTMLInputElement.prototype, 'value', 'set');
    const fixture = TestBed.createComponent(Host);

    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    expect(write).not.toHaveBeenCalled();
    expect(input.disabled).toBe(true);
    expect(input.labels?.[0]?.textContent).toBe('Planned amount');
    expect(input.getAttribute('aria-describedby')).toBe('name-help');
    fixture.componentInstance.model.update((value) => ({ ...value, name: 'Server update' }));
    await fixture.whenStable();

    expect(write).not.toHaveBeenCalled();
    expect(input.disabled).toBe(true);
    write.mockRestore();
  });
});

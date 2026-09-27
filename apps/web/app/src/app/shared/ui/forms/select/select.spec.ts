import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { disabled, form, required, type FieldTree } from '@angular/forms/signals';

import { Select } from './select';
import { SelectOptions } from './select-options';

@Component({
  imports: [Select],
  template: `
    <label i18n="@@SelectSpecTemplateText2" for="role-select">Role</label>
    <app-select controlId="role-select" [formField]="f.role">
      <option i18n="@@SelectSpecTemplateText1" value="">Choose a role</option>
      @for (role of roles(); track role) {
        <option [value]="role">{{ role }}</option>
      }
    </app-select>
  `,
})
class Host {
  readonly model = signal({ role: 'member' });
  readonly locked = signal(false);
  readonly roles = signal(['admin', 'member']);

  readonly f: FieldTree<{ role: string }> = form(this.model, (path) => {
    disabled(path.role, { when: () => this.locked() });
    required(path.role);
  });
}

@Component({
  imports: [Select, SelectOptions],
  template: `
    <app-select [formField]="f.role">
      <ng-template appSelectOptions>
        @for (role of roles(); track role) {
          <option [value]="role">{{ role }}</option>
        }
      </ng-template>
    </app-select>
  `,
})
class TemplateHost {
  readonly model = signal({ role: 'member' });
  readonly roles = signal<string[]>([]);

  readonly f = form(this.model);
}

describe('Select templates', () => {
  it('selects late template options and propagates user changes', async () => {
    await TestBed.configureTestingModule({ imports: [TemplateHost] }).compileComponents();
    const fixture = TestBed.createComponent(TemplateHost);

    await fixture.whenStable();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;

    expect(select.value).toBe('');
    fixture.componentInstance.roles.set(['admin', 'member']);
    await fixture.whenStable();
    expect(select.value).toBe('member');
    select.value = 'admin';
    select.dispatchEvent(new Event('change'));
    select.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(fixture.componentInstance.model().role).toBe('admin');
    expect(fixture.componentInstance.f.role().touched()).toBe(true);
  });
});

describe('Select', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('reflects the signal form value onto the inner select', () => {
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;

    expect(select.value).toBe('member');
  });

  it('connects the label to the native control without duplicate IDs', () => {
    const label = fixture.nativeElement.querySelector('label') as HTMLLabelElement;

    expect(label.control).toBe(fixture.nativeElement.querySelector('select'));
    expect(fixture.nativeElement.querySelectorAll('#role-select')).toHaveLength(1);
  });

  it('synchronizes disabled, touched and invalid states', async () => {
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;

    fixture.componentInstance.locked.set(true);
    await fixture.whenStable();
    expect(select.disabled).toBe(true);
    fixture.componentInstance.locked.set(false);
    await fixture.whenStable();
    expect(select.disabled).toBe(false);
    select.value = '';
    select.dispatchEvent(new Event('change'));
    select.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(fixture.componentInstance.model().role).toBe('');
    expect(fixture.componentInstance.f.role().touched()).toBe(true);
    expect(select.getAttribute('aria-invalid')).toBe('true');
  });

  it('selects projected options that arrive after the field value', async () => {
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;

    fixture.componentInstance.model.set({ role: 'viewer' });
    await fixture.whenStable();
    expect(select.value).toBe('');
    fixture.componentInstance.roles.set(['admin', 'member', 'viewer']);
    await fixture.whenStable();
    expect(select.value).toBe('viewer');
  });
});

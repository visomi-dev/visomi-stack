import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, type FieldTree } from '@angular/forms/signals';

import { Select } from './select';

@Component({
  imports: [FormField, Select],
  template: `
    <app-select [formField]="f.role">
      <option value="admin">Admin</option>
      <option value="member">Member</option>
    </app-select>
  `,
})
class Host {
  readonly model = signal({ role: 'member' });
  readonly f: FieldTree<{ role: string }> = form(this.model, () => undefined);
}

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
});

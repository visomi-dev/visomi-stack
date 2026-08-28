import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, type FieldTree } from '@angular/forms/signals';

import { Textarea } from './textarea';

@Component({
  imports: [FormField, Textarea],
  template: '<app-textarea [formField]="f.summary" />',
})
class Host {
  readonly model = signal({ summary: 'A short summary.' });
  readonly f: FieldTree<{ summary: string }> = form(this.model, () => undefined);
}

describe('Textarea', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('reflects the signal form value onto the inner textarea', () => {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;

    expect(textarea.value).toBe('A short summary.');
  });
});

import { CdkListbox } from '@angular/cdk/listbox';
import { Component, DebugElement, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { Listbox, type ListboxOption } from './listbox';

@Component({
  imports: [Listbox],
  template: '<app-listbox [options]="options" (valueChange)="selected.set($event)" />',
})
class Host {
  readonly options: ListboxOption[] = [
    { label: 'First', value: 'first' },
    { label: 'Second', value: 'second' },
    { label: 'Third', value: 'third' },
  ];
  readonly selected = signal('');
}

describe('Listbox', () => {
  let fixture: ComponentFixture<Host>;
  let listboxEl: DebugElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    listboxEl = fixture.debugElement.query(By.css('[role="listbox"]'));
  });

  it('renders options with listbox semantics', () => {
    const options = fixture.nativeElement.querySelectorAll('[role="option"]');

    expect(listboxEl).toBeTruthy();
    expect(options.length).toBe(3);
  });

  it('attaches the Angular CDK listbox directive', () => {
    expect(listboxEl.injector.get(CdkListbox)).toBeTruthy();
  });
});

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Button } from './button';

@Component({
  imports: [Button],
  template: '<app-button i18n="@@ButtonSpecTemplateText1" tone="blue" loading>Save</app-button>',
})
class Host {}

describe('Button', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders a native busy button', () => {
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.textContent).toContain('Save');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
  });

  it('exposes optional toggle state on the native control without changing ordinary actions', async () => {
    const action = TestBed.createComponent(Button);

    await action.whenStable();
    const button = action.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.hasAttribute('aria-pressed')).toBe(false);
    action.componentRef.setInput('pressed', true);
    await action.whenStable();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    action.componentRef.setInput('pressed', false);
    await action.whenStable();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    action.componentRef.setInput('pressed', null);
    await action.whenStable();
    expect(button.hasAttribute('aria-pressed')).toBe(false);
  });

  it('preserves native submit behavior, loading and explicit disabled state for toggle actions', async () => {
    const action = TestBed.createComponent(Button);

    action.componentRef.setInput('type', 'submit');
    action.componentRef.setInput('pressed', true);
    await action.whenStable();
    const button = action.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.type).toBe('submit');
    expect(button.disabled).toBe(false);
    action.componentRef.setInput('loading', true);
    await action.whenStable();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    action.componentRef.setInput('disabled', true);
    action.componentRef.setInput('loading', false);
    await action.whenStable();
    expect(button.disabled).toBe(true);
  });
});

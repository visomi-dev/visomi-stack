import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ErrorMessage } from './error-message';

@Component({
  imports: [ErrorMessage],
  template: '<app-error-message controlId="amount-error"> {{ message() }} </app-error-message>',
})
class Host {
  readonly message = signal('');
}

describe('Error message projection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('removes empty and whitespace-only messages from layout and restores changing validation text', async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);

    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const host = element.querySelector('app-error-message')!;
    const alert = element.querySelector('[role="alert"]')!;

    await vi.waitFor(() => expect(host.hasAttribute('data-empty')).toBe(true));
    expect(alert.id).toBe('amount-error');
    fixture.componentInstance.message.set('Enter a valid amount.');
    await fixture.whenStable();
    await vi.waitFor(() => expect(host.hasAttribute('data-empty')).toBe(false));
    expect(alert.textContent).toContain('Enter a valid amount.');
    fixture.componentInstance.message.set('   ');
    await fixture.whenStable();
    await vi.waitFor(() => expect(host.hasAttribute('data-empty')).toBe(true));
    fixture.componentInstance.message.set('This amount is required.');
    await fixture.whenStable();
    await vi.waitFor(() => expect(host.hasAttribute('data-empty')).toBe(false));
    expect(alert.id).toBe('amount-error');
  });

  it('disconnects its text observer when the field is destroyed', async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');

    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);

    await fixture.whenStable();
    fixture.destroy();
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
  });

  it('keeps projected server text accessible without starting a browser observer', async () => {
    vi.stubGlobal('ngServerMode', true);
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');

    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);

    fixture.componentInstance.message.set('Enter a valid amount.');
    await fixture.whenStable();
    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');

    expect(alert?.textContent).toContain('Enter a valid amount.');
    expect(alert?.id).toBe('amount-error');
    expect(observe).not.toHaveBeenCalled();
  });
});

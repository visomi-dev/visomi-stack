import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Button } from './ui/button';

import type { ButtonSize, ButtonVariant } from '@visomi-stack/web-frontend-ui';

@Component({
  imports: [Button],
  template: `<button
    ui
    [variant]="variant()"
    [size]="size()"
    [disabled]="disabled()"
    [type]="type()"
    aria-label="Example action"
    (click)="activated()"
  >
    Action
  </button>`,
})
class NativeButton {
  readonly variant = signal<ButtonVariant>('primary');
  readonly size = signal<ButtonSize>('md');
  readonly disabled = signal(false);
  readonly type = signal<'button' | 'submit'>('button');

  readonly activated = vi.fn();
}

describe('native Angular button', () => {
  it('preserves native attributes and events when changing visual options', async () => {
    const fixture = TestBed.createComponent(NativeButton);

    await fixture.whenStable();

    const element = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(element.type).toBe('button');
    expect(element.getAttribute('aria-label')).toBe('Example action');
    element.click();
    expect(fixture.componentInstance.activated).toHaveBeenCalledOnce();
    fixture.componentInstance.variant.set('secondary');
    fixture.componentInstance.size.set('sm');

    await fixture.whenStable();

    expect(element.classList.contains('border-zinc-500')).toBe(true);
    expect(element.classList.contains('px-3')).toBe(true);
    expect(element.classList.contains('bg-blue-600')).toBe(false);
    fixture.componentInstance.disabled.set(true);

    await fixture.whenStable();

    expect(element.disabled).toBe(true);
    element.click();
    expect(fixture.componentInstance.activated).toHaveBeenCalledOnce();
  });

  it('preserves native form submission', async () => {
    const fixture = TestBed.createComponent(NativeButton);
    const form = document.createElement('form');
    const submitted = vi.fn((event: Event) => event.preventDefault());

    fixture.componentInstance.type.set('submit');

    await fixture.whenStable();

    form.addEventListener('submit', submitted);
    form.append(fixture.nativeElement);
    document.body.append(form);

    try {
      const element = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

      expect(element.form).toBe(form);
      element.click();
      expect(submitted).toHaveBeenCalledOnce();
    } finally {
      form.remove();
    }
  });
});

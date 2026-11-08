import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ThemeSelect } from './theme-select';
import { Theme } from './theme';
import { ThemeHost } from './theme-host';
import { ThemeSwitcher } from './theme-switcher';

@Component({
  imports: [ThemeSelect, ThemeSwitcher],
  hostDirectives: [ThemeHost],
  template: `
    <button app-theme-switcher aria-label="Dark theme"></button>

    <select appUITheme aria-label="First appearance">
      <option value="system">System</option>

      <option value="light">Light</option>

      <option value="dark">Dark</option>
    </select>

    <select appUITheme aria-label="Second appearance">
      <option value="system">System</option>

      <option value="light">Light</option>

      <option value="dark">Dark</option>
    </select>
  `,
})
class ThemeControls {}

describe('native theme selectors', () => {
  let systemDark: boolean;
  let media: MediaQueryList;
  const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

  beforeEach(() => {
    systemDark = false;
    media = Object.assign(new EventTarget(), { media: '(prefers-color-scheme: dark)' }) as MediaQueryList;
    Object.defineProperty(media, 'matches', { get: () => systemDark });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => media });
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.style.removeProperty('color-scheme');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.style.removeProperty('color-scheme');

    if (originalMatchMedia) {
      Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    } else {
      Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('restores persisted preferences and synchronizes multiple native controls', async () => {
    localStorage.setItem('visomi.theme', 'dark');
    const fixture = TestBed.createComponent(ThemeControls);

    await fixture.whenStable();

    const controls = fixture.nativeElement.querySelectorAll('select') as NodeListOf<HTMLSelectElement>;
    const switcher = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect((fixture.nativeElement as HTMLElement).classList.contains('dark')).toBe(true);
    expect((fixture.nativeElement as HTMLElement).getAttribute('style')).toBeNull();
    expect(TestBed.inject(Theme).colorScheme()).toBe('dark');
    expect(switcher.type).toBe('button');
    expect(switcher.getAttribute('aria-pressed')).toBe('true');
    expect(switcher.disabled).toBe(false);
    expect(Array.from(controls, (control) => control.value)).toEqual(['dark', 'dark']);
    controls[0].value = 'light';
    controls[0].dispatchEvent(new Event('change'));

    await fixture.whenStable();

    expect(Array.from(controls, (control) => control.value)).toEqual(['light', 'light']);
    expect(localStorage.getItem('visomi.theme')).toBe('light');
    expect((fixture.nativeElement as HTMLElement).classList.contains('dark')).toBe(false);
    expect(TestBed.inject(Theme).isDark()).toBe(false);
    expect(switcher.getAttribute('aria-pressed')).toBe('false');
    switcher.click();

    await fixture.whenStable();

    expect(switcher.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('visomi.theme')).toBe('dark');
    expect(Array.from(controls, (control) => control.value)).toEqual(['dark', 'dark']);
  });

  it('follows system changes and releases the media listener with its injector', async () => {
    const removed = vi.spyOn(media, 'removeEventListener');
    const fixture = TestBed.createComponent(ThemeControls);

    await fixture.whenStable();

    systemDark = true;
    media.dispatchEvent(new Event('change'));

    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).classList.contains('dark')).toBe(true);
    expect(TestBed.inject(Theme).preference()).toBe('system');
    expect(localStorage.getItem('visomi.theme')).toBeNull();
    TestBed.resetTestingModule();
    expect(removed).toHaveBeenCalledWith('change', expect.any(Function));
  });
});

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { By } from '@angular/platform-browser';

import { Auth } from '../auth/auth';
import { AccountProfile } from '../auth/account-profile';
import { Settings } from '../settings';
import { AppUpdates } from '../app-updates';
import { VaultSession } from '../../vault/vault-session';

import { Layout } from './layout';

describe('Layout mobile navigation', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Layout],
      providers: [
        provideRouter([]),
        { provide: VaultSession, useValue: { startLifecycle: () => () => undefined } },
        { provide: Auth, useValue: { isAuthenticated: signal(false), user: signal(null) } },
        { provide: Settings, useValue: { applyTheme: vi.fn(), isDark: signal(false) } },
        { provide: AccountProfile, useValue: { synchronizePreferences: vi.fn() } },
      ],
    });
  });

  it('returns keyboard focus to the opener when mobile navigation closes', async () => {
    const fixture = TestBed.createComponent(Layout);
    const opener = document.createElement('button');

    document.body.append(opener);
    try {
      await fixture.whenStable();
      opener.focus();
      fixture.componentInstance.openMobileMenu();
      await fixture.whenStable();
      opener.blur();
      fixture.componentInstance.closeMobileMenu();
      await fixture.whenStable();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it('does not focus a stale opener removed by route navigation', async () => {
    const fixture = TestBed.createComponent(Layout);
    const opener = document.createElement('button');

    document.body.append(opener);
    await fixture.whenStable();
    opener.focus();
    fixture.componentInstance.openMobileMenu();
    await fixture.whenStable();
    opener.remove();
    const focus = vi.spyOn(opener, 'focus');

    fixture.componentInstance.closeMobileMenu();
    await fixture.whenStable();
    expect(focus).not.toHaveBeenCalled();
  });

  it('shows an update notice in the authenticated shell and reloads only on explicit action', async () => {
    const ready = signal(false);
    const reload = vi.fn();
    const stop = vi.fn();

    TestBed.overrideProvider(Auth, { useValue: { isAuthenticated: signal(true), user: signal(null) } });
    TestBed.overrideProvider(AppUpdates, { useValue: { ready, reload, start: () => stop } });
    const fixture = TestBed.createComponent(Layout);

    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('aside[role="status"]')).toBeNull();
    ready.set(true);
    await fixture.whenStable();
    const notice = fixture.nativeElement.querySelector('aside[role="status"]') as HTMLElement;

    expect(notice.textContent).toContain('Reload when you have saved your work');
    expect(reload).not.toHaveBeenCalled();
    notice.querySelector('button')?.click();
    expect(reload).toHaveBeenCalledOnce();
    fixture.destroy();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('traps the open drawer and makes background content inert until navigation closes', async () => {
    TestBed.overrideProvider(Auth, { useValue: { isAuthenticated: signal(true), user: signal(null) } });
    const fixture = TestBed.createComponent(Layout);

    await fixture.whenStable();
    const drawer = fixture.debugElement.query(By.directive(CdkTrapFocus));
    const trap = drawer.injector.get(CdkTrapFocus);
    const content = fixture.nativeElement.querySelector('section') as HTMLElement;

    expect(trap.enabled).toBe(false);
    expect(content.hasAttribute('inert')).toBe(false);
    fixture.componentInstance.openMobileMenu();
    await fixture.whenStable();
    expect(trap.enabled).toBe(true);
    expect(trap.autoCapture).toBe(false);
    expect(content.hasAttribute('inert')).toBe(true);
    drawer.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(trap.enabled).toBe(false);
    expect(content.hasAttribute('inert')).toBe(false);
  });

  it('focuses the rendered close control every time the mobile drawer opens', async () => {
    TestBed.overrideProvider(Auth, { useValue: { isAuthenticated: signal(true), user: signal(null) } });
    const fixture = TestBed.createComponent(Layout);

    await fixture.whenStable();
    const drawer = fixture.debugElement.query(By.directive(CdkTrapFocus)).nativeElement as HTMLElement;
    const close = drawer.querySelector('button[aria-label="Close navigation"]') as HTMLButtonElement;
    const focus = vi.spyOn(close, 'focus');

    fixture.componentInstance.openMobileMenu();
    await fixture.whenStable();
    expect(focus).toHaveBeenCalledOnce();
    fixture.componentInstance.closeMobileMenu();
    await fixture.whenStable();
    expect(focus).toHaveBeenCalledOnce();
    fixture.componentInstance.openMobileMenu();
    await fixture.whenStable();
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('releases mobile focus containment on desktop resize and removes its owned listener', async () => {
    let listener: (() => void) | undefined;
    const media = {
      matches: false,
      addEventListener: vi.fn((_event: string, callback: () => void) => {
        listener = callback;
      }),
      removeEventListener: vi.fn(),
    };
    const previous = Object.getOwnPropertyDescriptor(window, 'matchMedia');

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => media as unknown as MediaQueryList),
    });
    const fixture = TestBed.createComponent(Layout);

    try {
      await fixture.whenStable();
      fixture.componentInstance.openMobileMenu();
      await fixture.whenStable();
      expect(fixture.componentInstance.mobileMenuOpen()).toBe(true);
      media.matches = true;
      listener?.();
      await fixture.whenStable();
      expect(fixture.componentInstance.mobileMenuOpen()).toBe(false);
      fixture.destroy();
      expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
    } finally {
      if (previous) Object.defineProperty(window, 'matchMedia', previous);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });
});

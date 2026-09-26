import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { Settings } from './settings';
import { BrowserSettings } from './browser-settings';
import { ServerSettings } from './server-settings';

describe('BrowserSettings', () => {
  let media: EventTarget & { matches: boolean };
  const assignLocale = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    assignLocale.mockReset();
    media = Object.assign(new EventTarget(), { matches: false });
    document.documentElement.classList.remove('dark');
    document.documentElement.lang = 'en';

    TestBed.configureTestingModule({
      providers: [
        BrowserSettings,
        { provide: Settings, useExisting: BrowserSettings },
        {
          provide: DOCUMENT,
          useValue: {
            documentElement: document.documentElement,
            defaultView: { localStorage, sessionStorage, matchMedia: () => media, location: { assign: assignLocale } },
          },
        },
      ],
    });
  });

  it('toggles theme and persists it', () => {
    const settings = TestBed.inject(Settings);

    const initialDark = settings.isDark();

    settings.toggleTheme();

    expect(settings.isDark()).toBe(!initialDark);
    expect(localStorage.getItem('themis.theme')).toBe(initialDark ? 'light' : 'dark');
  });

  it('applyTheme syncs the dark class on <html> with the current theme', () => {
    document.documentElement.classList.remove('dark');
    const settings = TestBed.inject(Settings);

    settings.applyTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(settings.isDark());

    settings.setTheme('dark');
    settings.applyTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    settings.setTheme('light');
    settings.applyTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  function changeSystemTheme(dark: boolean): void {
    media.matches = dark;
    media.dispatchEvent(Object.assign(new Event('change'), { matches: dark }));
  }

  it('follows system changes only while the system preference is selected and cleans up its listener', () => {
    const removeListener = vi.spyOn(media, 'removeEventListener');
    const settings = TestBed.inject(Settings);

    settings.applyProfilePreferences('user', { locale: 'en', theme: 'system' }, '/account', 'save');
    changeSystemTheme(true);
    settings.applyTheme();
    expect(settings.theme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    settings.setTheme('light');
    changeSystemTheme(false);
    changeSystemTheme(true);
    expect(settings.theme()).toBe('light');
    settings.applyProfilePreferences('user', { locale: 'en', theme: 'system' }, '/account', 'save');
    expect(settings.theme()).toBe('dark');
    changeSystemTheme(false);
    expect(settings.theme()).toBe('light');
    TestBed.resetTestingModule();
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('honors a local toolbar override at login, but an explicit profile save replaces it immediately', () => {
    localStorage.setItem('themis.theme', 'light');
    const settings = TestBed.inject(Settings);

    settings.applyProfilePreferences('user', { locale: 'en', theme: 'dark' }, '/account', 'login');
    expect(settings.theme()).toBe('light');
    settings.applyProfilePreferences('user', { locale: 'en', theme: 'dark' }, '/account', 'save');
    expect(settings.theme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('themis.theme')).toBeNull();
    settings.toggleTheme();
    settings.applyProfilePreferences('user', { locale: 'en', theme: 'dark' }, '/account', 'login');
    expect(settings.theme()).toBe('light');
  });

  it('applies a saved locale once per identity/tab and preserves the route, query, and fragment', () => {
    const settings = TestBed.inject(Settings);

    settings.applyProfilePreferences(
      'user',
      { locale: 'es', theme: 'system' },
      '/account?section=profile#name',
      'login',
    );
    expect(assignLocale).toHaveBeenCalledWith('/app/es/account?section=profile#name');
    assignLocale.mockClear();
    // An English toolbar navigation reloads the app; the per-tab marker survives.
    settings.applyProfilePreferences('user', { locale: 'es', theme: 'system' }, '/account', 'login');
    expect(assignLocale).not.toHaveBeenCalled();
    settings.applyProfilePreferences('user', { locale: 'es', theme: 'dark' }, '/account', 'save');
    expect(assignLocale).toHaveBeenCalledWith('/app/es/account');
    assignLocale.mockClear();
    document.documentElement.lang = 'es';
    settings.applyProfilePreferences('user', { locale: 'es', theme: 'dark' }, '/account', 'save');
    expect(assignLocale).not.toHaveBeenCalled();
  });

  it('does not redirect to external paths and applies theme when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    const settings = TestBed.inject(Settings);

    settings.applyProfilePreferences('user', { locale: 'es', theme: 'dark' }, '/account', 'login');
    expect(settings.theme()).toBe('dark');
    expect(assignLocale).not.toHaveBeenCalled();
    settings.applyProfilePreferences('user', { locale: 'es', theme: 'light' }, '//evil.example', 'save');
    expect(assignLocale).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('ServerSettings', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');

    TestBed.configureTestingModule({
      providers: [ServerSettings, { provide: Settings, useExisting: ServerSettings }],
    });
  });

  it('defaults to light and does not touch the DOM', () => {
    const settings = TestBed.inject(Settings);

    expect(settings.theme()).toBe('light');
    expect(settings.isDark()).toBe(false);

    settings.applyTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    settings.toggleTheme();
    settings.applyProfilePreferences('user', { locale: 'es', theme: 'dark' }, '/account', 'save');

    expect(settings.theme()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

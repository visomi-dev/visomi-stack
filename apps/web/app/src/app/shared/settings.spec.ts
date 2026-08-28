import { TestBed } from '@angular/core/testing';

import { Settings } from './settings';
import { BrowserSettings } from './browser-settings';
import { ServerSettings } from './server-settings';

describe('BrowserSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');

    TestBed.configureTestingModule({
      providers: [BrowserSettings, { provide: Settings, useExisting: BrowserSettings }],
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

    expect(settings.theme()).toBe('light');
  });
});

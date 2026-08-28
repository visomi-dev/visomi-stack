import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { appRoutes } from './app.routes';
import { Auth } from './shared/auth/auth';
import { BrowserAuth } from './shared/auth/browser-auth';
import { BrowserClipboard } from './shared/clipboard/browser-clipboard';
import { Clipboard } from './shared/clipboard/clipboard';
import { BrowserRealtime } from './shared/realtime/browser-realtime';
import { Realtime } from './shared/realtime/realtime';
import { BrowserSettings } from './shared/browser-settings';
import { Settings } from './shared/settings';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideRouter(appRoutes),
        { provide: Auth, useExisting: BrowserAuth },
        { provide: Settings, useExisting: BrowserSettings },
        { provide: Realtime, useExisting: BrowserRealtime },
        { provide: Clipboard, useExisting: BrowserClipboard },
      ],
    }).compileComponents();
  });

  it('should create the application shell', () => {
    const fixture = TestBed.createComponent(App);

    expect(fixture.componentInstance).toBeTruthy();
  });
});

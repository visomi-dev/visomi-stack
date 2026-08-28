import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Auth } from '../../shared/auth/auth';
import { BrowserAuth } from '../../shared/auth/browser-auth';
import { BrowserClipboard } from '../../shared/clipboard/browser-clipboard';
import { Clipboard } from '../../shared/clipboard/clipboard';
import { BrowserSettings } from '../../shared/browser-settings';
import { Settings } from '../../shared/settings';

import { VerifyDevice } from './verify-device';

describe('VerifyDevice', () => {
  let component: VerifyDevice;
  let fixture: ComponentFixture<VerifyDevice>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VerifyDevice],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Auth, useExisting: BrowserAuth },
        { provide: Settings, useExisting: BrowserSettings },
        { provide: Clipboard, useExisting: BrowserClipboard },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VerifyDevice);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

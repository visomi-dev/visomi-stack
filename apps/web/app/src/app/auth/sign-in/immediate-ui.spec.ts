import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Auth } from '../../shared/auth/auth';
import { GoogleIdentity } from '../../shared/auth/google-identity';
import { Passkey } from '../../shared/auth/passkey';
import { PasswordAuth } from '../../shared/auth/password';
import { Settings } from '../../shared/settings';

import { SignIn } from './sign-in';

describe('SignIn direct passkey access', () => {
  const credential = { id: 'local-passkey', type: 'public-key' };
  const options = { challenge: 'AQID', rpId: 'localhost' };
  let immediateSupported: boolean;
  let passkeySupported: boolean;
  let expiresAt: string;
  const getImmediateCredential = vi.fn();
  const getCredential = vi.fn();
  const completeAuthentication = vi.fn();
  const beginAuthentication = vi.fn();
  const ensureSessionLoaded = vi.fn();

  beforeEach(async () => {
    immediateSupported = true;
    passkeySupported = true;
    expiresAt = new Date(Date.now() + 60_000).toISOString();
    getImmediateCredential.mockReset().mockResolvedValue(credential);
    getCredential.mockReset().mockResolvedValue(credential);
    completeAuthentication.mockReset().mockResolvedValue({ authenticated: true });
    ensureSessionLoaded.mockReset().mockResolvedValue(undefined);
    beginAuthentication.mockReset().mockImplementation(async () => ({ challengeId: 'challenge', options, expiresAt }));
    await TestBed.configureTestingModule({
      imports: [SignIn],
      providers: [
        provideRouter([]),
        {
          provide: Auth,
          useValue: {
            startIdentityFlow: vi.fn().mockResolvedValue({ flowId: 'identity' }),
            ensureSessionLoaded,
          },
        },
        {
          provide: Passkey,
          useValue: {
            isSupported: () => passkeySupported,
            supportsConditionalAuthentication: async () => false,
            supportsImmediateAuthentication: async () => immediateSupported,
            beginAuthentication,
            getImmediateCredential,
            getCredential,
            completeAuthentication,
          },
        },
        { provide: GoogleIdentity, useValue: { renderButton: vi.fn() } },
        { provide: PasswordAuth, useValue: {} },
        { provide: Settings, useValue: { isDark: () => false, toggleTheme: vi.fn() } },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  async function render() {
    const fixture = TestBed.createComponent(SignIn);

    fixture.detectChanges();
    const dialog: HTMLDialogElement = fixture.nativeElement.querySelector('dialog');

    dialog.showModal = vi.fn(() => {
      dialog.open = true;
    });
    dialog.close = vi.fn(() => {
      dialog.open = false;
    });
    await fixture.whenStable();

    if (immediateSupported) {
      await vi.waitFor(() => expect(beginAuthentication).toHaveBeenCalledOnce());
      await Promise.resolve();
    }

    return fixture;
  }

  function click(element: HTMLElement, label: string): void {
    const button = [...element.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);

    if (!button) {
      throw new Error(`Missing button: ${label}`);
    }

    button.click();
  }

  it('requests immediate UI synchronously from Continue after preparing a challenge', async () => {
    const fixture = await render();

    expect(getImmediateCredential).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    click(fixture.nativeElement, 'Continue');
    expect(getImmediateCredential).toHaveBeenCalledExactlyOnceWith(options);
    await fixture.whenStable();
    expect(completeAuthentication).toHaveBeenCalledExactlyOnceWith('challenge', credential);
    expect(ensureSessionLoaded).toHaveBeenCalledWith(true);
  });

  it('requests a regular passkey without requiring an email when Immediate UI is unsupported', async () => {
    immediateSupported = false;
    const fixture = await render();

    click(fixture.nativeElement, 'Continue');
    await fixture.whenStable();
    expect(getCredential).toHaveBeenCalledWith(options, { signal: expect.any(AbortSignal) });
    expect(completeAuthentication).toHaveBeenCalledWith('challenge', credential);
    expect(fixture.componentInstance.methodsOpen()).toBe(false);
  });

  it('exposes regular credential waiting as a status rather than a disabled action', async () => {
    immediateSupported = false;
    let resolveCredential!: (value: typeof credential) => void;

    getCredential.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCredential = resolve;
        }),
    );
    const fixture = await render();

    click(fixture.nativeElement, 'Continue');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Waiting for passkey');
    expect(fixture.nativeElement.querySelector('button[disabled]')).toBeNull();
    resolveCredential(credential);
    await vi.waitFor(() => expect(fixture.componentInstance.state()).toBe('success'));
    await fixture.whenStable();
  });

  it('blocks alternate methods while a selected credential is being verified', async () => {
    let complete!: () => void;

    completeAuthentication.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const fixture = await render();

    click(fixture.nativeElement, 'Continue');
    await fixture.whenStable();
    const alternate = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => button.textContent?.trim() === 'Use another method',
    );

    expect(alternate.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Verifying your passkey');
    complete();
    await vi.waitFor(() => expect(fixture.componentInstance.state()).toBe('success'));
    await fixture.whenStable();
  });

  it('uses a fresh regular challenge when the prepared Immediate UI challenge expires', async () => {
    expiresAt = new Date(Date.now() - 1000).toISOString();
    const fixture = await render();

    click(fixture.nativeElement, 'Continue');
    await fixture.whenStable();
    expect(beginAuthentication).toHaveBeenCalledTimes(2);
    expect(getCredential).toHaveBeenCalled();
    expect(getImmediateCredential).not.toHaveBeenCalled();
  });

  it('opens other methods explicitly without prompting for a credential', async () => {
    const fixture = await render();

    click(fixture.nativeElement, 'Use another method');
    await fixture.whenStable();
    expect(fixture.componentInstance.methodsOpen()).toBe(true);
    expect(getCredential).not.toHaveBeenCalled();
    expect(getImmediateCredential).not.toHaveBeenCalled();
  });

  it('opens other methods when WebAuthn is unavailable', async () => {
    immediateSupported = false;
    passkeySupported = false;
    const fixture = await render();

    click(fixture.nativeElement, 'Continue');
    await fixture.whenStable();
    expect(fixture.componentInstance.methodsOpen()).toBe(true);
    expect(getCredential).not.toHaveBeenCalled();
  });

  it.each(['NotAllowedError', 'AbortError'])('offers fallback after immediate cancellation: %s', async (name) => {
    getImmediateCredential.mockRejectedValue(new DOMException('Cancelled', name));
    const fixture = await render();

    click(fixture.nativeElement, 'Continue');
    await fixture.whenStable();
    expect(fixture.componentInstance.methodsOpen()).toBe(true);
    expect(fixture.componentInstance.errorMessage()).toBe('');
    expect(completeAuthentication).not.toHaveBeenCalled();
  });

  it('shows a verification error instead of silently opening fallback after credential selection', async () => {
    completeAuthentication.mockRejectedValue(new Error('Verification rejected'));
    const fixture = await render();

    click(fixture.nativeElement, 'Continue');
    await fixture.whenStable();
    expect(fixture.componentInstance.state()).toBe('passkey-error');
    expect(fixture.componentInstance.errorMessage()).toBe('We could not verify that passkey.');
    expect(fixture.componentInstance.methodsOpen()).toBe(false);
    expect(ensureSessionLoaded).not.toHaveBeenCalled();
  });
});

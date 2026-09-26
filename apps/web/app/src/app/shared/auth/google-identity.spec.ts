import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { GoogleIdentity } from './google-identity';

describe('GoogleIdentity', () => {
  it('passes fresh reauthentication tokens once while pending and ignores stale provider callbacks', async () => {
    let callback: ((response: { credential: string }) => Promise<void>) | undefined;
    let active = true;
    let finish: (() => void) | undefined;
    const receive = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const initialize = vi.fn((config: { callback: typeof callback }) => {
      callback = config.callback;
    });
    const renderButton = vi.fn();
    const documentStub = {
      createElement: () => document.createElement('script'),
      defaultView: { google: { accounts: { id: { initialize, renderButton } } } },
      head: {
        appendChild: (script: HTMLScriptElement) => {
          script.onload?.(new Event('load'));

          return script;
        },
      },
    } as unknown as Document;
    const post = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        GoogleIdentity,
        { provide: DOCUMENT, useValue: documentStub },
        { provide: HttpClient, useValue: { post } },
      ],
    });
    const element = document.createElement('div');

    await TestBed.inject(GoogleIdentity).renderReauthenticationButton(
      element,
      'client',
      'fresh-nonce',
      receive,
      () => active,
    );
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'client', nonce: 'fresh-nonce' }));
    expect(renderButton).toHaveBeenCalledWith(element, expect.objectContaining({ type: 'standard' }));
    const first = callback!({ credential: 'fresh-token' });

    await callback!({ credential: 'duplicate' });
    expect(receive).toHaveBeenCalledExactlyOnceWith('fresh-token');
    active = false;
    finish!();
    await first;
    await callback!({ credential: 'stale' });
    expect(receive).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalled();
  });

  it('does not send stale or duplicate Google linking callbacks', async () => {
    let callback: ((response: { credential: string }) => Promise<void>) | undefined;
    let active = true;
    const pending = new Subject<unknown>();
    const post = vi.fn(() => pending);
    const complete = vi.fn();
    const documentStub = {
      createElement: () => document.createElement('script'),
      defaultView: {
        google: {
          accounts: {
            id: {
              initialize: (config: { callback: typeof callback }) => {
                callback = config.callback;
              },
              renderButton: vi.fn(),
            },
          },
        },
      },
      head: {
        appendChild: (script: HTMLScriptElement) => {
          script.onload?.(new Event('load'));

          return script;
        },
      },
    } as unknown as Document;

    TestBed.configureTestingModule({
      providers: [
        GoogleIdentity,
        { provide: DOCUMENT, useValue: documentStub },
        { provide: HttpClient, useValue: { post } },
      ],
    });
    await TestBed.inject(GoogleIdentity).renderLinkButton(
      document.createElement('div'),
      'client',
      'grant',
      'nonce',
      complete,
      vi.fn(),
      () => active,
    );
    const first = callback!({ credential: 'test-credential' });

    await callback!({ credential: 'duplicate' });
    expect(post).toHaveBeenCalledOnce();
    pending.next({});
    pending.complete();
    await first;
    expect(complete).toHaveBeenCalledOnce();
    active = false;
    await callback!({ credential: 'late' });
    expect(post).toHaveBeenCalledOnce();
  });
  it('passes the identity-flow nonce to Google Identity Services', async () => {
    const initialize = vi.fn();
    const appendChild = vi.fn((script: HTMLScriptElement) => {
      script.onload?.(new Event('load'));

      return script;
    });
    const documentStub = {
      createElement: () => document.createElement('script'),
      defaultView: {
        google: { accounts: { id: { initialize, renderButton: vi.fn() } } },
      },
      head: { appendChild },
    } as unknown as Document;

    TestBed.configureTestingModule({
      providers: [
        GoogleIdentity,
        { provide: DOCUMENT, useValue: documentStub },
        { provide: HttpClient, useValue: { post: vi.fn() } },
      ],
    });

    await TestBed.inject(GoogleIdentity).renderButton(
      document.createElement('div'),
      'google-client',
      'identity-flow',
      'google-nonce',
      vi.fn(),
    );

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 'google-nonce', use_fedcm_for_prompt: true, use_fedcm_for_button: true }),
    );
  });
});

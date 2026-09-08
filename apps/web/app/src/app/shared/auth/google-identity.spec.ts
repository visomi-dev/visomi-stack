import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { GoogleIdentity } from './google-identity';

describe('GoogleIdentity', () => {
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

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'google-nonce' }));
  });
});

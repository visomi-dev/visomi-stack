import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Auth } from '../../shared/auth/auth';
import { GoogleIdentity } from '../../shared/auth/google-identity';
import { SecurityAction } from '../../shared/auth/security-action';

import { GoogleLink } from './google-link';

describe('GoogleLink', () => {
  async function setup() {
    const run = vi.fn(async (_context: unknown, execute: (grantId: string) => Promise<void>) => execute('grant'));
    const renderLinkButton = vi.fn<GoogleIdentity['renderLinkButton']>().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [GoogleLink],
      providers: [
        {
          provide: Auth,
          useValue: {
            startIdentityFlow: vi
              .fn()
              .mockResolvedValue({ google: { enabled: true, clientId: 'client' }, nonce: 'nonce' }),
          },
        },
        { provide: GoogleIdentity, useValue: { renderLinkButton } },
      ],
    })
      .overrideComponent(GoogleLink, {
        set: { imports: [], schemas: [NO_ERRORS_SCHEMA], providers: [{ provide: SecurityAction, useValue: { run } }] },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(GoogleLink);

    await fixture.whenStable();
    const start = (fixture.nativeElement as HTMLElement).querySelector('button')!;

    start.click();
    await fixture.whenStable();

    return { fixture, start, run, renderLinkButton };
  }

  it('removes the start action after confirmation and prevents another password challenge', async () => {
    const { fixture, start, run, renderLinkButton } = await setup();

    expect(renderLinkButton).toHaveBeenCalledOnce();
    expect((fixture.nativeElement as HTMLElement).querySelector('button')).toBeNull();
    start.click();
    await fixture.whenStable();
    expect(run).toHaveBeenCalledOnce();
  });

  it('allows a fresh attempt after linking fails and ignores the old callback', async () => {
    const { fixture, run, renderLinkButton } = await setup();
    const args = renderLinkButton.mock.calls[0];

    args[5]?.(new Error('Expired grant'));
    await fixture.whenStable();
    expect(args[6]?.()).toBe(false);
    const retry = (fixture.nativeElement as HTMLElement).querySelector('button');

    expect(retry).not.toBeNull();
    retry!.click();
    await fixture.whenStable();
    expect(run).toHaveBeenCalledTimes(2);
    args[4]();
    expect(fixture.componentInstance.linked()).toBe(false);
  });
});

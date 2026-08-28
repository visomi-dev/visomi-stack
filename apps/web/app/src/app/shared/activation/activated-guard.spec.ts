import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';

import { Auth } from '../auth/auth';
import { BrowserAuth } from '../auth/browser-auth';
import { ACTIVATION_URL, DASHBOARD_URL, SIGN_IN_URL } from '../constants/routes';

import { activatedGuard } from './activated-guard';
import { Activation } from './activation';

describe('activatedGuard', () => {
  const executeGuard: CanActivateFn = (...guardParameters) =>
    TestBed.runInInjectionContext(() => activatedGuard(...guardParameters));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        BrowserAuth,
        { provide: Auth, useExisting: BrowserAuth },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('redirects to /sign-in when no session is loaded and never hits the API', async () => {
    const auth = TestBed.inject(Auth);
    const router = TestBed.inject(Router);

    vi.spyOn(auth, 'ensureSessionLoaded').mockResolvedValue();
    vi.spyOn(auth, 'isAuthenticated').mockReturnValue(false);

    const result = (await executeGuard({} as never, {} as never)) as UrlTree;

    TestBed.inject(HttpTestingController).expectNone('/api/activation');

    expect(auth.ensureSessionLoaded).toHaveBeenCalled();
    expect(auth.isAuthenticated).toHaveBeenCalled();
    expect(router.serializeUrl(result)).toBe(router.serializeUrl(router.createUrlTree([SIGN_IN_URL])));
  });

  it('redirects to /activation when session is valid but milestones are missing', async () => {
    const auth = TestBed.inject(Auth);
    const activation = TestBed.inject(Activation);
    const router = TestBed.inject(Router);

    vi.spyOn(auth, 'ensureSessionLoaded').mockResolvedValue();
    vi.spyOn(auth, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(activation, 'loadState').mockResolvedValue({
      apiKeys: [],
      milestones: ['api_key_created'],
      seedPrompt: 'prompt',
    });

    const result = (await executeGuard({} as never, {} as never)) as UrlTree;

    expect(activation.loadState).toHaveBeenCalled();
    expect(router.serializeUrl(result)).toBe(router.serializeUrl(router.createUrlTree([ACTIVATION_URL])));
  });

  it('allows navigation when the user has completed activation', async () => {
    const auth = TestBed.inject(Auth);
    const activation = TestBed.inject(Activation);
    const router = TestBed.inject(Router);

    vi.spyOn(auth, 'ensureSessionLoaded').mockResolvedValue();
    vi.spyOn(auth, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(activation, 'loadState').mockResolvedValue({
      apiKeys: [],
      milestones: ['activation_completed'],
      seedPrompt: 'prompt',
    });

    const result = await executeGuard({} as never, {} as never);

    expect(result).toBe(true);
    expect(router.serializeUrl(router.createUrlTree([ACTIVATION_URL]))).not.toBe('/undefined');
    expect(router.serializeUrl(router.createUrlTree([DASHBOARD_URL]))).not.toBe('/undefined');
  });

  it('also allows navigation when the user has skipped activation', async () => {
    const auth = TestBed.inject(Auth);
    const activation = TestBed.inject(Activation);

    vi.spyOn(auth, 'ensureSessionLoaded').mockResolvedValue();
    vi.spyOn(auth, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(activation, 'loadState').mockResolvedValue({
      apiKeys: [],
      milestones: ['activation_skipped'],
      seedPrompt: 'prompt',
    });

    const result = await executeGuard({} as never, {} as never);

    expect(result).toBe(true);
  });
});

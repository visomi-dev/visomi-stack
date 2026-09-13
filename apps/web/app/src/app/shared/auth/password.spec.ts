import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { PasswordAuth } from './password';

describe('PasswordAuth', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PasswordAuth, provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('submits password credentials and returns the server-selected factor', async () => {
    const auth = TestBed.inject(PasswordAuth);
    const http = TestBed.inject(HttpTestingController);
    const request = auth.signIn({ email: 'user@example.test', password: 'password' });

    http.expectOne('/api/auth/password/sign-in').flush({
      data: {
        flowId: 'flow-1',
        requiredFactor: 'totp',
        expiresAt: '2026-09-12T00:10:00.000Z',
      },
      message: 'Password accepted.',
    });

    await expect(request).resolves.toMatchObject({ flowId: 'flow-1', requiredFactor: 'totp' });
  });

  it('sets a password through the restricted recovery session', async () => {
    const auth = TestBed.inject(PasswordAuth);
    const http = TestBed.inject(HttpTestingController);
    const request = auth.setPassword({ password: 'a'.repeat(15) });
    const httpRequest = http.expectOne('/api/auth/password/set');

    expect(httpRequest.request.body).toEqual({ password: 'a'.repeat(15) });
    httpRequest.flush({ data: { passwordSet: true }, message: 'Password set successfully.' });

    await expect(request).resolves.toEqual({ passwordSet: true });
  });

  it('starts and verifies password signup with the email code', async () => {
    const auth = TestBed.inject(PasswordAuth);
    const http = TestBed.inject(HttpTestingController);
    const signup = auth.signUp({ email: 'new@example.test', password: 'a'.repeat(15) });

    http.expectOne('/api/auth/password/sign-up').flush({
      data: {
        flowId: 'signup-flow',
        expiresAt: '2026-09-12T00:10:00.000Z',
        resendAvailableAt: '2026-09-12T00:01:00.000Z',
      },
      message: 'Check your email.',
    });
    await expect(signup).resolves.toMatchObject({ flowId: 'signup-flow' });

    const verification = auth.verifySignUp('signup-flow', '123456');
    const request = http.expectOne('/api/auth/password/sign-up/verify');

    expect(request.request.body).toEqual({ flowId: 'signup-flow', code: '123456' });
    request.flush({
      data: {
        authenticated: false,
        kind: 'restricted',
        expiresAt: '2026-09-12T00:10:00.000Z',
        user: null,
        verifiedEmail: 'new@example.test',
      },
      message: 'Verified.',
    });
    await expect(verification).resolves.toMatchObject({ verifiedEmail: 'new@example.test' });
  });

  it('requests and completes a password reset with its email code', async () => {
    const auth = TestBed.inject(PasswordAuth);
    const http = TestBed.inject(HttpTestingController);
    const reset = auth.requestReset('user@example.test');

    const request = http.expectOne('/api/auth/password/reset/request');

    expect(request.request.body).toEqual({ email: 'user@example.test' });
    request.flush({
      data: { flowId: 'reset-flow', requiredFactor: 'email', expiresAt: '2026-09-12T00:10:00.000Z' },
      message: 'Code sent.',
    });
    await expect(reset).resolves.toMatchObject({ flowId: 'reset-flow', requiredFactor: 'email' });

    const completion = auth.completeReset({ flowId: 'reset-flow', emailCode: '123456', password: 'b'.repeat(15) });
    const completeRequest = http.expectOne('/api/auth/password/reset/complete');

    expect(completeRequest.request.body).toEqual({
      flowId: 'reset-flow',
      emailCode: '123456',
      password: 'b'.repeat(15),
    });
    completeRequest.flush({ data: { passwordReset: true }, message: 'Reset.' });
    await expect(completion).resolves.toEqual({ passwordReset: true });
  });

  it('sends only the selected factor when verifying a password flow', async () => {
    const auth = TestBed.inject(PasswordAuth);
    const http = TestBed.inject(HttpTestingController);
    const request = auth.verify('flow-1', '123456', 'email');
    const httpRequest = http.expectOne('/api/auth/password/verify');

    expect(httpRequest.request.body).toEqual({ flowId: 'flow-1', code: '123456', kind: 'email' });
    httpRequest.flush({
      data: {
        authenticated: true,
        user: {
          accountId: 'account-1',
          email: 'user@example.test',
          emailVerifiedAt: '2026-09-11T00:00:00.000Z',
          id: 'user-1',
          role: 'owner',
        },
      },
      message: 'Password authentication complete.',
    });

    await expect(request).resolves.toMatchObject({ kind: 'full' });
  });
});

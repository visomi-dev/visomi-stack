import axios from 'axios';

const email = 'engineer@themis.dev';

const password = 'S3cureAuth!';

const toCookieHeader = (setCookie: string[] | undefined) =>
  setCookie?.map((cookie) => cookie.split(';', 1)[0]).join('; ') ?? '';

async function registerSession(suffix: string): Promise<{ cookie: string; workspaceId: string }> {
  const account = `webauthn-${suffix}-${Date.now()}@themis.dev`;
  const signUp = await axios.post('/auth/sign-up', { email: account, password });
  const mailbox = await axios.get('/test/mailbox/latest', { params: { email: account, purpose: 'sign_up' } });
  const verified = await axios.post('/auth/sign-up/verify', {
    challengeId: signUp.data.data.challengeId,
    pin: mailbox.data.pin,
  });
  const cookie = toCookieHeader(verified.headers['set-cookie']);
  const project = await axios.post(
    '/projects',
    { name: `WebAuthn ${suffix}`, sourceType: 'manual' },
    { headers: { Cookie: cookie } },
  );

  return { cookie, workspaceId: project.data.data.id as string };
}

describe('auth API', () => {
  beforeEach(async () => {
    await axios.delete('/test/mailbox');
  });

  it('should return a message from the API root', async () => {
    const res = await axios.get(`/`);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ message: 'Hello Themis API' });
  });

  it('serves the OpenAPI document', async () => {
    const res = await axios.get('/openapi.json');

    expect(res.status).toBe(200);
    expect(res.data.openapi).toBe('3.1.0');
    expect(res.data.info.title).toBe('Themis API');
    expect(res.data.paths['/auth/session']).toBeDefined();
    expect(res.data.paths['/projects/{projectId}/seed']).toBeDefined();
  });

  it('documents rate-limit responses for verification lifecycle routes', async () => {
    const res = await axios.get('/openapi.json');
    const paths = res.data.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>;

    for (const [path, method] of [
      ['/auth/sign-up/verify', 'post'],
      ['/auth/sign-in/verify', 'post'],
      ['/auth/verification/resend', 'post'],
      ['/auth/password/reset/verify', 'post'],
    ] as const) {
      expect(paths[path]?.[method]?.responses['429']).toEqual(
        expect.objectContaining({ description: expect.stringContaining('Too many') }),
      );
    }
  });

  it('covers WebAuthn metadata negative cases over real HTTP', async () => {
    const owner = await registerSession('owner');
    const otherTenant = await registerSession('other');
    const credential = {
      credentialId: 'AQIDBA',
      rpId: 'example.test',
      origin: 'https://example.test',
      prfSupported: true,
      transports: ['internal'],
    };
    const ownerHeaders = { headers: { Cookie: owner.cookie }, validateStatus: () => true };
    const otherHeaders = { headers: { Cookie: otherTenant.cookie }, validateStatus: () => true };

    const unauthorizedWorkspace = await axios.get(`/webauthn/${owner.workspaceId}/credentials`, otherHeaders);

    expect(unauthorizedWorkspace.status).toBe(404);
    expect(unauthorizedWorkspace.data).toEqual({
      code: 'workspace_not_found',
      message: 'The workspace could not be found.',
    });

    const malformedCredential = await axios.post(
      `/webauthn/${owner.workspaceId}/credentials`,
      { ...credential, credentialId: 'not canonical!' },
      ownerHeaders,
    );

    expect(malformedCredential.status).toBe(400);
    expect(malformedCredential.data.code).toBe('invalid_request');

    const secretField = await axios.post(
      `/webauthn/${owner.workspaceId}/credentials`,
      { ...credential, privateKey: 'must-not-cross-the-api' },
      ownerHeaders,
    );

    expect(secretField.status).toBe(400);
    expect(JSON.stringify(secretField.data)).not.toContain('must-not-cross-the-api');

    const enrolled = await axios.post(
      `/webauthn/${owner.workspaceId}/recovery`,
      { requestId: 'enroll-once', confirmed: true },
      ownerHeaders,
    );

    expect(enrolled.status).toBe(201);
    expect(enrolled.data.data).not.toHaveProperty('material');
    const replayedEnrollment = await axios.post(
      `/webauthn/${owner.workspaceId}/recovery`,
      { requestId: 'enroll-once', confirmed: true },
      ownerHeaders,
    );

    expect(replayedEnrollment.status).toBe(409);
    expect(replayedEnrollment.data).toEqual({
      code: 'webauthn_replay',
      message: 'The recovery operation was already processed.',
    });

    const recoveryId = enrolled.data.data.recoveryId as string;
    const crossTenant = await axios.post(
      `/webauthn/${owner.workspaceId}/recovery/${recoveryId}/use`,
      { requestId: 'cross-tenant', confirmed: true },
      otherHeaders,
    );

    expect(crossTenant.status).toBe(404);

    const revoked = await axios.post(
      `/webauthn/${otherTenant.workspaceId}/recovery`,
      { requestId: 'revoke-me', confirmed: true },
      otherHeaders,
    );

    const revokedId = revoked.data.data.recoveryId as string;

    expect(
      (await axios.delete(`/webauthn/${otherTenant.workspaceId}/recovery/${revokedId}`, otherHeaders)).status,
    ).toBe(200);

    const revokedUse = await axios.post(
      `/webauthn/${otherTenant.workspaceId}/recovery/${revokedId}/use`,
      { requestId: 'revoked-use', confirmed: true },
      otherHeaders,
    );

    expect(revokedUse.status).toBe(409);

    const used = await axios.post(
      `/webauthn/${owner.workspaceId}/recovery/${recoveryId}/use`,
      { requestId: 'use-once', confirmed: true },
      ownerHeaders,
    );

    expect(used.status).toBe(200);
    const replayedUse = await axios.post(
      `/webauthn/${owner.workspaceId}/recovery/${recoveryId}/use`,
      { requestId: 'use-again', confirmed: true },
      ownerHeaders,
    );

    expect(replayedUse.status).toBe(409);
  }, 30_000);

  it('completes sign-up, verification, session restore, sign-out, and sign-in verification', async () => {
    const signUpResponse = await axios.post('/auth/sign-up', {
      email,
      password,
    });

    expect(signUpResponse.status).toBe(201);
    expect(signUpResponse.data.data.email).toBe(email);
    expect(signUpResponse.data.data.purpose).toBe('sign_up');

    const signUpMail = await axios.get('/test/mailbox/latest', {
      params: {
        email,
        purpose: 'sign_up',
      },
    });

    const signUpVerifyResponse = await axios.post(
      '/auth/sign-up/verify',
      {
        challengeId: signUpResponse.data.data.challengeId,
        pin: signUpMail.data.pin,
      },
      {
        validateStatus: () => true,
      },
    );

    expect(signUpVerifyResponse.status).toBe(200);
    expect(signUpVerifyResponse.data.data.user.email).toBe(email);
    expect(signUpVerifyResponse.data.data.user.accountId).toBeTruthy();
    expect(signUpVerifyResponse.data.data.user.emailVerifiedAt).not.toBeNull();

    const sessionCookie = toCookieHeader(signUpVerifyResponse.headers['set-cookie']);

    const sessionResponse = await axios.get('/auth/session', {
      headers: {
        Cookie: sessionCookie,
      },
    });

    expect(sessionResponse.data.data.authenticated).toBe(true);
    expect(sessionResponse.data.data.user.email).toBe(email);
    expect(sessionResponse.data.data.user.accountId).toBe(signUpVerifyResponse.data.data.user.accountId);

    const signOutResponse = await axios.post(
      '/auth/sign-out',
      {},
      {
        headers: {
          Cookie: sessionCookie,
        },
        validateStatus: () => true,
      },
    );

    expect(signOutResponse.status).toBe(204);

    await axios.delete('/test/mailbox');

    const signInPasswordResponse = await axios.post('/auth/sign-in/password', {
      email,
      password,
    });

    expect(signInPasswordResponse.status).toBe(200);

    if (signInPasswordResponse.data.data.authenticated) {
      expect(signInPasswordResponse.data.data.user.email).toBe(email);
      expect(signInPasswordResponse.data.data.user.accountId).toBe(signUpVerifyResponse.data.data.user.accountId);

      return;
    }

    expect(signInPasswordResponse.data.data.purpose).toBe('sign_in');

    const signInMail = await axios.get('/test/mailbox/latest', {
      params: {
        email,
        purpose: 'sign_in',
      },
    });

    const invalidVerifyResponse = await axios.post(
      '/auth/sign-in/verify',
      {
        challengeId: signInPasswordResponse.data.data.challengeId,
        pin: '000000',
      },
      {
        validateStatus: () => true,
      },
    );

    expect(invalidVerifyResponse.status).toBe(401);

    const signInVerifyResponse = await axios.post('/auth/sign-in/verify', {
      challengeId: signInPasswordResponse.data.data.challengeId,
      pin: signInMail.data.pin,
      rememberDevice: true,
    });

    expect(signInVerifyResponse.status).toBe(200);
    expect(signInVerifyResponse.data.data.user.email).toBe(email);
    expect(signInVerifyResponse.data.data.user.accountId).toBe(signUpVerifyResponse.data.data.user.accountId);

    const rememberedDeviceCookie = toCookieHeader(signInVerifyResponse.headers['set-cookie']);

    await axios.post(
      '/auth/sign-out',
      {},
      {
        headers: {
          Cookie: rememberedDeviceCookie,
        },
      },
    );

    await axios.delete('/test/mailbox');

    const trustedSignInResponse = await axios.post(
      '/auth/sign-in/password',
      {
        email,
        password,
      },
      {
        headers: {
          Cookie: rememberedDeviceCookie,
        },
      },
    );

    expect(trustedSignInResponse.status).toBe(200);
    expect(trustedSignInResponse.data.data.authenticated).toBe(true);
    expect(trustedSignInResponse.data.data.user.email).toBe(email);
    expect(trustedSignInResponse.data.data.user.accountId).toBe(signUpVerifyResponse.data.data.user.accountId);
  }, 15_000);

  it('should generate a fresh challenge ID on repeated password sign-in', async () => {
    const firstResponse = await axios.post('/auth/sign-in/password', {
      email,
      password,
    });

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.data.data.purpose).toBe('sign_in');

    const firstChallengeId = firstResponse.data.data.challengeId;

    const secondResponse = await axios.post('/auth/sign-in/password', {
      email,
      password,
    });

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.data.data.purpose).toBe('sign_in');

    const secondChallengeId = secondResponse.data.data.challengeId;

    expect(secondChallengeId).not.toBe(firstChallengeId);
  });

  it('should preserve the verification resend rate limit', async () => {
    const response = await axios.post('/auth/sign-up', {
      email: `rate-limit-${Date.now()}@themis.dev`,
      password,
    });

    const resendResponse = await axios.post(
      '/auth/verification/resend',
      { challengeId: response.data.data.challengeId },
      { validateStatus: () => true },
    );

    expect(resendResponse.status).toBe(429);
    expect(resendResponse.data).toEqual(
      expect.objectContaining({ code: 'challenge_cooldown', message: expect.any(String) }),
    );
  });
});

import axios from 'axios';

const origin = 'http://localhost:8080';
const csrfConfig = { headers: { Origin: origin } };

const toCookieHeader = (setCookie: string[] | undefined) =>
  setCookie?.map((cookie) => cookie.split(';', 1)[0]).join('; ') ?? '';

async function bootstrapSession(suffix: string): Promise<{ cookie: string; workspaceId: string; email: string }> {
  const accountEmail = `webauthn-${suffix}-${Date.now()}@visomi-stack.dev`;
  const session = await axios.post('/test/auth/session', { email: accountEmail });
  const cookie = toCookieHeader(session.headers['set-cookie']);
  const project = await axios.post(
    '/projects',
    { name: `WebAuthn ${suffix}`, sourceType: 'manual' },
    { headers: { Cookie: cookie } },
  );

  return { cookie, email: accountEmail, workspaceId: project.data.data.id as string };
}

describe('auth API', () => {
  beforeEach(async () => {
    await axios.delete('/test/mailbox');
  });

  it('should return a message from the API root', async () => {
    const res = await axios.get(`/`);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ message: 'Hello Visomi Stack API' });
  });

  it('serves the OpenAPI document', async () => {
    const res = await axios.get('/openapi.json');

    expect(res.status).toBe(200);
    expect(res.data.openapi).toBe('3.1.0');
    expect(res.data.info.title).toBe('Visomi Stack API');
    expect(res.data.paths['/auth/session']).toBeDefined();
    expect(res.data.paths['/projects/{projectId}/seed']).toBeDefined();
  });

  it('documents rate-limit responses for the passwordless verification lifecycle', async () => {
    const res = await axios.get('/openapi.json');
    const paths = res.data.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>;

    for (const [path, method] of [
      ['/auth/email-otp/request', 'post'],
      ['/auth/email-otp/verify', 'post'],
      ['/auth/email-otp/resend', 'post'],
    ] as const) {
      expect(paths[path]?.[method]?.responses['429']).toEqual(
        expect.objectContaining({ description: expect.stringContaining('Too many') }),
      );
    }
  });

  it('documents only the passwordless endpoints', async () => {
    const res = await axios.get('/openapi.json');
    const paths = res.data.paths as Record<string, unknown>;

    for (const removedPath of [
      '/auth/sign-up',
      '/auth/sign-up/verify',
      '/auth/sign-in/password',
      '/auth/sign-in/verify',
      '/auth/verification/resend',
      '/auth/password/forgotten',
      '/auth/password/reset',
      '/auth/password/reset/verify',
      '/auth/password/reset/session',
      '/auth/security/password',
      '/auth/security/password/reauthenticate',
    ]) {
      expect(paths[removedPath]).toBeUndefined();
    }
  });

  it('completes the email-OTP bootstrap and session lifecycle', async () => {
    const accountEmail = `engineer-${Date.now()}@visomi-stack.dev`;
    const request = await axios.post('/auth/email-otp/request', { email: accountEmail }, csrfConfig);

    expect(request.status).toBe(202);
    expect(request.data.data.flowId).toBeDefined();

    const mailbox = await axios.get('/test/mailbox/latest', {
      params: { email: accountEmail, purpose: 'bootstrap_recovery' },
    });

    expect(mailbox.data.purpose).toBe('bootstrap_recovery');
    expect(mailbox.data.email).toBe(accountEmail);

    const verify = await axios.post(
      '/auth/email-otp/verify',
      {
        flowId: request.data.data.flowId,
        pin: mailbox.data.pin,
      },
      csrfConfig,
    );

    expect(verify.status).toBe(200);
    expect(verify.data.data.kind).toBe('restricted');
    expect(verify.data.data.user).toBeNull();

    const sessionCookie = toCookieHeader(verify.headers['set-cookie']);
    const session = await axios.get('/auth/session', {
      headers: { Cookie: sessionCookie },
    });

    expect(session.data.data.authenticated).toBe(false);
    expect(session.data.data.user).toBeNull();

    const invalid = await axios.post('/auth/email-otp/request', { email: accountEmail }, csrfConfig);

    const invalidVerify = await axios.post(
      '/auth/email-otp/verify',
      { flowId: invalid.data.data.flowId, pin: '000000' },
      { ...csrfConfig, validateStatus: () => true },
    );

    expect(invalidVerify.status).toBe(401);

    const signOut = await axios.post(
      '/auth/sign-out',
      {},
      {
        headers: { ...csrfConfig.headers, Cookie: sessionCookie },
        validateStatus: () => true,
      },
    );

    expect(signOut.status).toBe(204);
  }, 15_000);

  it('returns identical responses for known and unknown email OTP requests', async () => {
    const knownEmail = `known-${Date.now()}@visomi-stack.dev`;
    const unknownEmail = `unknown-${Date.now()}@visomi-stack.dev`;

    await axios.post('/auth/email-otp/request', { email: knownEmail }, csrfConfig);

    const known = await axios.post('/auth/email-otp/request', { email: knownEmail }, csrfConfig);
    const unknown = await axios.post('/auth/email-otp/request', { email: unknownEmail }, csrfConfig);

    expect(known.status).toBe(unknown.status);
    expect(known.data.data.flowId).toBeDefined();
    expect(unknown.data.data.flowId).toBeDefined();
  });

  it('enforces the OTP resend cooldown', async () => {
    const accountEmail = `resend-${Date.now()}@visomi-stack.dev`;

    const request = await axios.post('/auth/email-otp/request', { email: accountEmail }, csrfConfig);
    const resend = await axios.post(
      '/auth/email-otp/resend',
      { flowId: request.data.data.flowId },
      { ...csrfConfig, validateStatus: () => true },
    );

    expect(resend.status).toBe(429);
    expect(resend.data).toEqual(expect.objectContaining({ code: 'rate_limited', message: expect.any(String) }));
  });

  it('rejects anonymous passkey registration with restricted_session_required', async () => {
    const accountEmail = `anonymous-${Date.now()}@visomi-stack.dev`;

    const response = await axios.post(
      '/auth/passkey/registration/begin',
      { email: accountEmail, label: 'Laptop' },
      { headers: { Origin: origin }, validateStatus: () => true },
    );

    expect(response.status).toBe(401);
    expect(response.data.code).toBe('restricted_session_required');
  });

  it('returns the bootstrap session from the test router without creating new users for anonymous mailboxes', async () => {
    const { cookie, workspaceId } = await bootstrapSession('anon');

    expect(cookie).not.toEqual('');
    expect(workspaceId).toBeDefined();
  });
});

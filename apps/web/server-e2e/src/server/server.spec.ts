import axios from 'axios';

jest.setTimeout(15000);

describe('composition server', () => {
  it('rejects client-supplied proof flags after starting a pending signup', async () => {
    const email = `passkey-gateway-${Date.now()}@visomi-stack.test`;
    const signUp = await axios.post(
      '/api/auth/password/sign-up',
      { email, password: 'gateway secure password 2026' },
      {
        headers: { Origin: 'http://localhost:8080' },
      },
    );
    const unverified = await axios.post(
      '/api/auth/passkey/authentication/begin',
      { email, pinVerified: true },
      { headers: { Origin: 'http://localhost:8080' }, validateStatus: () => true },
    );
    const fallback = await axios.post(
      '/api/auth/passkey/authentication/begin',
      { email, pinVerified: true, explicitPassword: true },
      { headers: { Origin: 'http://localhost:8080' }, validateStatus: () => true },
    );

    expect(signUp.status).toBe(202);
    expect(signUp.data.data.flowId).toEqual(expect.any(String));
    expect(unverified.status).toBe(400);
    expect(unverified.data.code).toBe('invalid_request');
    expect(fallback.status).toBe(400);
    expect(fallback.data.code).toBe('invalid_request');
    const session = await axios.get('/api/auth/session', {
      headers: {
        Cookie: (signUp.headers['set-cookie'] ?? []).map((cookie: string) => cookie.split(';')[0]).join('; '),
      },
    });

    expect(session.data.data.authenticated).toBe(false);
    expect(JSON.stringify({ unverified: unverified.data, fallback: fallback.data })).not.toContain('prf');
    expect(JSON.stringify({ unverified: unverified.data, fallback: fallback.data })).not.toContain('vault');
  });

  it('exposes a runtime health endpoint', async () => {
    const response = await axios.get('/healthz');

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ status: 'ok' });
  });

  it('serves the public site root', async () => {
    const response = await axios.get('/', {
      headers: {
        Accept: 'text/html',
      },
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: 'text',
    });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/en/');
  });

  it('mounts the api under /api', async () => {
    const response = await axios.get('/api/');

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ message: 'Hello Visomi Stack API' });
  });

  it('serves the Angular identity route under /app', async () => {
    const response = await axios.get('/app/en/auth/identity', {
      headers: {
        Accept: 'text/html',
      },
      responseType: 'text',
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.data).toContain('<base href="/app/en/">');
    expect(response.data).toContain('<app-root');
  });
});

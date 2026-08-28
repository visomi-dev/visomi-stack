import axios from 'axios';

jest.setTimeout(15000);

describe('composition server', () => {
  it('exposes passkey ceremony boundaries without bypassing email PIN gating', async () => {
    const email = `passkey-gateway-${Date.now()}@visomi-stack.test`;
    const signUp = await axios.post('/api/auth/sign-up', { email, password: 'S3cureAuth!' });
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

    expect(signUp.status).toBe(201);
    expect(unverified.status).toBe(403);
    expect(unverified.data.code).toBe('email_unverified');
    expect(fallback.status).toBe(403);
    expect(fallback.data.code).toBe('email_unverified');
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

  it('serves the Angular auth surface under /app', async () => {
    const response = await axios.get('/app/en/sign-in', {
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

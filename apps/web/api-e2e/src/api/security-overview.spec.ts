import { randomUUID } from 'node:crypto';

import axios from 'axios';

const origin = 'http://localhost:8080';
const config = (cookie: string) => ({ headers: { Origin: origin, Cookie: cookie } });
const cookies = (values?: string[]) => values?.map((value) => value.split(';', 1)[0]).join('; ') ?? '';

describe('security overview and contextual authority over HTTP', () => {
  it('reports available methods and consumes a verified recovery-code operation once', async () => {
    const email = `security-overview-${randomUUID()}@example.test`;
    const password = 'a sufficiently long test password';
    const restricted = await axios.post('/test/auth/session', { email, mode: 'restricted' });

    await axios.post('/auth/password/set', { password }, config(cookies(restricted.headers['set-cookie'])));
    const full = await axios.post('/test/auth/session', { email });
    const client = config(cookies(full.headers['set-cookie']));
    const overview = await axios.get('/auth/security/overview', client);

    expect(overview.data.data).toMatchObject({ passwordEnabled: true, totpEnabled: false, recoveryCodesRemaining: 0 });
    expect(overview.data.data.passwordHash).toBeUndefined();
    const started = await axios.post('/auth/reauth/start', { purpose: 'recovery_codes_regenerate' }, client);

    expect(started.data.data.methods).toEqual(['password']);
    expect(started.data.data.passwordRequiresTotp).toBe(false);
    expect(Date.parse(started.data.data.expiresAt)).toBeGreaterThan(Date.now());
    const grantId = started.data.data.grantId as string;

    await axios.post('/auth/reauth/complete', { grantId, method: 'password', password }, client);
    const regenerated = await axios.post('/auth/recovery-codes/regenerate', { grantId }, client);

    expect(regenerated.data.data.recoveryCodes.length).toBeGreaterThan(0);
    const updated = await axios.get('/auth/security/overview', client);

    expect(updated.data.data.recoveryCodesRemaining).toBe(regenerated.data.data.recoveryCodes.length);
    await expect(axios.post('/auth/recovery-codes/regenerate', { grantId }, client)).rejects.toMatchObject({
      response: { status: 401 },
    });
    const other = await axios.post('/test/auth/session', { email: `other-${randomUUID()}@example.test` });
    const isolated = await axios.get('/auth/security/overview', config(cookies(other.headers['set-cookie'])));

    expect(isolated.data.data.recoveryCodesRemaining).toBe(0);
  });
});

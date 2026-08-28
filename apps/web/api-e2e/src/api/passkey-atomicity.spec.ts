import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import axios from 'axios';
import { Pool } from 'pg';

import { createRegistrationFixture } from '../support/webauthn-fixture';

type JsonRecord = { [key: string]: unknown };
type PersistedState = Record<string, unknown>;

const databaseUrl = process.env['DATABASE_URL'];
const baseUrl = `http://${process.env['HOST'] ?? 'localhost'}:${process.env['GATEWAY_PORT'] ?? '8080'}/api`;
const webAuthnOrigin = process.env['WEBAUTHN_ORIGIN'] ?? 'http://localhost:8080';
const artifactDirectory = resolve(
  process.env['PASSKEY_ATOMICITY_ARTIFACT_DIR'] ?? 'docs/verification/passkey-002-run-255',
);

function cookieHeader(value: string[] | undefined): string {
  return value?.map((item) => item.split(';', 1)[0]).join('; ') ?? '';
}

function bodyData(response: { data: unknown }): JsonRecord {
  if (!response.data || typeof response.data !== 'object') throw new Error('Expected an object response body.');
  const data = (response.data as JsonRecord).data;

  if (!data || typeof data !== 'object') throw new Error('Expected a data response body.');

  return data as JsonRecord;
}

function responseBody(response: { data: unknown }): unknown {
  return response.data;
}

async function readRegistrationState(pool: Pool, enrollmentId: string, challengeId: string): Promise<PersistedState> {
  const result = await pool.query(
    `SELECT c.consumed_at, e.credential_id, e.status,
      (SELECT count(*)::int FROM account_passkey_credentials pc WHERE pc.user_id = e.user_id) AS credential_count
     FROM account_webauthn_challenges c JOIN account_passkey_enrollments e ON e.id = $1 WHERE c.id = $2`,
    [enrollmentId, challengeId],
  );

  return result.rows[0] as PersistedState;
}

async function readVerificationState(
  pool: Pool,
  challengeId: string,
  enrollmentId: string,
  userId: string,
): Promise<PersistedState> {
  const result = await pool.query(
    `SELECT u.email_verified_at, c.consumed_at, e.status, e.credential_id,
      (SELECT count(*)::int FROM account_passkey_credentials pc WHERE pc.credential_id = e.credential_id) AS credential_count
     FROM users u JOIN auth_verification_challenges c ON c.id = $1 JOIN account_passkey_enrollments e ON e.id = $2 WHERE u.id = $3`,
    [challengeId, enrollmentId, userId],
  );

  return result.rows[0] as PersistedState;
}

const atomicitySuite = databaseUrl ? describe : describe.skip;

atomicitySuite('passkey database transaction rollback', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const triggerName = `passkey_atomicity_${process.pid}_${Date.now()}`;
  const functionName = `${triggerName}_fn`;

  beforeAll(async () => {
    await mkdir(artifactDirectory, { recursive: true });
    await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'PASSKEY_ATOMICITY_INJECTED_FAILURE'; END;
    $$`);
  });

  afterAll(async () => {
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON account_passkey_credentials`);
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON account_passkey_enrollments`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await pool.end();
  });

  it('rolls back registration challenge consumption, credential insert, and enrollment linkage', async () => {
    const email = `atomic-registration-${randomUUID()}@example.test`;
    const begin = await axios.post(
      `${baseUrl}/auth/passkey/registration/begin`,
      { email, label: 'Atomicity registration', pinVerified: true },
      { headers: { Origin: webAuthnOrigin }, validateStatus: () => true },
    );

    expect(begin.status).toBe(200);
    const data = bodyData(begin);
    const challengeId = String(data.challengeId);
    const enrollmentId = String(data.enrollmentId);
    const fixture = createRegistrationFixture(data.options as JsonRecord, webAuthnOrigin, 'localhost');
    const cookie = cookieHeader(begin.headers['set-cookie']);
    const before = await readRegistrationState(pool, enrollmentId, challengeId);

    await pool.query(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON account_passkey_credentials FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
    const complete = await axios.post(
      `${baseUrl}/auth/passkey/registration/complete`,
      { challengeId, response: fixture.response },
      { headers: { Cookie: cookie, Origin: webAuthnOrigin }, validateStatus: () => true },
    );

    await pool.query(`DROP TRIGGER ${triggerName} ON account_passkey_credentials`);

    const after = await readRegistrationState(pool, enrollmentId, challengeId);

    await writeFile(
      resolve(artifactDirectory, 'registration-rollback.json'),
      JSON.stringify(
        {
          scenario: 'registration-complete persistence rollback',
          request: { method: 'POST', path: '/api/auth/passkey/registration/complete' },
          response: { status: complete.status, body: responseBody(complete) },
          persistedState: { before, after },
        },
        null,
        2,
      ),
    );
    expect(complete.status).toBe(500);
    expect(after).toMatchObject({
      consumed_at: null,
      credential_id: null,
      status: 'pending',
      credential_count: 0,
    });
  });

  it('rolls back email activation, enrollment activation, and verification consumption', async () => {
    const email = `atomic-verification-${randomUUID()}@example.test`;
    const signUp = await axios.post(`${baseUrl}/auth/sign-up`, { email, password: 'Atomicity-only-password!' });
    const challengeId = String(bodyData(signUp).challengeId);
    const mailbox = await axios.get(`${baseUrl}/test/mailbox/latest`, { params: { email, purpose: 'sign_up' } });
    const pin = String((mailbox.data as JsonRecord).pin);
    const userId = String((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id);
    const accountId = randomUUID();
    const enrollmentId = randomUUID();
    const credentialId = `rollback-credential-${randomUUID()}`;
    const now = new Date();

    await pool.query(
      `INSERT INTO accounts (id, name, slug, owner_user_id, created_at, updated_at) VALUES ($1, 'Atomicity account', $2, $3, $4, $4)`,
      [accountId, `atomic-${randomUUID()}`, userId, now],
    );
    await pool.query(
      `INSERT INTO account_passkey_enrollments
       (id, account_id, user_id, email, credential_id, status, verification_challenge_id, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $8)`,
      [enrollmentId, accountId, userId, email, credentialId, challengeId, new Date(now.getTime() + 900000), now],
    );
    await pool.query(
      `INSERT INTO account_passkey_credentials
       (id, account_id, user_id, credential_id, public_key, rp_id, label, transports, sign_count, backup_eligible, backup_state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'fixture-public-key', 'localhost', 'Atomicity credential', '{}', 0, false, false, $5, $5)`,
      [randomUUID(), accountId, userId, credentialId, now],
    );
    const before = await readVerificationState(pool, challengeId, enrollmentId, userId);

    await pool.query(
      `CREATE TRIGGER ${triggerName} BEFORE UPDATE ON account_passkey_enrollments FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
    const verify = await axios.post(
      `${baseUrl}/auth/sign-up/verify`,
      { challengeId, pin },
      { headers: { Origin: webAuthnOrigin }, validateStatus: () => true },
    );

    await pool.query(`DROP TRIGGER ${triggerName} ON account_passkey_enrollments`);

    const after = await readVerificationState(pool, challengeId, enrollmentId, userId);

    await writeFile(
      resolve(artifactDirectory, 'verification-rollback.json'),
      JSON.stringify(
        {
          scenario: 'sign-up verification persistence rollback',
          request: { method: 'POST', path: '/api/auth/sign-up/verify' },
          response: { status: verify.status, body: responseBody(verify) },
          persistedState: { before, after },
        },
        null,
        2,
      ),
    );
    expect(verify.status).toBe(500);
    expect(after).toMatchObject({
      email_verified_at: null,
      consumed_at: null,
      status: 'pending',
      credential_count: 1,
    });
  });
});

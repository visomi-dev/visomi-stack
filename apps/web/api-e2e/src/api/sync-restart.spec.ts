import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

import axios from 'axios';

const password = 'S3cureAuth!';
const entrypoint = resolve(__dirname, '../../../../../dist/apps/web/server/main.js');
// The API-e2e composition owns GATEWAY_PORT. Keep this independently
// configurable so the restart child cannot collide with that process.
const port = Number(process.env['SYNC_RESTART_PORT'] ?? 8091);
const baseURL = `http://127.0.0.1:${port}`;
const apiBaseURL = `${baseURL}/api`;
const durableSyncConfigured = Boolean(process.env['DATABASE_URL'] && process.env['OPAQUE_SYNC_S3_ENDPOINT']);

function cookieHeader(setCookie: string[] | undefined): string {
  return setCookie?.map((cookie) => cookie.split(';', 1)[0]).join('; ') ?? '';
}

async function waitForGateway(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await axios.get('/healthz', { baseURL })).status === 200) return;
    } catch {
      // The listener can accept TCP before the application is ready.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Restart fixture did not become ready on ${baseURL}.`);
}

function startGateway(): ChildProcess {
  return spawn(process.execPath, [entrypoint], {
    env: {
      ...process.env,
      COOKIE_SECURE: 'false',
      DATABASE_AUTO_MIGRATE: 'true',
      DATABASE_DRIVER: 'pg',
      ENABLE_TEST_API: 'true',
      GATEWAY_PORT: String(port),
      HOST: '127.0.0.1',
      MAIL_TRANSPORT: 'memory',
      NODE_ENV: 'test',
      OPAQUE_SYNC_STORAGE: 'durable',
      PORT: String(port),
      SESSION_SECRET: 'sync-restart-fixture-secret',
    },
    stdio: 'inherit',
  });
}

async function stopGateway(child: ChildProcess): Promise<void> {
  if (!child.killed) child.kill('SIGTERM');
  await new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise()));
}

describe('opaque sync API process restart lifecycle', () => {
  jest.setTimeout(60_000);

  (durableSyncConfigured ? it : it.skip)(
    'replays a durable enrollment and envelope after the API process restarts',
    async () => {
      let gateway = startGateway();

      await waitForGateway();

      try {
        const email = `sync-restart-${Date.now()}@themis.dev`;
        const authenticated = await axios.post('/test/auth/session', { email, password }, { baseURL: apiBaseURL });
        const cookie = cookieHeader(authenticated.headers['set-cookie']);
        const headers = { baseURL: apiBaseURL, headers: { Cookie: cookie } };
        const accountId = authenticated.data.data.accountId as string;
        const project = await axios.post('/projects', { name: 'Restart workspace', sourceType: 'manual' }, headers);
        const workspaceId = project.data.data.id as string;
        const owner = await axios.post(
          `/sync/${workspaceId}/devices`,
          { publicKey: `restart-owner-${Date.now()}`, label: 'Restart owner' },
          headers,
        );
        const deviceId = owner.data.data.deviceId as string;

        await axios.post(`/sync/${workspaceId}/devices/${deviceId}/approval`, { approverDeviceId: deviceId }, headers);
        const device = await axios.post(
          `/sync/${workspaceId}/devices`,
          { publicKey: `restart-device-${Date.now()}`, label: 'Restart device' },
          headers,
        );
        const enrolledDeviceId = device.data.data.deviceId as string;
        const envelope = {
          format: 'themis.encrypted-envelope',
          version: 1,
          kind: 'sync-object',
          envelopeId: `restart-envelope-${Date.now()}`,
          workspaceId,
          recordType: 'project-context',
          revision: 1,
          createdAt: '2026-08-20T00:00:00.000Z',
          associatedData: { purpose: 'restart' },
          metadata: { recipientDeviceId: enrolledDeviceId },
          nonce: 'cmVzdGFydC1ub25jZQ',
          ciphertext: 'cmVzdGFydC1jaXBoZXJ0ZXh0',
          authTag: 'cmVzdGFydC10YWc',
        };
        const grant = await axios.post(
          `/sync/${workspaceId}/devices/${enrolledDeviceId}/enroll`,
          { approverDeviceId: deviceId, envelope: { ...envelope, recordType: 'workspace-key-distribution' } },
          { ...headers, validateStatus: () => true },
        );

        expect(grant.status).toBe(200);

        await axios.post(
          `/sync/${workspaceId}/envelopes`,
          { envelope, deviceId: enrolledDeviceId, enrollmentVersion: grant.data.data.enrollmentVersion },
          headers,
        );

        await stopGateway(gateway);
        gateway = startGateway();
        await waitForGateway();

        const restartedAuth = await axios.post(
          '/test/auth/session',
          { email: `sync-restart-member-${Date.now()}@themis.dev`, password, accountId },
          { baseURL: apiBaseURL },
        );
        const restartedCookie = cookieHeader(restartedAuth.headers['set-cookie']);
        const replay = await axios.get(`/sync/${workspaceId}/envelopes`, {
          baseURL: apiBaseURL,
          headers: { Cookie: restartedCookie },
          params: { afterCursor: 0, deviceId: enrolledDeviceId, enrollmentVersion: grant.data.data.enrollmentVersion },
        });

        expect(replay.status).toBe(200);
        expect(replay.data.data.envelopes[0].envelope.envelopeId).toBe(envelope.envelopeId);
      } finally {
        await stopGateway(gateway);
      }
    },
  );
});

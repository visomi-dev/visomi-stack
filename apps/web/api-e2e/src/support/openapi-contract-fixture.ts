import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runId, apiUrl, origin, passkeyOnly, reportDirectory } from './openapi-contract-context.ts';
import type { Fixture, JsonRecord } from './openapi-contract-context.ts';
import { createVerifiedPasswordAccount } from './password-fixture.ts';
import { requestJson, envelope, requestObservation, responseCode } from './openapi-contract-http.ts';
import { claim } from './openapi-contract-sync.ts';

export async function bootstrapSession(): Promise<Fixture> {
  const runSuffix = Date.now().toString(36);
  const email = `pzs005-${runId.toLowerCase()}-${runSuffix}@example.test`;
  const smokeEmail = `openapi-passkey-unverified-${runSuffix}@example.test`;
  const password = 'S3cureOpenApi!';

  await fetch(`${apiUrl}/test/mailbox`, { method: 'DELETE' });

  const cookie = await createVerifiedPasswordAccount(apiUrl, origin, email, password);

  if (passkeyOnly) {
    const createVerifiedAccount = async (accountEmail: string): Promise<string> => {
      return createVerifiedPasswordAccount(apiUrl, origin, accountEmail, password);
    };
    const smokeEmail = `openapi-passkey-smoke-${runSuffix}@example.test`;
    const unverifiedEmail = `openapi-passkey-unverified-${Date.now().toString(36)}@example.test`;
    const smokeCookie = await createVerifiedAccount(smokeEmail);

    await fetch(`${apiUrl}/auth/sign-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: unverifiedEmail, password }),
    });

    return {
      cookie,
      smokeCookie,
      accountId: 'passkey-only-account',
      userId: 'passkey-only-user',
      email,
      smokeEmail,
      unverifiedEmail,
      isolatedCookie: smokeCookie,
      isolatedAccountId: 'passkey-only-isolated-account',
      workspaceId: 'passkey-only-workspace',
      ownerDeviceId: 'passkey-only-owner-device',
      agentDeviceId: 'passkey-only-agent-device',
      enrollmentVersion: 1,
      agentPrivateKey: generateKeyPairSync('ed25519').privateKey,
      recoveryId: 'passkey-only-recovery',
      credentialId: 'passkey-only-credential',
      schemaExampleEmail: email,
      schemaExampleCookie: cookie,
      schemaExampleRegistration: {
        challengeId: '',
        response: {},
      },
    };
  }

  const session = await requestJson('/auth/session', { headers: { Cookie: cookie } });
  const user = (session.data as JsonRecord).user as JsonRecord;
  const accountId = String(user.accountId);
  const userId = String(user.id);
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const project = await requestJson(
    '/projects',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'ZK-027 OpenAPI fixture', sourceType: 'manual' }),
    },
    201,
  );
  const workspaceId = String((project.data as JsonRecord).id);
  const ownerKeys = generateKeyPairSync('ed25519');
  const agentKeys = generateKeyPairSync('ed25519');
  const owner = await requestJson(`/sync/${workspaceId}/devices`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      publicKey: ownerKeys.publicKey.export({ type: 'spki', format: 'pem' }),
      label: 'ZK-027 owner',
    }),
  });
  const ownerDeviceId = String((owner.data as JsonRecord).deviceId);

  await requestJson(`/sync/${workspaceId}/devices/${ownerDeviceId}/approval`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ approverDeviceId: ownerDeviceId }),
  });
  // The single approver contract still requires the owner to be an enrolled
  // device. Approval alone must not be treated as authorization for the
  // owner to approve or use another device.
  await requestJson(`/sync/${workspaceId}/devices/${ownerDeviceId}/enroll`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      approverDeviceId: ownerDeviceId,
      envelope: envelope(workspaceId, `${runId.toLowerCase()}-owner-grant`, {
        recipientDeviceId: ownerDeviceId,
      }),
    }),
  });
  const agent = await requestJson(`/sync/${workspaceId}/devices`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      publicKey: agentKeys.publicKey.export({ type: 'spki', format: 'pem' }),
      label: 'ZK-027 local agent',
    }),
  });
  const agentDeviceId = String((agent.data as JsonRecord).deviceId);

  const agentEnrollment = await requestJson(`/sync/${workspaceId}/devices/${agentDeviceId}/enroll`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      approverDeviceId: ownerDeviceId,
      envelope: envelope(workspaceId, `${runId.toLowerCase()}-grant`, { recipientDeviceId: agentDeviceId }),
    }),
  });
  const enrollmentVersion = Number((agentEnrollment.data as JsonRecord).enrollmentVersion);

  if (!Number.isInteger(enrollmentVersion) || enrollmentVersion < 1) {
    throw new Error('OpenAPI fixture enrollment did not return a valid enrollmentVersion.');
  }
  const recovery = await requestJson(
    `/webauthn/${workspaceId}/recovery`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId: `${runId.toLowerCase()}-recovery-enroll`, confirmed: true }),
    },
    201,
  );
  const metadataCredentialId = randomBytes(16).toString('base64url');

  const credential = await requestJson(
    `/webauthn/${workspaceId}/credentials`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        credentialId: metadataCredentialId,
        rpId: 'example.test',
        origin: 'https://example.test',
        prfSupported: true,
        transports: ['internal'],
      }),
    },
    201,
  );
  const credentialId = String((credential.data as JsonRecord).id);

  const isolatedCookie = await createVerifiedPasswordAccount(apiUrl, origin, smokeEmail, password);
  const smokeCookie = isolatedCookie;
  const isolatedSession = await requestJson('/auth/session', { headers: { Cookie: isolatedCookie } });
  const isolatedUser = (isolatedSession.data as JsonRecord).user as JsonRecord;
  const unverifiedEmail = `openapi-passkey-unverified-${Date.now().toString(36)}@example.test`;
  const unverifiedSignUp = await fetch(`${apiUrl}/auth/sign-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: unverifiedEmail, password }),
  });

  if (!unverifiedSignUp.ok) {
    throw new Error(`OpenAPI unverified passkey fixture sign-up failed with ${unverifiedSignUp.status}.`);
  }

  return {
    cookie,
    smokeCookie,
    accountId,
    userId,
    email,
    smokeEmail,
    unverifiedEmail,
    isolatedCookie,
    isolatedAccountId: String(isolatedUser.accountId),
    workspaceId,
    ownerDeviceId,
    agentDeviceId,
    enrollmentVersion,
    agentPrivateKey: agentKeys.privateKey,
    recoveryId: String((recovery.data as JsonRecord).recoveryId),
    credentialId,
    schemaExampleEmail: smokeEmail,
    schemaExampleCookie: isolatedCookie,
    schemaExampleRegistration: { challengeId: '', response: {} },
  };
}

export async function verifyFixtureBoundary(fixture: Fixture): Promise<void> {
  const headers = { Cookie: fixture.cookie, 'Content-Type': 'application/json' };
  const boundaryDevice = await requestJson(`/sync/${fixture.workspaceId}/devices`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ publicKey: `${runId}-boundary-device`, label: `${runId} boundary device` }),
  });
  const boundaryDeviceId = String((boundaryDevice.data as JsonRecord).deviceId);
  const boundaryEnrollment = await requestJson(`/sync/${fixture.workspaceId}/devices/${boundaryDeviceId}/enroll`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      approverDeviceId: fixture.ownerDeviceId,
      envelope: envelope(fixture.workspaceId, `${runId}-boundary-grant`, { recipientDeviceId: boundaryDeviceId }),
    }),
  });
  const boundaryEnrollmentVersion = Number((boundaryEnrollment.data as JsonRecord).enrollmentVersion);
  const workspace = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, { headers });
  const workspaceUnauthorized = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {});
  const workspaceIsolated = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
    headers: { Cookie: fixture.isolatedCookie },
  });
  const workspaceUnauthorizedFixture = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
    headers: { ...headers, 'x-operational-workspace-state': 'unauthorized' },
  });
  const unavailable = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
    headers: { ...headers, 'x-operational-workspace-http-case': 'unavailable' },
  });
  const serverError = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
    headers: { ...headers, 'x-operational-workspace-http-case': 'error' },
  });
  const malformedJsonResponse = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
    headers: { ...headers, 'x-operational-workspace-http-case': 'malformed-json' },
  });

  if (
    workspace.status !== 200 ||
    (workspace.body.data as JsonRecord | undefined)?.schemaVersion !== '1' ||
    (workspace.body.data as JsonRecord | undefined)?.readOnly !== true ||
    JSON.stringify(workspace.body).includes('contentMarkdown')
  ) {
    throw new Error('Operational workspace read boundary did not return the safe versioned projection.');
  }
  if (
    workspaceUnauthorized.status !== 401 ||
    workspaceUnauthorizedFixture.status !== 401 ||
    workspaceIsolated.status !== 404 ||
    unavailable.status !== 503 ||
    responseCode(unavailable) !== 'operational_workspace_unavailable' ||
    serverError.status !== 500 ||
    responseCode(serverError) !== 'operational_workspace_error' ||
    malformedJsonResponse.status !== 502 ||
    malformedJsonResponse.body.raw !== '{"data":'
  ) {
    throw new Error('Operational workspace read boundary did not preserve authentication and tenant isolation.');
  }
  const stateCases = await Promise.all(
    (['visible', 'empty', 'locked', 'unavailable', 'stale', 'error', 'malformed'] as const).map(async (state) => {
      const observation = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
        headers: { ...headers, 'x-operational-workspace-state': state },
      });
      const data = observation.body.data as JsonRecord | undefined;
      const collections = ['protectedContext', 'epics', 'workItems', 'runs', 'evidence', 'reviews', 'activity'];
      const observed =
        observation.status === 200 &&
        data?.schemaVersion === '1' &&
        collections.every((key) => (data[key] as JsonRecord | undefined)?.state === state) &&
        !JSON.stringify(observation.body).includes('contentMarkdown');

      if (!observed) {
        throw new Error(`Operational workspace state fixture ${state} was not observed safely.`);
      }

      return { name: state, status: observation.status, observed };
    }),
  );
  const malformedObservation = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
    headers: { ...headers, 'x-operational-workspace-state': 'malformed' },
  });
  const malformedItems = (
    (malformedObservation.body.data as JsonRecord | undefined)?.workItems as JsonRecord | undefined
  )?.items;
  const malformedSchemaObserved =
    malformedObservation.status === 200 &&
    Array.isArray(malformedItems) &&
    malformedItems.some((item) => {
      const record = item as JsonRecord;

      return typeof record.id === 'string' && typeof record.title !== 'string';
    });

  if (!malformedSchemaObserved) {
    throw new Error('Malformed nested operational workspace payload was not observed over HTTP.');
  }
  const webRequest = {
    format: 'themis.mode-negotiation-request',
    requestId: `${runId}-boundary-web`,
    clientId: `${runId}-web-client`,
    clientProfile: 'web-webcrypto',
    supportedModes: ['webcrypto'],
    supportedVersions: [1],
    requestedCapabilities: ['projection', 'sync'],
    preferredMode: 'webcrypto',
    allowDowngrade: false,
    claim: claim(fixture, 'web-webcrypto'),
  };
  const agentRequest = {
    format: 'themis.mode-negotiation-request',
    requestId: `${runId}-boundary-agent`,
    clientId: fixture.agentDeviceId,
    clientProfile: 'web-local-agent',
    supportedModes: ['local-agent', 'webcrypto'],
    supportedVersions: [1],
    requestedCapabilities: ['bridge', 'recovery'],
    preferredMode: 'local-agent',
    allowDowngrade: true,
    claim: claim(fixture, 'web-local-agent'),
  };
  const checks: Array<[string, Promise<Response>, number]> = [
    ['capability discovery', fetch(`${apiUrl}/capabilities/${fixture.workspaceId}`, { headers }), 200],
    [
      'Web-only negotiation',
      fetch(`${apiUrl}/capabilities/${fixture.workspaceId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(webRequest),
      }),
      200,
    ],
    [
      'agent-assisted negotiation',
      fetch(`${apiUrl}/capabilities/${fixture.workspaceId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(agentRequest),
      }),
      200,
    ],
    [
      'opaque append',
      fetch(`${apiUrl}/sync/${fixture.workspaceId}/envelopes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          envelope: envelope(fixture.workspaceId, `${runId}-boundary-sync`, {
            recipientDeviceId: boundaryDeviceId,
          }),
          deviceId: boundaryDeviceId,
          enrollmentVersion: boundaryEnrollmentVersion,
        }),
      }),
      201,
    ],
    [
      'opaque fetch',
      fetch(
        `${apiUrl}/sync/${fixture.workspaceId}/envelopes?deviceId=${encodeURIComponent(boundaryDeviceId)}&enrollmentVersion=${boundaryEnrollmentVersion}`,
        { headers },
      ),
      200,
    ],
  ];
  const results = await Promise.all(
    checks.map(async ([name, responsePromise, expected]) => {
      const response = await responsePromise;

      if (response.status !== expected) {
        throw new Error(`OpenAPI fixture boundary ${name} returned ${response.status}, expected ${expected}.`);
      }

      return { name, status: response.status };
    }),
  );

  await writeFile(
    resolve(reportDirectory, `${runId.toLowerCase()}-fixture-summary.json`),
    JSON.stringify(
      {
        profileCoverage: ['web-webcrypto', 'web-local-agent'],
        protectedBoundary: results,
        operationalWorkspaceReadBoundary: [
          { name: 'authorized-versioned-read', status: workspace.status, observed: workspace.status === 200 },
          {
            name: 'unauthorized-read',
            status: workspaceUnauthorized.status,
            observed: workspaceUnauthorized.status === 401,
          },
          {
            name: 'tenant-isolated-read',
            status: workspaceIsolated.status,
            observed: workspaceIsolated.status === 404,
          },
          {
            name: 'fixture-unauthorized-read',
            status: workspaceUnauthorizedFixture.status,
            observed: workspaceUnauthorizedFixture.status === 401,
          },
          {
            name: 'unavailable-http-response',
            status: unavailable.status,
            observed: unavailable.status === 503 && responseCode(unavailable) === 'operational_workspace_unavailable',
          },
          {
            name: 'error-http-response',
            status: serverError.status,
            observed: serverError.status === 500 && responseCode(serverError) === 'operational_workspace_error',
          },
          {
            name: 'malformed-json-http-response',
            status: malformedJsonResponse.status,
            observed: malformedJsonResponse.status === 502 && malformedJsonResponse.body.raw === '{"data":',
          },
          {
            name: 'malformed-nested-schema-payload',
            status: malformedObservation.status,
            observed: malformedSchemaObserved,
          },
          {
            name: 'protected-disclosure-redaction',
            status: workspace.status,
            observed: !JSON.stringify(workspace.body).includes('contentMarkdown'),
          },
          ...stateCases,
        ],
        recoveryId: fixture.recoveryId,
        credentialId: fixture.credentialId,
        workspaceId: fixture.workspaceId,
        reports: ['passkey-stateful.junit.xml', 'passkey-stateful.har.json'],
      },
      null,
      2,
    ),
  );
}

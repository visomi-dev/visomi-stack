import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

import {
  schemaUrl,
  runId,
  origin,
  passkeyState,
  includePathRegex,
  passkeyOnly,
  reportDirectory,
} from './openapi-contract-context.ts';
import type { Fixture, JsonRecord } from './openapi-contract-context.ts';
import { claim } from './openapi-contract-sync.ts';
import { envelope } from './openapi-contract-http.ts';

export async function prepareSchema(fixture: Fixture): Promise<string> {
  const schemaResponse = await fetch(schemaUrl);
  const schemaBody = await schemaResponse.json();
  const schema = schemaBody as JsonRecord;
  const paths = schema.paths as JsonRecord;
  const values: JsonRecord = {
    workspaceId: fixture.workspaceId,
    projectId: fixture.workspaceId,
    deviceId: fixture.agentDeviceId,
    credentialId: fixture.credentialId,
    recoveryId: fixture.recoveryId,
  };

  for (const pathItem of Object.values(paths)) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }
    for (const operation of Object.values(pathItem as JsonRecord)) {
      if (!operation || typeof operation !== 'object') {
        continue;
      }
      for (const parameter of ((operation as JsonRecord).parameters as JsonRecord[] | undefined) ?? []) {
        const name = String(parameter.name ?? '');

        if (name in values) {
          parameter.example = values[name];
        }
        if (name === 'deviceId') {
          parameter.example = fixture.agentDeviceId;
        }
        if (name === 'enrollmentVersion') {
          parameter.example = fixture.enrollmentVersion;
        }
      }
      if (pathItem === paths['/sync/{workspaceId}/envelopes'] && operation === (pathItem as JsonRecord).get) {
        const parameters = ((operation as JsonRecord).parameters ??= []) as JsonRecord[];

        for (const [name, example] of [
          ['deviceId', fixture.agentDeviceId],
          ['enrollmentVersion', fixture.enrollmentVersion],
        ] as const) {
          if (!parameters.some((parameter) => parameter.name === name)) {
            parameters.push({
              in: 'query',
              name,
              required: true,
              example,
              schema: { type: typeof example === 'number' ? 'integer' : 'string' },
            });
          }
        }
      }
    }
  }
  const bodyExamples: JsonRecord = {
    '/capabilities/{workspaceId}': {
      webOnly: {
        value: {
          format: 'themis.mode-negotiation-request',
          requestId: `${runId}-web-request`,
          clientId: `${runId}-web-client`,
          clientProfile: 'web-webcrypto',
          supportedModes: ['webcrypto'],
          supportedVersions: [1],
          requestedCapabilities: ['projection', 'sync'],
          preferredMode: 'webcrypto',
          allowDowngrade: false,
          claim: claim(fixture, 'web-webcrypto'),
        },
      },
      agentAssisted: {
        value: {
          format: 'themis.mode-negotiation-request',
          requestId: `${runId}-agent-request`,
          clientId: fixture.agentDeviceId,
          clientProfile: 'web-local-agent',
          supportedModes: ['local-agent', 'webcrypto'],
          supportedVersions: [1],
          requestedCapabilities: ['bridge', 'recovery'],
          preferredMode: 'local-agent',
          allowDowngrade: true,
          claim: claim(fixture, 'web-local-agent'),
        },
      },
    },
    '/sync/{workspaceId}/envelopes': {
      append: {
        value: {
          envelope: envelope(fixture.workspaceId, `${runId}-sync-object`, { recipientDeviceId: fixture.agentDeviceId }),
          deviceId: fixture.agentDeviceId,
          enrollmentVersion: fixture.enrollmentVersion,
        },
      },
    },
    '/sync/{workspaceId}/checkpoints': {
      create: {
        value: {
          checkpointId: `${runId}-checkpoint`,
          cursor: 1,
          revision: 1,
          envelope: envelope(fixture.workspaceId, `${runId}-sync-object`, { recipientDeviceId: fixture.agentDeviceId }),
          deviceId: fixture.agentDeviceId,
          enrollmentVersion: fixture.enrollmentVersion,
        },
      },
    },
    '/sync/{workspaceId}/devices/{deviceId}/enroll': {
      enroll: {
        value: {
          approverDeviceId: fixture.agentDeviceId,
          envelope: envelope(fixture.workspaceId, `${runId}-device-key`, { recipientDeviceId: fixture.agentDeviceId }),
        },
      },
    },
    '/sync/{workspaceId}/devices/recover': {
      recover: {
        value: {
          lostDeviceId: fixture.agentDeviceId,
          replacementDeviceId: fixture.agentDeviceId,
          approverDeviceIds: [fixture.agentDeviceId, fixture.agentDeviceId],
          allDeviceLoss: false,
          envelope: envelope(fixture.workspaceId, `${runId}-recovery-key`, {
            recipientDeviceId: fixture.agentDeviceId,
          }),
        },
      },
    },
    '/webauthn/{workspaceId}/recovery': {
      register: { value: { requestId: `${runId}-openapi-recovery`, confirmed: true } },
    },
    '/webauthn/{workspaceId}/recovery/{recoveryId}/use': {
      use: { value: { requestId: `${runId}-openapi-recovery-use`, confirmed: true } },
    },
    '/webauthn/{workspaceId}/credentials': {
      register: {
        value: {
          credentialId: fixture.credentialId,
          rpId: 'example.test',
          origin: 'https://example.test',
          prfSupported: true,
          transports: ['internal'],
        },
      },
    },
    '/auth/passkey/registration/begin': {
      smoke: { value: { label: 'OpenAPI smoke' } },
    },
    '/auth/passkey/authentication/begin': {
      smoke: { value: { email: fixture.smokeEmail } },
    },
  };

  for (const [path, examples] of Object.entries(bodyExamples)) {
    const operation = (paths[path] as JsonRecord | undefined)?.post;
    const content = ((operation?.requestBody as JsonRecord | undefined)?.content as JsonRecord | undefined)?.[
      'application/json'
    ] as JsonRecord | undefined;

    if (content) {
      content.examples = examples;
    }
  }

  if (passkeyState.examples) {
    const completeExamples = [
      ['/auth/passkey/registration/begin', passkeyState.examples.registrationBegin],
      ['/auth/passkey/registration/complete', passkeyState.examples.registrationComplete],
      ['/auth/passkey/authentication/begin', passkeyState.examples.authenticationBegin],
      ['/auth/passkey/authentication/complete', passkeyState.examples.authenticationComplete],
    ] as const;

    for (const [path, value] of completeExamples) {
      const operation = (paths[path] as JsonRecord | undefined)?.post;

      if (!operation) {
        continue;
      }

      const content = ((operation.requestBody as JsonRecord | undefined)?.content as JsonRecord | undefined)?.[
        'application/json'
      ] as JsonRecord | undefined;

      if (content) {
        content.examples = { smoke: { value } };
      }
    }
  }

  for (const path of [
    '/auth/passkey/registration/begin',
    '/auth/passkey/registration/complete',
    '/auth/passkey/authentication/begin',
    '/auth/passkey/authentication/complete',
  ]) {
    const operation = (paths[path] as JsonRecord | undefined)?.post;

    if (operation) {
      const parameters = (operation.parameters ??= []) as JsonRecord[];

      if (!parameters.some((parameter) => parameter.in === 'header' && parameter.name === 'Origin')) {
        parameters.push({
          in: 'header',
          name: 'Origin',
          required: true,
          example: origin,
          schema: { type: 'string', format: 'uri' },
        });
      }
      const responses = (operation.responses ??= {}) as JsonRecord;

      responses['429'] ??= {
        description: 'Passkey rate limit exceeded.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { const: 'rate_limited' },
                message: { type: 'string' },
              },
            },
          },
        },
      };
    }
  }

  if (includePathRegex) {
    // Schemathesis executes operation examples independently.  A persisted
    // complete example is invalidated when the corresponding begin operation
    // runs first, so ceremony success is covered by the preceding real-HTTP
    // smoke flow while the contract run exercises the begin operations.
    const contractPathRegex = passkeyOnly ? '^/auth/passkey/(registration|authentication)/begin$' : includePathRegex;
    const includePath = new RegExp(contractPathRegex);

    schema.paths = Object.fromEntries(Object.entries(paths).filter(([path]) => includePath.test(path)));
  }

  const schemaPath = resolve(reportDirectory, `${runId.toLowerCase()}-openapi-schema.json`);

  await writeFile(schemaPath, JSON.stringify(schema, null, 2));

  return schemaPath;
}

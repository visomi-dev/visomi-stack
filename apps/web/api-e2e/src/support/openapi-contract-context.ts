import { resolve } from 'node:path';
import type { generateKeyPairSync } from 'node:crypto';

export const host = process.env.HOST ?? 'localhost';

export const port = Number(process.env.GATEWAY_PORT ?? 8080);

export const baseUrl = `http://${host}:${port}`;

export const origin = baseUrl;

export const apiUrl = `${baseUrl}/api`;

export const schemaUrl = `${apiUrl}/openapi.json`;

export const reportDirectory = resolve(process.cwd(), 'dist/test-results/api-e2e/openapi');

export const runId = process.env['PZS005_RUN_ID'] ?? 'RUN-239';

export const stableReportDirectory = resolve(process.cwd(), `dist/test-results/api-e2e/${runId.toLowerCase()}`);

export const rawDirectory = resolve(reportDirectory, 'raw');

export const serverEntryPoint = resolve(process.cwd(), 'dist/apps/web/server/main.js');

export const pidPath = resolve(process.cwd(), 'apps/web/api-e2e/.api-e2e-openapi-server.pid');

export const clockFilePath = resolve(reportDirectory, '.passkey-clock');

export const clockAdvanceFilePath = resolve(reportDirectory, '.passkey-clock-advance');

export const clockPreloadPath = resolve(process.cwd(), 'apps/web/api-e2e/src/support/fake-clock.cjs');

export const includePathRegex = process.env.SCHEMATHESIS_INCLUDE_PATH_REGEX;

export const generationMode = process.env.SCHEMATHESIS_MODE ?? 'all';

export const syncOnly = process.env['PZS005_SYNC_ONLY'] === 'true';

export const passkeyOnly = includePathRegex?.startsWith('^/auth/passkey/') ?? false;

export const phases = process.env.SCHEMATHESIS_PHASES ?? (passkeyOnly ? 'examples' : 'examples,coverage');

export type Fixture = {
  cookie: string;
  smokeCookie: string;
  accountId: string;
  userId: string;
  email: string;
  smokeEmail: string;
  unverifiedEmail: string;
  isolatedCookie: string;
  isolatedAccountId: string;
  workspaceId: string;
  ownerDeviceId: string;
  agentDeviceId: string;
  enrollmentVersion: number;
  agentPrivateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  recoveryId: string;
  credentialId: string;
  schemaExampleEmail: string;
  schemaExampleCookie: string;
  schemaExampleRegistration: { challengeId: string; response: JsonRecord };
};

export type JsonRecord = { [key: string]: unknown };

export type PasskeySmokeResult = {
  name: string;
  path: string;
  status: number;
  observed: boolean;
  assertion: string;
  observation: HttpObservation;
};

export type PasskeyExamples = {
  registrationBegin: JsonRecord;
  registrationComplete: JsonRecord;
  authenticationBegin: JsonRecord;
  authenticationComplete: JsonRecord;
};

export type HttpObservation = {
  method: string;
  path: string;
  status: number;
  body: JsonRecord;
  timingMs: number;
  correlationId: string;
  requestBody?: string;
  requestHeaders: JsonRecord;
  responseHeaders: JsonRecord;
  sessionCookie?: string;
};

export const rawHttpObservations: Array<{
  method: string;
  path: string;
  status: number;
  requestBody?: string;
  body: string;
}> = [];

export const passkeyHttpObservations: Array<{
  method: string;
  path: string;
  status: number;
  requestBody?: string;
  body: JsonRecord;
  timingMs: number;
  requestHeaders: JsonRecord;
  responseHeaders: JsonRecord;
}> = [];

export const syncCaseObservations: Array<{
  case: string;
  acceptanceCriterion: string;
  method: string;
  path: string;
  status: number;
  code?: string;
  body: JsonRecord;
  timingMs: number;
  correlationId: string;
  requestHeaders: JsonRecord;
  responseHeaders: JsonRecord;
  requestBody?: string;
  artifactHash: string;
}> = [];

export const passkeyState: { examples?: PasskeyExamples } = {};

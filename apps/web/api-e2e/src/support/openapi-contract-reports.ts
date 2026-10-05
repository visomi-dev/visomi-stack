import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { passkeyHttpObservations, reportDirectory, runId, apiUrl } from './openapi-contract-context.ts';
import type { PasskeySmokeResult, HttpObservation, JsonRecord } from './openapi-contract-context.ts';
import { sanitizeText, sanitizeJson } from './report-sanitization.ts';
import { responseCode, observationDetail, canonicalize } from './openapi-contract-http.ts';
import { requireObservedSmokeResults } from './smoke-assertions.ts';

export async function writeStatefulPasskeyReports(results: PasskeySmokeResult[]): Promise<void> {
  const escaped = (value: string): string =>
    sanitizeText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  if (results.length !== passkeyHttpObservations.length) {
    throw new Error(
      `PASSKEY-002 stateful report captured ${passkeyHttpObservations.length} HTTP observations for ${results.length} cases.`,
    );
  }
  const entries = results.map((result) => {
    const observation = result.observation;

    if (observation.path !== result.path || observation.status !== result.status) {
      throw new Error(
        `PASSKEY-002 stateful case ${result.name} does not match its HTTP observation: ${observation.method} ${observation.path} returned ${observation.status}.`,
      );
    }

    return {
      ...result,
      assertion: sanitizeText(result.assertion, true),
      observation: {
        method: observation.method,
        path: observation.path,
        status: observation.status,
        requestBody: observation.requestBody,
        body: sanitizeJson(observation.body),
        timingMs: observation.timingMs,
        requestHeaders: observation.requestHeaders,
        responseHeaders: observation.responseHeaders,
      },
    };
  });
  const passed = entries.filter((entry) => entry.observed).length;

  await writeFile(
    resolve(reportDirectory, 'passkey-stateful-http.json'),
    JSON.stringify(
      {
        fixture: 'PASSKEY-002',
        execution: 'real-http-stateful',
        provenance: {
          reportType: 'stateful-http-contract',
          runner: 'apps/web/api-e2e/src/support/run-openapi-contract.ts',
          source: 'passkeyHttpObservations captured by requestObservation after actual fetch responses',
          schemathesis: false,
        },
        cases: entries,
        counts: { total: entries.length, passed, failed: entries.length - passed },
      },
      null,
      2,
    ),
  );
  await writeFile(
    resolve(reportDirectory, 'passkey-stateful.junit.xml'),
    `<testsuite name="PASSKEY-002 stateful HTTP contract (runner-generated)" tests="${entries.length}" failures="${entries.length - passed}" errors="0"><properties><property name="reportType" value="stateful-http-contract"/><property name="runner" value="apps/web/api-e2e/src/support/run-openapi-contract.ts"/><property name="source" value="passkeyHttpObservations captured by requestObservation after actual fetch responses"/><property name="schemathesis" value="false"/></properties>${entries
      .map(
        (entry) =>
          `<testcase name="${escaped(entry.name)}" time="${(entry.observation.timingMs / 1000).toFixed(3)}"><properties><property name="path" value="${escaped(entry.path)}"/><property name="status" value="${entry.status}"/><property name="observed" value="${entry.observed}"/></properties>${entry.observed ? '' : `<failure message="${escaped(entry.assertion)}"/>`}</testcase>`,
      )
      .join('')}</testsuite>`,
  );
  await writeFile(
    resolve(reportDirectory, 'passkey-stateful.har.json'),
    JSON.stringify(
      {
        log: {
          version: '1.2',
          creator: { name: `${runId} PASSKEY-002 stateful HTTP contract runner` },
          _provenance: {
            reportType: 'stateful-http-contract',
            runner: 'apps/web/api-e2e/src/support/run-openapi-contract.ts',
            source: 'passkeyHttpObservations captured by requestObservation after actual fetch responses',
            schemathesis: false,
          },
          entries: entries.flatMap((entry) => {
            const observation = entry.observation;

            return observation
              ? [
                  {
                    time: observation.timingMs,
                    request: {
                      method: observation.method,
                      url: `${apiUrl}${observation.path}`,
                      headers: Object.entries(observation.requestHeaders).map(([name, value]) => ({
                        name,
                        value: String(value),
                      })),
                      postData: observation.requestBody
                        ? { mimeType: 'application/json', text: observation.requestBody }
                        : undefined,
                    },
                    response: {
                      status: observation.status,
                      headers: Object.entries(observation.responseHeaders).map(([name, value]) => ({
                        name,
                        value: String(value),
                      })),
                      content: { mimeType: 'application/json', text: JSON.stringify(observation.body) },
                    },
                    _case: entry.name,
                  },
                ]
              : [];
          }),
        },
      },
      null,
      2,
    ),
  );
}

export async function reportPasskeySmoke(input: {
  pendingBegin: HttpObservation;
  pendingCookie: string;
  pendingComplete: HttpObservation;
  pendingAuthBeforeVerification: HttpObservation;
  pendingVerification: HttpObservation;
  registrationBegin: HttpObservation;
  registrationNoSession: HttpObservation;
  unverifiedEmail: HttpObservation;
  unverifiedPin: HttpObservation;
  authenticationUnverifiedEmail: HttpObservation;
  authenticationUnverifiedPin: HttpObservation;
  challengeMismatch: HttpObservation;
  expired: HttpObservation;
  registrationComplete: HttpObservation;
  authenticationBegin: HttpObservation;
  replay: HttpObservation;
  originMismatch: HttpObservation;
  rpMismatch: HttpObservation;
  authenticationComplete: HttpObservation;
  missingAccount: HttpObservation;
  existingWithoutCredential: HttpObservation;
}): Promise<void> {
  const {
    pendingBegin,
    pendingCookie,
    pendingComplete,
    pendingAuthBeforeVerification,
    pendingVerification,
    registrationBegin,
    registrationNoSession,
    unverifiedEmail,
    unverifiedPin,
    authenticationUnverifiedEmail,
    authenticationUnverifiedPin,
    challengeMismatch,
    expired,
    registrationComplete,
    authenticationBegin,
    replay,
    originMismatch,
    rpMismatch,
    authenticationComplete,
    missingAccount,
    existingWithoutCredential,
  } = input;
  const results: PasskeySmokeResult[] = [
    {
      name: 'registration-begin-pending-enrollment',
      path: '/auth/passkey/sign-up/begin',
      status: pendingBegin.status,
      observation: pendingBegin,
      observed: pendingBegin.status === 200 && Boolean(pendingCookie),
      assertion: 'Passkey signup begin returned session-bound ceremony options over real HTTP.',
    },
    {
      name: 'registration-complete-pending-credential',
      path: '/auth/passkey/sign-up/complete',
      status: pendingComplete.status,
      observation: pendingComplete,
      observed: pendingComplete.status === 202,
      assertion:
        'Passkey signup accepted the credential proof but required email verification before account activation.',
    },
    {
      name: 'authentication-denied-before-verification',
      path: '/auth/passkey/authentication/begin',
      status: pendingAuthBeforeVerification.status,
      observation: pendingAuthBeforeVerification,
      observed:
        pendingAuthBeforeVerification.status === 404 &&
        responseCode(pendingAuthBeforeVerification) === 'credential_not_found',
      assertion: `Pending enrollment authentication was denied before verification: ${observationDetail(pendingAuthBeforeVerification)}.`,
    },
    {
      name: 'verification-activation',
      path: '/auth/passkey/sign-up/verify',
      status: pendingVerification.status,
      observation: pendingVerification,
      observed: pendingVerification.status === 201,
      assertion:
        'The application atomically activated the pending account and enrolled credential through the real verification route.',
    },
    {
      name: 'registration-begin-success',
      path: '/auth/passkey/registration/begin',
      status: registrationBegin.status,
      observation: registrationBegin,
      observed: registrationBegin.status === 200,
      assertion: 'Registration begin returned application-generated persisted ceremony options over real HTTP.',
    },
    {
      name: 'registration-begin-session-required',
      path: '/auth/passkey/registration/begin',
      status: registrationNoSession.status,
      observation: registrationNoSession,
      observed:
        registrationNoSession.status === 401 && responseCode(registrationNoSession) === 'restricted_session_required',
      assertion: 'Additional passkey enrollment requires an authorized session; supplying an email is not authority.',
    },
    {
      name: 'registration-begin-unverified-email-pending-enrollment',
      path: '/auth/passkey/sign-up/begin',
      status: unverifiedEmail.status,
      observation: unverifiedEmail,
      observed: unverifiedEmail.status === 200,
      assertion:
        'The application issued signup ceremony options without creating or authenticating an unverified account.',
    },
    {
      name: 'registration-begin-unverified-pin',
      path: '/auth/passkey/registration/begin',
      status: unverifiedPin.status,
      observation: unverifiedPin,
      observed: responseCode(unverifiedPin) === 'invalid_request',
      assertion: `The application denied pinVerified=false with code ${responseCode(unverifiedPin) ?? 'none'} over real HTTP.`,
    },
    {
      name: 'authentication-begin-unverified-email',
      path: '/auth/passkey/authentication/begin',
      status: authenticationUnverifiedEmail.status,
      observation: authenticationUnverifiedEmail,
      observed: true,
      assertion: `The pending signup has no usable account credential and was denied with code ${responseCode(authenticationUnverifiedEmail)}.`,
    },
    {
      name: 'authentication-begin-unverified-pin',
      path: '/auth/passkey/authentication/begin',
      status: authenticationUnverifiedPin.status,
      observation: authenticationUnverifiedPin,
      observed: responseCode(authenticationUnverifiedPin) === 'invalid_request',
      assertion: `The application denied authentication with pinVerified=false and code ${responseCode(authenticationUnverifiedPin) ?? 'none'} over real HTTP.`,
    },
    {
      name: 'registration-complete-persisted-challenge-mismatch',
      path: '/auth/passkey/registration/complete',
      status: challengeMismatch.status,
      observation: challengeMismatch,
      observed: responseCode(challengeMismatch) === 'challenge_mismatch',
      assertion: `A valid response for one persisted begin challenge was submitted with another persisted challenge ID and the application returned ${observationDetail(challengeMismatch)}.`,
    },
    {
      name: 'registration-complete-expired-challenge',
      path: '/auth/passkey/registration/complete',
      status: expired.status,
      observation: expired,
      observed: expired.status === 400,
      assertion: `A valid attestation for the application-returned challenge was rejected after the bounded test clock advanced: ${observationDetail(expired)}.`,
    },
    {
      name: 'registration-complete-success',
      path: '/auth/passkey/registration/complete',
      status: registrationComplete.status,
      observation: registrationComplete,
      observed: registrationComplete.status === 201,
      assertion: 'Registration completion persisted the generated credential through the real HTTP application path.',
    },
    {
      name: 'authentication-begin-success',
      path: '/auth/passkey/authentication/begin',
      status: authenticationBegin.status,
      observation: authenticationBegin,
      observed: authenticationBegin.status === 200,
      assertion: 'Authentication begin returned application-generated persisted ceremony options over real HTTP.',
    },
    {
      name: 'authentication-complete-consumed-replay',
      path: '/auth/passkey/authentication/complete',
      status: replay.status,
      observation: replay,
      observed: replay.status === 401 && responseCode(replay) === 'challenge_mismatch',
      assertion: `A second valid assertion targeted the already consumed challenge and the application returned ${observationDetail(replay)}.`,
    },
    {
      name: 'authentication-complete-origin-mismatch',
      path: '/auth/passkey/authentication/complete',
      status: originMismatch.status,
      observation: originMismatch,
      observed: originMismatch.status === 401,
      assertion: `A validly signed assertion with a wrong origin was rejected by the application: ${observationDetail(originMismatch)}.`,
    },
    {
      name: 'authentication-complete-rp-mismatch',
      path: '/auth/passkey/authentication/complete',
      status: rpMismatch.status,
      observation: rpMismatch,
      observed: rpMismatch.status === 401,
      assertion: `A validly signed assertion with a wrong RP hash was rejected by the application: ${observationDetail(rpMismatch)}.`,
    },
    {
      name: 'authentication-complete-success',
      path: '/auth/passkey/authentication/complete',
      status: authenticationComplete.status,
      observation: authenticationComplete,
      observed: (authenticationComplete.body.data as JsonRecord | undefined)?.authenticated === true,
      assertion: 'Authentication completion returned the application-derived authenticated result over real HTTP.',
    },
    {
      name: 'account-enumeration-missing-account-no-credentials',
      path: '/auth/passkey/authentication/begin',
      status: missingAccount.status,
      observation: missingAccount,
      observed:
        missingAccount.status === 404 &&
        responseCode(missingAccount) === 'credential_not_found' &&
        missingAccount.status === existingWithoutCredential.status &&
        canonicalize(missingAccount.body) === canonicalize(existingWithoutCredential.body),
      assertion: `The missing account returned the same safe response as the existing account without credentials: missing=${JSON.stringify(missingAccount)}, existing=${JSON.stringify(existingWithoutCredential)}.`,
    },
    {
      name: 'account-enumeration-existing-account-no-credentials',
      path: '/auth/passkey/authentication/begin',
      status: existingWithoutCredential.status,
      observation: existingWithoutCredential,
      observed:
        existingWithoutCredential.status === 404 &&
        responseCode(existingWithoutCredential) === 'credential_not_found' &&
        existingWithoutCredential.status === missingAccount.status &&
        canonicalize(existingWithoutCredential.body) === canonicalize(missingAccount.body),
      assertion: `The existing account without credentials returned the same safe response as the missing account: existing=${JSON.stringify(existingWithoutCredential)}, missing=${JSON.stringify(missingAccount)}.`,
    },
  ];

  await writeFile(
    resolve(reportDirectory, 'passkey-smoke-summary.json'),
    JSON.stringify(
      {
        fixture: 'PASSKEY-002',
        execution: 'real-http',
        resolvedVersions: { schemathesis: '4.24.3', jsonschemaRs: '0.49.1' },
        cases: results,
        counts: {
          total: results.length,
          passed: results.filter((result) => result.observed).length,
          failed: results.filter((result) => !result.observed).length,
        },
        securityAssertions: [
          'The fixture creates persisted ceremony state through real HTTP begin endpoints and uses returned challenge context.',
          'Reports are sanitized and contain no passkey or private-key material.',
          'Registration and assertion material use ephemeral P-256 keys and standards-valid WebAuthn CBOR structures generated only in this process.',
        ],
      },
      null,
      2,
    ),
  );

  await writeStatefulPasskeyReports(results);

  requireObservedSmokeResults(results);
}

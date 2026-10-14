import { writeFile } from 'node:fs/promises';

import { passkeyOnly, host, origin, apiUrl, clockFilePath, passkeyState } from './openapi-contract-context.ts';
import type { Fixture, JsonRecord } from './openapi-contract-context.ts';
import { requestObservation, observationDetail, requireResponseCode, requestJson } from './openapi-contract-http.ts';
import { createRegistrationFixture, createAuthenticationResponse } from './webauthn-fixture.ts';
import { reportPasskeySmoke } from './openapi-contract-reports.ts';

export async function verifyPasskeySmoke(fixture: Fixture): Promise<void> {
  let headers = {
    Cookie: passkeyOnly ? fixture.isolatedCookie : fixture.smokeCookie,
    'Content-Type': 'application/json',
  };
  const accountHeaders = { Cookie: fixture.cookie, 'Content-Type': 'application/json' };
  const rpId = host;
  const pendingEmail = `openapi-passkey-pending-${Date.now().toString(36)}@example.test`;
  const pendingBegin = await requestObservation('/auth/passkey/sign-up/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: pendingEmail }),
  });
  const pendingData = pendingBegin.body.data as JsonRecord;
  const pendingCookie = pendingBegin.sessionCookie;

  if (pendingBegin.status !== 200 || !pendingCookie || typeof pendingData.options !== 'object') {
    throw new Error(`Pending registration begin failed: ${observationDetail(pendingBegin)}`);
  }
  const pendingRegistration = createRegistrationFixture(pendingData.options as JsonRecord, origin, rpId);
  const pendingComplete = await requestObservation('/auth/passkey/sign-up/complete', {
    method: 'POST',
    headers: { Cookie: pendingCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId: pendingData.challengeId, response: pendingRegistration.response }),
  });
  const pendingAuthBeforeVerification = await requestObservation('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: pendingEmail }),
  });
  const pendingMailbox = await fetch(
    `${apiUrl}/test/mailbox/latest?email=${encodeURIComponent(pendingEmail)}&purpose=bootstrap_recovery`,
  );
  const pendingMessage = await pendingMailbox.json();
  const pendingPin = (pendingMessage as { pin?: string }).pin;

  if (!pendingPin) {
    throw new Error('Pending enrollment fixture did not receive a verification PIN.');
  }
  const pendingVerification = await requestObservation('/auth/passkey/sign-up/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: pendingCookie },
    body: JSON.stringify({ code: pendingPin }),
  });

  if (pendingVerification.status === 201 && pendingVerification.sessionCookie) {
    headers = { Cookie: pendingVerification.sessionCookie, 'Content-Type': 'application/json' };
  }

  if (pendingVerification.status !== 201 || !pendingVerification.sessionCookie) {
    throw new Error(
      `Pending enrollment verification did not activate an authenticated session: ${observationDetail(pendingVerification)}`,
    );
  }

  if (pendingComplete.status !== 202) {
    throw new Error(`Pending registration complete failed: ${observationDetail(pendingComplete)}`);
  }

  const pendingCredentialId = pendingRegistration.credentialId;

  const pendingCredential = { ...pendingRegistration, credentialId: pendingCredentialId };
  const authenticationBegin = await requestObservation('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: pendingEmail }),
  });

  if (authenticationBegin.status !== 200) {
    throw new Error(`Authentication begin failed: ${observationDetail(authenticationBegin)}`);
  }
  const authenticationData = authenticationBegin.body.data as JsonRecord;
  const authenticationResponse = createAuthenticationResponse(
    authenticationData.options as JsonRecord,
    pendingCredential,
    origin,
    rpId,
  );
  const authenticationComplete = await requestObservation('/auth/passkey/authentication/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ challengeId: authenticationData.challengeId, response: authenticationResponse }),
  });

  if (authenticationComplete.status !== 200 || !authenticationComplete.sessionCookie) {
    throw new Error(
      `Authentication complete did not return a reauthenticated session: ${observationDetail(authenticationComplete)}`,
    );
  }

  headers = { Cookie: authenticationComplete.sessionCookie, 'Content-Type': 'application/json' };

  const noSessionHeaders = { 'Content-Type': 'application/json' };
  const registrationHeaders = headers;
  const registrationBegin = await requestObservation('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: registrationHeaders,
    body: JSON.stringify({ label: 'OpenAPI additional passkey' }),
  });
  const registrationNoSession = await requestObservation('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: noSessionHeaders,
    body: JSON.stringify({ label: 'OpenAPI unauthorized' }),
  });
  const unverifiedEmail = await requestObservation('/auth/passkey/sign-up/begin', {
    method: 'POST',
    headers: noSessionHeaders,
    body: JSON.stringify({ email: fixture.unverifiedEmail }),
  });

  const unverifiedPin = await requestObservation('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: accountHeaders,
    body: JSON.stringify({ email: fixture.email, label: 'OpenAPI unverified PIN', pinVerified: false }),
  });

  const authenticationUnverifiedEmail = await requestObservation('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: fixture.unverifiedEmail }),
  });

  requireResponseCode(authenticationUnverifiedEmail, 'credential_not_found', 'authentication-begin-unverified-email');

  const authenticationUnverifiedPin = await requestObservation('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: fixture.email, pinVerified: false }),
  });

  requireResponseCode(authenticationUnverifiedPin, 'invalid_request', 'authentication-begin-unverified-pin');

  const registrationData = registrationBegin.body.data as JsonRecord;

  if (registrationBegin.status !== 200) {
    throw new Error(`Registration begin failed: ${observationDetail(registrationBegin)}`);
  }
  const registrationChallengeId = String(registrationData.challengeId);

  const mismatchBegin = await requestJson('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: registrationHeaders,
    body: JSON.stringify({ label: 'OpenAPI smoke state' }),
  });
  const mismatchData = mismatchBegin.data as JsonRecord;
  const mismatchCredential = createRegistrationFixture(mismatchData.options as JsonRecord, origin, rpId);
  const challengeMismatch = await requestObservation('/auth/passkey/registration/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ challengeId: registrationChallengeId, response: mismatchCredential.response }),
  });
  const expiredBeginResult = await requestJson('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: registrationHeaders,
    body: JSON.stringify({ label: 'OpenAPI expired state' }),
  });
  const expiredData = expiredBeginResult.data as JsonRecord;
  const expiredFixture = createRegistrationFixture(expiredData.options as JsonRecord, origin, rpId);

  await writeFile(clockFilePath, String(Date.now() + 6 * 60 * 1000));
  const expired = await requestObservation('/auth/passkey/registration/complete', {
    method: 'POST',
    headers: registrationHeaders,
    body: JSON.stringify({ challengeId: expiredData.challengeId, response: expiredFixture.response }),
  });

  await writeFile(clockFilePath, String(Date.now() - 6 * 60 * 1000));
  const successfulBegin = await requestJson('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: registrationHeaders,
    body: JSON.stringify({ label: 'OpenAPI smoke state' }),
  });
  const successfulData = successfulBegin.data as JsonRecord;
  const generatedCredential = createRegistrationFixture(successfulData.options as JsonRecord, origin, rpId);
  const registrationComplete = await requestObservation('/auth/passkey/registration/complete', {
    method: 'POST',
    headers: registrationHeaders,
    body: JSON.stringify({ challengeId: successfulData.challengeId, response: generatedCredential.response }),
  });

  if (registrationComplete.status !== 201) {
    throw new Error(`Registration complete failed: ${observationDetail(registrationComplete)}`);
  }

  const persistedCredentialId = String(
    ((registrationComplete.body.data as JsonRecord | undefined)?.credential as JsonRecord | undefined)?.id ?? '',
  );

  if (!persistedCredentialId || persistedCredentialId !== generatedCredential.credentialId) {
    throw new Error('The application did not return the generated credential persisted by registration-complete.');
  }
  const authenticationHeaders = headers;

  const replay = await requestObservation('/auth/passkey/authentication/complete', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({
      challengeId: authenticationData.challengeId,
      response: createAuthenticationResponse(
        authenticationData.options as JsonRecord,
        pendingCredential,
        origin,
        rpId,
        undefined,
        undefined,
        2,
      ),
    }),
  });
  const originBegin = await requestJson('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({ email: pendingEmail }),
  });
  const originData = originBegin.data as JsonRecord;
  const originResponse = createAuthenticationResponse(
    originData.options as JsonRecord,
    pendingCredential,
    origin,
    rpId,
    'https://wrong.example.test',
  );
  const originMismatch = await requestObservation('/auth/passkey/authentication/complete', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({ challengeId: originData.challengeId, response: originResponse }),
  });
  const rpBegin = await requestJson('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({ email: pendingEmail }),
  });
  const rpData = rpBegin.data as JsonRecord;
  const rpResponse = createAuthenticationResponse(
    rpData.options as JsonRecord,
    pendingCredential,
    origin,
    rpId,
    undefined,
    'wrong.example.test',
  );
  const rpMismatch = await requestObservation('/auth/passkey/authentication/complete', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({ challengeId: rpData.challengeId, response: rpResponse }),
  });

  const missingAccount = await requestObservation('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers: noSessionHeaders,
    body: JSON.stringify({ email: `openapi-missing-${Date.now()}@example.test` }),
  });
  const existingWithoutCredential = await requestObservation('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers: noSessionHeaders,
    body: JSON.stringify({ email: fixture.email }),
  });
  const schemaRegistrationBegin = await requestJson('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({ label: 'OpenAPI contract example' }),
  });
  const schemaRegistrationData = schemaRegistrationBegin.data as JsonRecord;
  const schemaRegistration = createRegistrationFixture(schemaRegistrationData.options as JsonRecord, origin, rpId);

  const schemaAuthenticationBegin = await requestJson('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({ email: pendingEmail }),
  });
  const schemaAuthenticationData = schemaAuthenticationBegin.data as JsonRecord;
  const schemaAuthenticationResponse = createAuthenticationResponse(
    schemaAuthenticationData.options as JsonRecord,
    pendingCredential,
    origin,
    rpId,
  );

  passkeyState.examples = {
    registrationBegin: {
      label: 'OpenAPI contract example',
    },
    registrationComplete: {
      challengeId: schemaRegistrationData.challengeId,
      response: schemaRegistration.response,
    },
    authenticationBegin: { email: pendingEmail },
    authenticationComplete: {
      challengeId: schemaAuthenticationData.challengeId,
      response: schemaAuthenticationResponse,
    },
  };
  fixture.schemaExampleCookie = authenticationHeaders.Cookie;

  await reportPasskeySmoke({
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
  });
}

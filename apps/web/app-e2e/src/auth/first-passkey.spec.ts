import { expect, test, type APIRequestContext } from '@playwright/test';

import { addVirtualAuthenticator, authenticateViaDeterministicTestSession, createCredentials } from '../support/auth';
import { readLatestPin } from '../support/mailbox';

const password = 'first-passkey-test-password';

async function createPasswordOnlyUser(request: APIRequestContext, email: string, origin: string) {
  const restricted = await request.post('/api/test/auth/session', { data: { email, mode: 'restricted' } });

  expect(restricted.ok()).toBe(true);
  const configured = await request.post('/api/auth/password/set', {
    headers: { Origin: origin },
    data: { password },
  });

  expect(configured.ok()).toBe(true);
}

test.beforeEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});

test.afterEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});

test('enrolls and verifies the first passkey using the current password and server-selected email code', async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error('First-passkey tests require a configured baseURL.');
  const { email } = createCredentials();

  await createPasswordOnlyUser(request, email, new URL(baseURL).origin);
  // Only bootstrap the signed-in UI: enrollment authority must come from the real proof endpoints.
  await authenticateViaDeterministicTestSession(page, request, email, password);
  await addVirtualAuthenticator(page);
  const initialKeys = await page.request.get('/api/auth/passkey/credentials');

  expect(initialKeys.ok()).toBe(true);
  expect((await initialKeys.json()).data.credentials).toEqual([]);
  await page.goto('/app/en/security');
  await page.getByRole('button', { name: 'Add passkey', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Passkey name' })).toHaveCount(0);
  await page.getByLabel('Current password', { exact: true }).fill(password);
  const started = page.waitForResponse('**/api/auth/passkey/enrollment/start');

  await page.getByRole('button', { name: 'Confirm enrollment', exact: true }).click();
  const startResponse = await started;

  expect(startResponse.status()).toBe(202);
  const { flowId, requiredFactor } = (await startResponse.json()).data;

  expect(flowId).toEqual(expect.any(String));
  expect(requiredFactor).toBe('email');
  await expect(page.getByText('Enter the code we sent to your verified email.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Passkey name' })).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Verification code', exact: true })
    .fill(await readLatestPin(request, email, 'password_second_step'));
  const authorized = page.waitForResponse('**/api/auth/passkey/enrollment/complete');

  await page.getByRole('button', { name: 'Confirm enrollment', exact: true }).click();
  const authorizationResponse = await authorized;

  expect(authorizationResponse.ok()).toBe(true);
  expect(authorizationResponse.request().postDataJSON()).toMatchObject({ flowId, kind: requiredFactor });
  expect((await authorizationResponse.json()).data).toMatchObject({ authorized: true });
  await page.getByRole('textbox', { name: 'Passkey name' }).fill('First personal laptop');
  const registered = page.waitForResponse('**/api/auth/passkey/registration/complete');
  const verified = page.waitForResponse('**/api/auth/passkey/registration/verify');

  await page.getByRole('button', { name: 'Confirm and add passkey', exact: true }).click();
  expect((await registered).ok()).toBe(true);
  const verificationResponse = await verified;

  expect(verificationResponse.ok()).toBe(true);
  expect((await verificationResponse.json()).data).toMatchObject({ authenticated: true, user: { email } });
  await expect(page.getByText('First personal laptop', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add passkey', exact: true })).toBeVisible();
  const keys = await page.request.get('/api/auth/passkey/credentials');

  expect(keys.ok()).toBe(true);
  expect((await keys.json()).data.credentials).toEqual([
    expect.objectContaining({
      id: expect.any(String),
      label: 'First personal laptop',
      revokedAt: null,
      lastUsedAt: expect.any(String),
    }),
  ]);
  const session = await page.request.get('/api/auth/session');

  expect(session.ok()).toBe(true);
  expect((await session.json()).data.user).toMatchObject({ email, accountId: expect.any(String) });
  expect((await page.request.get('/api/auth/security/overview')).ok()).toBe(true);
});

test('rejects removal of the last password after real purpose-bound password reauthentication', async ({
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error('First-passkey tests require a configured baseURL.');
  const { email } = createCredentials();
  const headers = { Origin: new URL(baseURL).origin };

  await createPasswordOnlyUser(request, email, headers.Origin);
  expect((await request.post('/api/test/auth/session', { data: { email } })).ok()).toBe(true);
  const initialKeys = await request.get('/api/auth/passkey/credentials');

  expect(initialKeys.ok()).toBe(true);
  expect((await initialKeys.json()).data.credentials).toEqual([]);
  const started = await request.post('/api/auth/reauth/start', { headers, data: { purpose: 'password_remove' } });

  expect(started.ok()).toBe(true);
  const { grantId, methods } = (await started.json()).data;

  expect(methods).toContain('password');
  const verified = await request.post('/api/auth/reauth/complete', {
    headers,
    data: { grantId, method: 'password', password },
  });

  expect(verified.ok()).toBe(true);
  expect((await verified.json()).data).toMatchObject({ grantId, authenticated: true });
  const removed = await request.post('/api/auth/password/remove', { headers, data: { currentPassword: password } });

  expect(removed.status()).toBe(409);
  expect(await removed.json()).toMatchObject({ code: 'last_access_method' });
  const overview = await request.get('/api/auth/security/overview');

  expect(overview.ok()).toBe(true);
  expect((await overview.json()).data).toMatchObject({ passwordEnabled: true, federatedIdentities: [] });
  const session = await request.get('/api/auth/session');

  expect(session.ok()).toBe(true);
  expect((await session.json()).data.user).toMatchObject({ email });
});

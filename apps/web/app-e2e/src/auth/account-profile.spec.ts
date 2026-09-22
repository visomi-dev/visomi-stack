import { expect, test } from '@playwright/test';

import { authenticateViaDeterministicTestSession, createCredentials } from '../support/auth';

test.beforeEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});

test('keeps server-rendered account controls disabled until the browser can preserve edits', async ({
  page,
  request,
  browser,
}) => {
  await authenticateViaDeterministicTestSession(page, request, createCredentials().email, '');
  const context = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });

  try {
    const account = await context.newPage();

    await account.goto(new URL('/app/en/account', page.url()).href);
    await expect(account.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
    await expect(account.getByRole('textbox', { name: 'Display name', exact: true })).toBeDisabled();
    await expect(account.getByRole('combobox', { name: 'Preferred appearance' })).toBeDisabled();
    await expect(account.getByRole('combobox', { name: 'Preferred language' })).toBeDisabled();
    await expect(account.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
    await expect(account.getByRole('textbox', { name: 'New email address', exact: true })).toBeDisabled();
  } finally {
    await context.close();
  }
});

test('persists a profile, applies appearance immediately, and preserves account routing when changing language', async ({
  page,
  request,
}) => {
  const { email } = createCredentials();

  await authenticateViaDeterministicTestSession(page, request, email, '');
  await page.goto('/app/en/account');
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Account profile example');
  await page.getByRole('combobox', { name: 'Preferred appearance' }).selectOption('dark');
  await expect(page.getByRole('combobox', { name: 'Preferred appearance' })).toHaveValue('dark');
  await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('Account profile example');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your profile and preferences were saved.');
  await expect(page.locator('html')).toHaveClass(/dark/);
  const response = await page.request.get('/api/account/profile');

  expect(response.ok()).toBe(true);
  expect((await response.json()).data.profile).toMatchObject({
    displayName: 'Account profile example',
    preferences: { locale: 'en', theme: 'dark' },
  });

  await page.getByRole('combobox', { name: 'Preferred appearance' }).selectOption('system');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your profile and preferences were saved.');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.getByRole('combobox', { name: 'Preferred language' }).selectOption('es');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/es\/account$/);
  await expect(page.locator('html')).toHaveAttribute('lang', /^es/);
  const saved = await page.request.get('/api/account/profile');

  expect((await saved.json()).data.profile.preferences).toEqual({ locale: 'es', theme: 'system' });
});

test('exports allowlisted metadata and prevents the current owner from leaving without transfer', async ({
  page,
  request,
}) => {
  const { email } = createCredentials();

  await authenticateViaDeterministicTestSession(page, request, email, '');
  await page.goto('/app/en/account');
  await expect(page.getByRole('button', { name: 'Leave workspace immediately' })).toBeDisabled();
  await expect(page.getByText('This does not delete your account.', { exact: false })).toBeVisible();
  const response = await page.request.get('/api/account/export');

  expect(response.ok()).toBe(true);
  expect(response.headers()['content-disposition']).toContain('profile-membership-metadata.json');
  const { data } = await response.json();

  expect(data.scope).toBe('profile_and_membership_metadata');
  expect(Object.keys(data).sort()).toEqual(['exportedAt', 'memberships', 'profile', 'schemaVersion', 'scope']);
  expect(Object.keys(data.profile).sort()).toEqual([
    'createdAt',
    'displayName',
    'email',
    'emailVerifiedAt',
    'id',
    'preferences',
    'preferencesConfigured',
    'updatedAt',
  ]);
  expect(data.profile.email).toBe(email);
});

test('leaves a selected workspace through real one-use password authorization while preserving its owner access', async ({
  request,
  playwright,
  baseURL,
}) => {
  if (!baseURL) throw new Error('The account lifecycle suite requires a configured baseURL.');
  const origin = new URL(baseURL).origin;
  const owner = await request.post('/api/test/auth/session', { data: { email: createCredentials().email } });

  expect(owner.ok()).toBe(true);
  const { accountId } = (await owner.json()).data;
  const member = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  const email = createCredentials().email;
  const password = 'account-lifecycle-test-password';

  try {
    const restricted = await member.post('/api/test/auth/session', { data: { email, accountId, mode: 'restricted' } });

    expect(restricted.ok()).toBe(true);
    expect((await member.post('/api/auth/password/set', { data: { password } })).ok()).toBe(true);
    expect((await member.post('/api/test/auth/session', { data: { email } })).ok()).toBe(true);
    const before = await member.get('/api/account/profile');

    expect(before.ok()).toBe(true);
    expect((await before.json()).data.selectedAccountId).toBe(accountId);
    expect(
      (await member.post('/api/account/workspace/leave', { data: { grantId: 'unverified-grant' } })).status(),
    ).toBe(401);

    const started = await member.post('/api/auth/reauth/start', { data: { purpose: 'workspace_leave' } });

    expect(started.ok()).toBe(true);
    const { grantId, methods } = (await started.json()).data;

    expect(methods).toContain('password');
    const verified = await member.post('/api/auth/reauth/complete', {
      data: { grantId, method: 'password', password },
    });

    expect(verified.ok()).toBe(true);
    const left = await member.post('/api/account/workspace/leave', { data: { grantId } });

    expect(left.ok()).toBe(true);
    expect((await left.json()).data).toMatchObject({
      left: true,
      accountId,
      signInRequired: true,
      hasRemainingMemberships: false,
    });
    expect((await member.get('/api/account/profile')).status()).toBe(401);
    expect((await member.post('/api/account/workspace/leave', { data: { grantId } })).status()).toBe(401);
    const ownerProfile = await request.get('/api/account/profile');

    expect(ownerProfile.ok()).toBe(true);
    expect((await ownerProfile.json()).data).toMatchObject({
      selectedAccountId: accountId,
      isWorkspaceOwner: true,
      ownershipCandidates: [],
    });
  } finally {
    await member.dispose();
  }
});

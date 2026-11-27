import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { readMailCode } from '@visomi-stack/dev-testing';

export { expect } from '@playwright/test';

export const password = 'Synthetic private password 42!';
let clientSequence = 0;

export function address(): string {
  return `${randomUUID()}@example.test`;
}

async function isolatedPool(): Promise<Pool> {
  const directory = process.env['VISOMI_E2E_TELEMETRY_DIR']!;
  const result1 = await readFile(join(directory, 'database.json'), 'utf8');
  const value = JSON.parse(result1) as { url: string };
  const url = new URL(value.url);

  if (url.hostname !== '127.0.0.1' || url.pathname !== '/visomi_auth_test' || url.username !== 'visomi_test') {
    throw new Error('isolated_database_required');
  }

  return new Pool({ connectionString: url.toString() });
}

export async function expireVaultPairing(requestId: string): Promise<void> {
  const pool = await isolatedPool();

  try {
    const result = await pool.query(
      'UPDATE vault_key_challenges SET expires_at = now() WHERE id = $1 AND consumed_at IS NULL',
      [requestId],
    );

    expect(result.rowCount).toBe(1);
  } finally {
    await pool.end();
  }
}

export async function expireEmailVerification(email: string): Promise<void> {
  const pool = await isolatedPool();

  try {
    const result = await pool.query(
      "UPDATE auth_flows SET expires_at = now() - interval '1 second' WHERE email = $1 AND purpose = 'email_verify' AND consumed_at IS NULL",
      [email],
    );

    expect(result.rowCount).toBe(1);
  } finally {
    await pool.end();
  }
}

export async function expireAuthentication(email: string): Promise<void> {
  const pool = await isolatedPool();

  try {
    const result = await pool.query(
      "UPDATE auth_sessions SET sess = jsonb_set(sess, '{passport,user,authenticatedAt}', to_jsonb($1::bigint)) WHERE sess->'passport'->'user'->>'id' = (SELECT id::text FROM auth_users WHERE email = $2) AND revoked_at IS NULL",
      [Date.now() - 600000, email],
    );

    expect(result.rowCount).toBe(1);
  } finally {
    await pool.end();
  }
}

export async function saveRecoveryKey(page: Page) {
  const download = page.waitForEvent('download');

  await page.getByRole('link', { name: 'Download recovery key', exact: true }).click();

  const file = await download;

  await page.getByRole('button', { name: 'I saved my recovery key', exact: true }).click();

  return file;
}

export function vaultUnlockUrl(workspace: string | URL): string {
  const url = new URL(workspace);

  url.pathname = url.pathname.replace(/\/db-example\/vault$/, '/vault/unlock');

  return url.href;
}

export async function expireSession(email: string): Promise<void> {
  const pool = await isolatedPool();

  try {
    const result = await pool.query(
      "UPDATE auth_sessions SET expire = now() - interval '1 second' WHERE sess->'passport'->'user'->>'id' = (SELECT id::text FROM auth_users WHERE email = $1) AND revoked_at IS NULL AND expire > now()",
      [email],
    );

    expect(result.rowCount).toBe(1);
  } finally {
    await pool.end();
  }
}

export async function passkeySignup(page: Page, email = address()): Promise<string> {
  await page.goto('/app/en/auth/sign-up');

  await page.getByLabel('Email address', { exact: true }).fill(email);

  await page.getByRole('button', { name: 'Create account with a passkey', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Verify your email', exact: true })).toBeVisible({ timeout: 15000 });

  const code = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

  return email;
}

export async function virtualPasskey(page: Page, hasPrf = true) {
  const cdp = await page.context().newCDPSession(page);

  await cdp.send('WebAuthn.enable');

  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf,
    },
  });

  const credentialIds = async () => {
    const result = await cdp.send('WebAuthn.getCredentials', { authenticatorId });

    return result.credentials.map(({ credentialId }) => credentialId);
  };

  return { cdp, credentialIds };
}

/** Several full journeys run in seconds on one synthetic client. Respect the gateway's real one-minute budget. */
export async function waitForRequestWindow(): Promise<void> {
  const pool = await isolatedPool();

  try {
    const result = await pool.query<{ remaining: number }>(
      `SELECT COALESCE(CEIL(EXTRACT(EPOCH FROM (max(expires_at) - now())) * 1000), 0)::int AS remaining
       FROM auth_rate_limits WHERE key <> 'global' AND attempts >= 24
         AND expires_at BETWEEN now() AND now() + interval '1 minute'`,
    );

    await delay(result.rows[0].remaining);
  } finally {
    await pool.end();
  }
}

async function resetLimits(): Promise<void> {
  const pool = await isolatedPool();

  try {
    await pool.query('DELETE FROM auth_rate_limits');
  } finally {
    await pool.end();
  }
}

export async function signup(page: Page, email = address()): Promise<string> {
  await page.goto('/app/en/auth/sign-up/password');

  await page.getByLabel('Email address', { exact: true }).fill(email);

  await page.getByLabel('Password', { exact: true }).fill(password);

  await page.getByRole('button', { name: 'Create an account', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Verify your email', exact: true })).toBeVisible();

  const code = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

  return email;
}

export async function openAccount(page: Page): Promise<Locator> {
  const desktop = await page.locator('app-sidebar').isVisible();

  if (desktop) {
    await page.getByRole('button', { name: /^(Account menu|Menú de cuenta)$/ }).click();

    return page.locator('#workspace-account-popover');
  }

  const drawer = page.locator('#mobile-navigation');
  const drawerOpen = await drawer.isVisible();

  if (!drawerOpen) {
    await page
      .locator('nav[appUI="navbar"]')
      .getByRole('button', { name: /^(Menu|Menú)$/ })
      .click();
  }

  const details = drawer.locator('footer > details');
  const open = await details.getAttribute('open');

  if (open === null) {
    await details.locator(':scope > summary').click();
  }

  return details;
}

export async function logout(page: Page): Promise<void> {
  const account = await openAccount(page);

  await account.getByRole('button', { name: 'Sign out', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Sign-in options', exact: true })).toBeVisible();
}

export async function passwordStart(page: Page, email: string, value = password): Promise<void> {
  await page.goto('/app/en/auth/sign-in/password');

  await page.getByLabel('Email address', { exact: true }).fill(email);

  await page.getByLabel('Password', { exact: true }).fill(value);

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Confirm your sign-in', exact: true })).toBeVisible();
}

export const test = base.extend<{ rateLimitIsolation: void }>({
  rateLimitIsolation: [
    async ({ context }, use, info) => {
      // Separate journeys share a test gateway but represent distinct clients.
      const address = `198.18.${info.workerIndex}.${++clientSequence}`;

      await context.setExtraHTTPHeaders({ 'x-forwarded-for': address });

      await resetLimits();

      await use();
    },
    { auto: true },
  ],
});

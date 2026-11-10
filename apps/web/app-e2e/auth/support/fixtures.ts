import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test as base, type Page } from '@playwright/test';
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

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();

  return email;
}

export async function logout(page: Page): Promise<void> {
  await page.locator('app-sidebar').getByRole('button', { name: 'Sign out', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Sign in to your space.', exact: true })).toBeVisible();
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

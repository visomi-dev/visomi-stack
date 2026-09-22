import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { authenticateViaDeterministicTestSession, createCredentials, registerAndAuthenticate } from '../support/auth';
import { signInUrlPattern } from '../support/routes';

type SessionSummary = { id: string; current: boolean; method: string };
const sessionsRoute = '/app/en/security/sessions';

async function readSessions(page: Page): Promise<SessionSummary[]> {
  const response = await page.context().request.get('/api/auth/sessions');

  expect(response.status()).toBe(200);
  const payload: { data: SessionSummary[] } = await response.json();

  for (const session of payload.data) {
    expect(Object.keys(session).sort()).toEqual(['current', 'expiresAt', 'id', 'lastActiveAt', 'method', 'startedAt']);
    expect(session.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
  }

  return payload.data;
}

test.beforeEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});
test.afterEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});

test('isolates accounts in separate browser contexts and signs out only the current session', async ({
  page,
  browser,
  baseURL,
}) => {
  const first = createCredentials();
  const second = createCredentials();
  const otherContext = await browser.newContext({ baseURL });

  try {
    const otherPage = await otherContext.newPage();

    // Each context creates its own real server-side session; no storage state or cookies are shared.
    await authenticateViaDeterministicTestSession(page, page.context().request, first.email, '');
    await authenticateViaDeterministicTestSession(otherPage, otherContext.request, second.email, '');
    await page.goto('/app/en/security');
    await page.getByRole('link', { name: 'Manage active sessions', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/en\/security\/sessions$/);
    await otherPage.goto(sessionsRoute);

    for (const sessionPage of [page, otherPage]) {
      await expect(sessionPage.getByRole('heading', { name: 'Active sessions', exact: true })).toBeVisible();
      await expect(sessionPage.getByText('Current session', { exact: true })).toHaveCount(1);
      await expect(
        sessionPage.getByRole('button', { name: 'Sign out all other sessions', exact: true }),
      ).toBeDisabled();
      await expect(sessionPage.getByRole('button', { name: 'Sign out this session', exact: true })).toHaveCount(0);
    }
    const firstSessions = await readSessions(page);
    const secondSessions = await readSessions(otherPage);

    expect(firstSessions).toHaveLength(1);
    expect(secondSessions).toHaveLength(1);
    expect(firstSessions[0].current).toBe(true);
    expect(secondSessions[0].current).toBe(true);
    expect(firstSessions[0].id).not.toBe(secondSessions[0].id);

    await page.getByRole('button', { name: 'Sign out current session', exact: true }).click();
    await expect(page).toHaveURL(signInUrlPattern);
    expect((await page.context().request.get('/api/auth/sessions')).status()).toBe(401);
    expect(await readSessions(otherPage)).toEqual([
      expect.objectContaining({ id: secondSessions[0].id, current: true }),
    ]);
    await otherPage.reload();
    await expect(otherPage.getByText('Current session', { exact: true })).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test('revokes another signed-in context only after real passkey confirmation and keeps the current session', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const credentials = createCredentials();
  const otherContext = await browser.newContext({ baseURL });

  try {
    // The existing helper installs a virtual authenticator and enrolls a real passkey.
    await registerAndAuthenticate(page, request, credentials.email, '');
    const otherPage = await otherContext.newPage();

    await authenticateViaDeterministicTestSession(otherPage, otherContext.request, credentials.email, '');
    await page.goto(sessionsRoute);
    await otherPage.goto(sessionsRoute);
    await expect(page.getByText('Current session', { exact: true })).toHaveCount(1);
    await expect(otherPage.getByText('Current session', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Sign out this session', exact: true })).toHaveCount(1);
    const before = await readSessions(page);
    const otherBefore = await readSessions(otherPage);
    const current = before.find((session) => session.current)!;
    const other = otherBefore.find((session) => session.current)!;

    expect(before).toHaveLength(2);
    expect(otherBefore).toHaveLength(2);
    expect(current.id).not.toBe(other.id);
    expect(before.find((session) => session.id === other.id)?.current).toBe(false);
    expect(otherBefore.find((session) => session.id === current.id)?.current).toBe(false);

    const revokeOthers = page.getByRole('button', { name: 'Sign out all other sessions', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Confirm your identity' });

    await revokeOthers.click();
    await expect(dialog).toContainText('This session will stay signed in.');
    await expect(dialog.getByRole('button', { name: 'Continue with a passkey', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await readSessions(otherPage)).toHaveLength(2);

    await revokeOthers.click();
    const confirmation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/reauth/complete' && response.request().method() === 'POST',
    );
    const revocation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/sessions/revoke-others' &&
        response.request().method() === 'POST',
    );

    await dialog.getByRole('button', { name: 'Continue with a passkey', exact: true }).click();
    expect((await confirmation).ok()).toBe(true);
    const revoked = await revocation;

    expect(revoked.status()).toBe(200);
    expect(await revoked.json()).toMatchObject({ data: { revoked: 1 } });
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Session revocation completed.' })).toBeVisible();
    await expect(revokeOthers).toBeDisabled();
    const remaining = await readSessions(page);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ id: current.id, current: true });
    expect((await otherContext.request.get('/api/auth/sessions')).status()).toBe(401);
    await otherPage.reload();
    await expect(otherPage).toHaveURL(
      (url) => url.pathname === '/app/en/auth/sign-in' && url.searchParams.get('returnTo') === '/security/sessions',
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Active sessions', exact: true })).toBeVisible();
    await expect(page.getByText('Current session', { exact: true })).toHaveCount(1);
  } finally {
    await otherContext.close();
  }
});

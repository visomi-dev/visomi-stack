import type { Page } from '@playwright/test';
import { readMailCode } from '@visomi-stack/dev-testing';

import { expect, password, signup, test } from './support/fixtures';

async function saveNote(page: Page, title: string, body: string, shared = false) {
  const titleField = page.getByLabel('Note title', { exact: true });
  const currentTitle = await titleField.inputValue();

  if (currentTitle !== title) {
    await titleField.fill(title);
  }

  await expect(titleField).toHaveValue(title);

  await page.getByLabel('Note text', { exact: true }).fill(body);

  await page.getByRole('radio', { name: shared ? 'Shared with permitted readers' : 'Owner only' }).check();

  await page.getByRole('button', { name: 'Save note', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'New note', exact: true })).toBeVisible();

  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

function watchCloudHints(page: Page) {
  const hints: string[] = [];

  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string' && payload.startsWith('42/session,["cloud:changed"')) {
        hints.push(payload);
      }
    });
  });

  return hints;
}

test('shows distinct Cloud and Vault workspace labels when their tenant and dates match', async ({ page }) => {
  await signup(page);

  await page.setViewportSize({ width: 390, height: 844 });

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const scopeIds = ['22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222'];
  const items = scopeIds.map((scopeId) => ({
    tenantId,
    scopeId,
    createdAt: '2026-01-01T00:00:00.000Z',
    owner: true,
  }));

  await page.route('**/api/example/{cloud,vault}/workspaces*', (route) =>
    route.fulfill({ json: { items, next: null } }),
  );

  await page.goto('/app/en/db-example/cloud');

  for (const scopeId of scopeIds) {
    const link = page.getByRole('link', { name: new RegExp(`Open workspace.*ID ${scopeId}`) });

    await expect(link).toBeVisible();

    await expect(link).toHaveAttribute('href', `/app/en/db-example/cloud/${tenantId}/${scopeId}`);
  }

  await page.goto('/app/en/db-example/vault');

  for (const scopeId of scopeIds) {
    await expect(page.getByRole('button', { name: new RegExp(`Open vault.*ID ${scopeId}`) })).toBeVisible();
  }
});

test('Cloud updates permitted readers in realtime and clears notes after revocation', async ({ page, browser }) => {
  const baseURL = test.info().project.use.baseURL;
  const readerContext = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-for': '198.19.0.1' } });
  const outsiderContext = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-for': '198.19.0.2' } });

  try {
    const reader = await readerContext.newPage();
    const outsider = await outsiderContext.newPage();
    const readerHints = watchCloudHints(reader);
    const outsiderHints = watchCloudHints(outsider);

    await signup(page);

    const readerEmail = await signup(reader);

    await signup(outsider);

    await page.setViewportSize({ width: 1366, height: 900 });

    await page.locator('app-sidebar').getByRole('link', { name: 'Cloud example', exact: true }).click();

    await expect(page).toHaveURL(/\/app\/en\/db-example\/cloud$/);

    await expect(page.getByRole('heading', { name: 'Cloud example', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Create a test workspace', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'New note', exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Refresh notes', exact: true })).toHaveCount(0);

    const workspace = page.url();

    await saveNote(page, 'Synthetic owner note', 'Owner fixture');

    await saveNote(page, 'Synthetic team note', 'Team fixture', true);

    const primary = page.locator('app-sidebar').getByRole('navigation', { name: 'Primary navigation' });

    await primary.getByRole('link', { name: 'Home', exact: true }).click();

    await primary.getByRole('link', { name: 'Cloud example', exact: true }).click();

    await page.getByRole('button', { name: 'Create a test workspace', exact: true }).click();

    await expect(page.getByText('There are no notes to show yet.')).toBeVisible();

    await primary.getByRole('link', { name: 'Cloud example', exact: true }).click();

    const workspaces = page.getByRole('link', { name: /Open workspace/ });

    await expect(workspaces).toHaveCount(2);

    await workspaces.and(page.locator(`a[href="${new URL(workspace).pathname}"]`)).click();

    await expect(page).toHaveURL(workspace);

    await expect(page.getByRole('heading', { name: 'Synthetic owner note', exact: true })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Synthetic team note', exact: true })).toBeVisible();

    await expect(page.locator('app-pin-input')).toHaveCount(0);

    await reader.goto(workspace);

    await expect(reader.getByRole('alert').filter({ hasText: 'This account doesn’t have access' })).toBeVisible();

    await outsider.goto(workspace);

    await expect(outsider.getByRole('alert').filter({ hasText: 'This account doesn’t have access' })).toBeVisible();

    await page.getByRole('button', { name: 'Share by email', exact: true }).click();

    await page.getByLabel('Email address', { exact: true }).fill(readerEmail);

    await page.getByRole('button', { name: 'Send email', exact: true }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Email sent.' })).toBeVisible();

    await expect(reader.getByText('Team fixture', { exact: true })).toBeVisible();

    await expect(reader.getByText('Owner fixture', { exact: true })).toHaveCount(0);

    await expect(reader.getByRole('button', { name: 'Edit note', exact: true })).toHaveCount(0);

    await outsider.reload();

    await expect(outsider.getByRole('alert').filter({ hasText: 'This account doesn’t have access' })).toBeVisible();

    await expect(outsider.getByText('Team fixture', { exact: true })).toHaveCount(0);

    await page
      .getByRole('article')
      .filter({ hasText: 'Synthetic team note' })
      .getByRole('button', { name: 'Edit note' })
      .click();

    await expect(page.getByLabel('Note title', { exact: true })).toHaveValue('Synthetic team note');

    await saveNote(page, 'Synthetic updated note', 'Updated team fixture', true);

    await expect(reader.getByText('Updated team fixture', { exact: true })).toBeVisible();

    await expect(reader.getByText('Team fixture', { exact: true })).toHaveCount(0);

    await expect(reader).toHaveURL(workspace);

    expect(readerHints.length).toBeGreaterThan(0);
    expect(new Set(readerHints)).toEqual(new Set(['42/session,["cloud:changed"]']));
    expect(outsiderHints).toEqual([]);

    const updatedNote = page.getByRole('article').filter({ hasText: 'Synthetic updated note' });
    const editUpdatedNote = updatedNote.getByRole('button', { name: 'Edit note' });
    const editorTitle = page.getByLabel('Note title', { exact: true });

    await editUpdatedNote.click();

    await expect(editorTitle).toHaveValue('Synthetic updated note');

    await saveNote(page, 'Synthetic updated note', 'Now private');

    await expect(reader.getByText('Updated team fixture', { exact: true })).toHaveCount(0);

    const hintCount = readerHints.length;

    await editUpdatedNote.click();

    await expect(editorTitle).toHaveValue('Synthetic updated note');

    await saveNote(page, 'Synthetic updated note', 'Private edit');

    await editUpdatedNote.click();

    await expect(editorTitle).toHaveValue('Synthetic updated note');

    await saveNote(page, 'Synthetic updated note', 'Updated team fixture', true);

    await expect(reader.getByText('Updated team fixture', { exact: true })).toBeVisible();

    expect(readerHints.slice(hintCount)).toEqual(['42/session,["cloud:changed"]']);
    expect(outsiderHints).toEqual([]);

    await reader.goto(workspace.replace('/app/en/', '/app/es/'));

    await expect(reader.getByRole('heading', { name: 'Ejemplo en la nube', exact: true })).toBeVisible();

    await expect(reader.getByText('Updated team fixture', { exact: true })).toBeVisible();

    await expect(reader.getByRole('button', { name: 'Actualizar notas', exact: true })).toHaveCount(0);

    await page
      .getByRole('region', { name: 'People with access', exact: true })
      .getByRole('listitem')
      .filter({ hasText: readerEmail })
      .getByRole('button', { name: 'Remove access', exact: true })
      .click();

    await expect(page.getByRole('status').filter({ hasText: 'Access removed.' })).toBeVisible();

    await expect(reader.getByRole('alert').filter({ hasText: 'Esta cuenta no tiene acceso' })).toBeVisible();

    await expect(reader.getByText('Updated team fixture', { exact: true })).toHaveCount(0);

    await page
      .getByRole('article')
      .filter({ hasText: 'Synthetic updated note' })
      .getByRole('button', { name: 'Delete note' })
      .click();

    await expect(page.getByRole('status').filter({ hasText: 'Note deleted.' })).toBeVisible();

    await page.reload();

    await expect(page.getByText('Owner fixture', { exact: true })).toBeVisible();

    await expect(page.getByText('Updated team fixture', { exact: true })).toHaveCount(0);
  } finally {
    await Promise.all([readerContext.close(), outsiderContext.close()]);
  }
});

test('opens a sharing link after sign-in and grants only read access to shared notes', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await signup(page);

  await page.goto('/app/en/db-example/cloud');

  await page.getByRole('button', { name: 'Create a test workspace', exact: true }).click();

  await saveNote(page, 'Link owner note', 'Owner-only link fixture');

  await saveNote(page, 'Link shared note', 'Shared link fixture', true);

  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': '198.19.0.4' },
  });
  const recipient = await context.newPage();

  try {
    const email = await signup(recipient);
    const anonymous = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      extraHTTPHeaders: { 'x-forwarded-for': '198.19.0.5' },
    });

    try {
      const linked = await anonymous.newPage();

      await page.getByRole('button', { name: 'Share by link', exact: true }).click();

      await page.getByRole('button', { name: 'Create link', exact: true }).click();

      const address = await page.getByLabel('Sharing link', { exact: true }).inputValue();

      await page.getByRole('button', { name: 'Copy link', exact: true }).click();

      await expect(page.getByRole('status').filter({ hasText: /Link copied|Copy the selected link/ })).toBeVisible();

      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

      expect(horizontalOverflow).toBe(false);

      await linked.goto(address);

      await expect(linked.getByRole('heading', { name: 'Join a Cloud workspace', exact: true })).toBeVisible();

      await expect(linked.getByRole('button', { name: 'Open workspace', exact: true })).toHaveCount(0);

      await linked.getByRole('button', { name: 'Sign in', exact: true }).click();

      await linked.getByRole('link', { name: 'Use a password', exact: true }).click();

      await linked.getByLabel('Email address', { exact: true }).fill(email);

      await linked.getByLabel('Password', { exact: true }).fill(password);

      await linked.getByRole('button', { name: 'Sign in', exact: true }).click();

      await expect(linked.getByRole('heading', { name: 'Confirm your sign-in', exact: true })).toBeVisible();

      const code = await readMailCode(email);

      await linked.getByLabel('Verification code', { exact: true }).fill(code);

      await linked.getByRole('button', { name: 'Open workspace', exact: true }).click();

      await expect(linked.getByText('Shared link fixture', { exact: true })).toBeVisible();

      await expect(linked.getByText('Owner-only link fixture', { exact: true })).toHaveCount(0);

      await expect(linked.getByRole('button', { name: 'Edit note', exact: true })).toHaveCount(0);

      await expect(linked).toHaveURL(page.url());

      await page.getByRole('button', { name: 'Disable link', exact: true }).click();

      await recipient.goto(address);

      await recipient.getByRole('button', { name: 'Open workspace', exact: true }).click();

      await expect(recipient.getByRole('alert').filter({ hasText: 'This link is unavailable' })).toBeVisible();
    } finally {
      await anonymous.close();
    }
  } finally {
    await context.close();
  }
});

import type { Page } from '@playwright/test';

import { expect, signup, test } from './support/fixtures';

async function saveNote(page: Page, title: string, body: string, shared = false) {
  await page.getByLabel('Note title', { exact: true }).fill(title);

  await page.getByLabel('Synthetic note text', { exact: true }).fill(body);

  if (shared) {
    await page.getByRole('radio', { name: 'Shared with permitted readers' }).check();
  }

  await page.getByRole('button', { name: 'Save note', exact: true }).click();

  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('Cloud shares only the selected synthetic notes with an explicitly permitted account', async ({
  page,
  browser,
}) => {
  const baseURL = test.info().project.use.baseURL;
  const readerContext = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-for': '198.19.0.1' } });
  const outsiderContext = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-for': '198.19.0.2' } });

  try {
    const reader = await readerContext.newPage();
    const outsider = await outsiderContext.newPage();

    await signup(page);

    await signup(reader);

    await signup(outsider);

    await page.setViewportSize({ width: 1366, height: 900 });

    await page.locator('app-sidebar').getByRole('link', { name: 'Cloud example', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Cloud example', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Create a test workspace', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'New test note', exact: true })).toBeVisible();

    const workspace = page.url();

    await saveNote(page, 'Synthetic owner note', 'Owner fixture');

    await saveNote(page, 'Synthetic team note', 'Team fixture', true);

    await expect(page.locator('app-pin-input')).toHaveCount(0);

    await reader.goto(workspace);

    await expect(reader.getByRole('alert').filter({ hasText: 'This account doesn’t have access' })).toBeVisible();

    await outsider.goto(workspace);

    await expect(outsider.getByRole('alert').filter({ hasText: 'This account doesn’t have access' })).toBeVisible();

    const memberLabel = reader.getByText(/^Your test account ID is [\da-f-]{36}\.$/);

    await expect(memberLabel).toBeVisible();

    const memberText = await memberLabel.innerText();
    const readerId = memberText.match(/[\da-f-]{36}/)![0];

    await page.getByLabel('Test account ID', { exact: true }).fill(readerId);

    await page.getByRole('button', { name: 'Grant read access', exact: true }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Read access granted.' })).toBeVisible();

    await reader.getByRole('button', { name: 'Refresh notes', exact: true }).click();

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

    await saveNote(page, 'Synthetic updated note', 'Updated team fixture', true);

    await reader.goto(workspace.replace('/app/en/', '/app/es/'));

    await expect(reader.getByRole('heading', { name: 'Ejemplo en la nube', exact: true })).toBeVisible();

    await expect(reader.getByText('Updated team fixture', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Remove access', exact: true }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Access removed.' })).toBeVisible();

    await reader.getByRole('button', { name: 'Actualizar notas', exact: true }).click();

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

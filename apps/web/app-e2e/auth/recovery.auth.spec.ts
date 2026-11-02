import { readMailCode } from '@visomi-stack/dev-testing';

import { expect, test, signup, logout } from './support/fixtures';

test('recovers into restricted enrollment and proves a replacement password', async ({ page, context }) => {
  const email = await signup(page);

  await logout(page);

  await page.goto('/app/en/auth/recovery');

  await page.getByLabel('Email address', { exact: true }).fill(email);

  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Verify recovery', exact: true })).toBeVisible();

  const code = await readMailCode(email);

  await page.getByLabel('Email verification code', { exact: true }).fill(code);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Set up access again', exact: true })).toBeVisible();

  const restricted = await context.request.get('/api/auth/session');
  const result8 = await restricted.json();

  expect(result8.access).toBe('recovery');

  await page.getByText('Use a password', { exact: true }).click();

  await page.getByLabel('New password', { exact: true }).fill('Recovered synthetic password 42!');

  await page.getByRole('button', { name: 'Save password', exact: true }).click();

  await expect(page.getByText('Confirm the replacement password', { exact: false })).toBeVisible();

  const factor = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(factor);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();
});

test('approves another browser and grants enrollment rather than full access', async ({ page, browser }) => {
  const email = await signup(page);
  const requesterContext = await browser.newContext({ baseURL: 'http://localhost:4204' });
  const requester = await requesterContext.newPage();

  try {
    await requester.goto('/app/en/auth/device-approval');

    await requester.getByLabel('Email address', { exact: true }).fill(email);

    await requester.getByRole('button', { name: 'Continue', exact: true }).click();

    await expect(requester.getByText('Waiting for approval on your other device.', { exact: true })).toBeVisible();

    const review = requester.locator('a[target="_blank"]');
    const link = await review.getAttribute('href');
    const code = await requester.locator('p.font-mono').innerText();

    expect(link).not.toContain(code);

    await page.goto(link!);

    await page.getByLabel('Pairing code', { exact: true }).fill(code);

    await page.getByRole('button', { name: 'Approve request', exact: true }).click();

    await expect(page.getByText('This request is no longer waiting for approval.', { exact: true })).toBeVisible();

    await requester.getByRole('button', { name: 'Continue recovery', exact: true }).click();

    await expect(requester.getByRole('heading', { name: 'Set up access again', exact: true })).toBeVisible();

    const state = await requesterContext.request.get('/api/auth/session');
    const result9 = await state.json();

    expect(result9.access).toBe('enrollment');
  } finally {
    await requesterContext.close();
  }
});

test('cancels and denies device requests without granting access', async ({ page, browser }) => {
  const email = await signup(page);
  const context = await browser.newContext({ baseURL: 'http://localhost:4204' });
  const requester = await context.newPage();

  try {
    await requester.goto('/app/en/auth/device-approval');

    await requester.getByLabel('Email address', { exact: true }).fill(email);

    await requester.getByRole('button', { name: 'Continue', exact: true }).click();

    await expect(requester.getByText('Waiting for approval on your other device.', { exact: true })).toBeVisible();

    await requester.getByRole('button', { name: 'Cancel request', exact: true }).click();

    await expect(requester.getByText('This request was cancelled.', { exact: true })).toBeVisible();

    await requester.getByRole('button', { name: 'Start again', exact: true }).click();

    await requester.getByLabel('Email address', { exact: true }).fill(email);

    await requester.getByRole('button', { name: 'Continue', exact: true }).click();

    await expect(requester.getByText('Waiting for approval on your other device.', { exact: true })).toBeVisible();

    const link = await requester.locator('a[target="_blank"]').getAttribute('href');
    const code = await requester.locator('p.font-mono').innerText();

    await page.goto(link!);

    await page.getByLabel('Pairing code', { exact: true }).fill(code);

    await page.getByRole('button', { name: 'Deny request', exact: true }).click();

    await expect(requester.getByText('This request was denied.', { exact: true })).toBeVisible({ timeout: 10000 });

    const state = await context.request.get('/api/auth/session');
    const snapshot = await state.json();

    expect(snapshot.access).toBe('anonymous');

    await expect(requester.getByRole('button', { name: 'Continue recovery', exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

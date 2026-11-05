import { readMailCode } from '@visomi-stack/dev-testing';

import { expect, test, signup, logout } from './support/fixtures';

test('restarts replacement-password preparation without losing recovery access', async ({ page, context }) => {
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

  const firstPreparation = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/recovery/password') && response.request().method() === 'POST',
  );

  await page.getByRole('button', { name: 'Save password', exact: true }).click();

  const firstResponse = await firstPreparation;

  expect(firstResponse.status()).toBe(202);

  await expect(page.getByText('Confirm the replacement password', { exact: false })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Send a new code', exact: false })).toHaveCount(0);

  await expect(page.getByText('If the email does not arrive', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Start again', exact: true }).click();

  await page.getByText('Use a password', { exact: true }).click();

  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');

  const resumed = await context.request.get('/api/auth/session');
  const resumedSession = await resumed.json();

  expect(resumedSession.access).toBe('recovery');

  await page.getByLabel('New password', { exact: true }).fill('Recovered synthetic password 42!');

  const nextPreparation = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/recovery/password') && response.request().method() === 'POST',
  );

  await page.getByRole('button', { name: 'Save password', exact: true }).click();

  const nextResponse = await nextPreparation;

  expect(nextResponse.status()).toBe(202);

  await expect(page.getByText('Confirm the replacement password', { exact: false })).toBeVisible();

  const factor = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(factor);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();
});

test('polls a new device request after cancelling one whose status response is delayed', async ({ page }) => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const expiresAt = '2099-01-01T00:00:00Z';
  let requests = 0;
  const polled: string[] = [];
  let releaseStatus: () => void = () => undefined;
  const delayed = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });

  await page.route('**/api/auth/device-approval/request', (route) =>
    route.fulfill({ status: 201, json: { requestId: ids[requests++], userCode: '001234', expiresAt } }),
  );

  await page.route('**/api/auth/device-approval/status', async (route) => {
    const requestId = route.request().postDataJSON().requestId as string;

    polled.push(requestId);

    if (requestId === ids[0]) {
      await delayed;

      await route.fulfill({ json: { requestId, status: 'pending', expiresAt } });
    } else {
      await route.fulfill({ json: { requestId, status: 'approved', expiresAt } });
    }
  });

  await page.route('**/api/auth/device-approval/cancel', (route) => route.fulfill({ status: 204 }));

  try {
    await page.goto('/app/en/auth/device-approval');

    await page.getByLabel('Email address', { exact: true }).fill('demo@example.test');

    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    await expect.poll(() => polled.length).toBe(1);

    await page.getByRole('button', { name: 'Cancel request', exact: true }).click();

    await expect(page.getByText('This request was cancelled.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Start again', exact: true }).click();

    await page.getByLabel('Email address', { exact: true }).fill('demo@example.test');

    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Continue recovery', exact: true })).toBeVisible();

    expect(polled).toEqual(ids);
    releaseStatus();

    await expect(page.getByText('Waiting for approval on your other device.', { exact: true })).toBeHidden();
  } finally {
    releaseStatus();
  }
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

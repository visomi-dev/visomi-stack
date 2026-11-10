import { readMailCode } from '@visomi-stack/dev-testing';

import { expect, test, address, signup, logout, passwordStart, password } from './support/fixtures';

test('registers with a password, protects unverified access and restores SSR sessions', async ({ page, context }) => {
  const email = address();

  await page.goto('/app/en/auth/sign-up/password');

  await page.getByLabel('Email address', { exact: true }).fill(email);

  await page.getByLabel('Password', { exact: true }).fill(password);

  await page.getByRole('button', { name: 'Create an account', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Verify your email', exact: true })).toBeVisible();

  const restricted = await context.request.get('/app/en/home');

  expect(restricted.url()).toContain('/auth/verify-email');
  const code = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();

  const rendered = await context.request.get('/app/en/home');
  const result3 = await rendered.text();

  expect(result3).toContain('Welcome home.');
  expect(rendered.headers()['cache-control']).toBe('no-store');

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();

  for (const width of [360, 1023, 1024, 1440]) {
    await page.setViewportSize({ width, height: 850 });

    const navigation = page.getByRole('navigation', { name: 'Primary navigation', exact: true });

    await expect(navigation).toHaveCount(1);

    for (const name of ['Home', 'Account', 'Security']) {
      await expect(navigation.getByRole('link', { name, exact: true })).toBeVisible();
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

    expect(overflow).toBe(false);
  }

  await page
    .getByRole('navigation', { name: 'Primary navigation', exact: true })
    .getByRole('link', { name: 'Security', exact: true })
    .click();

  await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();

  const skip = page.getByRole('link', { name: 'Skip to content', exact: true });

  await expect(skip).toHaveAttribute('href', '/app/en/security#workspace-main');

  await skip.focus();

  await page.keyboard.press('Enter');

  await expect(page.getByRole('main')).toBeFocused();

  await logout(page);

  const blocked = await context.request.get('/app/en/security');

  expect(blocked.url()).toContain('/auth/sign-in');
});

test('requires a second factor and restarts a lost challenge after reload', async ({ page }) => {
  const email = await signup(page);

  await logout(page);

  await passwordStart(page, email);

  await page.reload();

  await expect(page.getByText('This step could not be restored.', { exact: false })).toBeVisible();

  await page.getByRole('link', { name: 'Start again', exact: true }).click();

  await page.getByLabel('Email address', { exact: true }).fill(email);

  await page.getByLabel('Password', { exact: true }).fill(password);

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Confirm your sign-in', exact: true })).toBeVisible();

  const code = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await expect(page).toHaveURL(/auth\/sign-in\/verify/);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();
});

test('isolates concurrent SSR identities and hydrates each browser with its own session', async ({
  page,
  context,
  browser,
}) => {
  const firstEmail = await signup(page);
  const otherContext = await browser.newContext({ baseURL: 'http://localhost:4204' });
  const otherPage = await otherContext.newPage();

  try {
    const secondEmail = await signup(otherPage);
    const firstSessionResponse = await context.request.get('/api/auth/session');
    const firstSession = await firstSessionResponse.json();
    const secondSessionResponse = await otherContext.request.get('/api/auth/session');
    const secondSession = await secondSessionResponse.json();
    const [firstResponse, secondResponse] = await Promise.all([
      context.request.get('/app/en/account'),
      otherContext.request.get('/app/en/account'),
    ]);
    const [firstHtml, secondHtml] = await Promise.all([firstResponse.text(), secondResponse.text()]);

    expect(firstResponse.headers()['cache-control']).toBe('no-store');
    expect(secondResponse.headers()['cache-control']).toBe('no-store');
    expect(firstHtml).toContain(firstEmail);
    expect(firstHtml).not.toContain(secondEmail);
    expect(firstHtml).not.toContain(firstSession.csrfToken);
    expect(secondHtml).toContain(secondEmail);
    expect(secondHtml).not.toContain(firstEmail);
    expect(secondHtml).not.toContain(secondSession.csrfToken);
    expect(firstHtml).toContain('<app-authenticated-layout');
    expect(secondHtml).toContain('<app-authenticated-layout');
    expect(firstHtml).not.toContain('<app-sign-in');
    expect(secondHtml).not.toContain('<app-sign-in');

    await Promise.all([page.goto('/app/en/account'), otherPage.goto('/app/en/account')]);

    await expect(page.locator('app-account p.font-medium')).toHaveText(firstEmail);

    await expect(otherPage.locator('app-account p.font-medium')).toHaveText(secondEmail);

    await expect(page.getByRole('button', { name: 'Change email', exact: true })).toBeEnabled();

    await expect(otherPage.getByRole('button', { name: 'Change email', exact: true })).toBeEnabled();
  } finally {
    await otherContext.close();
  }
});

test('resets a password without signing in', async ({ page, context }) => {
  const email = await signup(page);

  await logout(page);

  await page.goto('/app/en/auth/forgot-password');

  await page.getByLabel('Email address', { exact: true }).fill(email);

  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();

  const code = await readMailCode(email);
  const replacement = 'Replacement synthetic password 42!';

  await page.getByLabel('Email verification code', { exact: true }).fill(code);

  await page.getByLabel('New password', { exact: true }).fill(replacement);

  await page.getByRole('button', { name: 'Reset password', exact: true }).click();

  await expect(page.getByText('Your password has been reset.', { exact: false })).toBeVisible();

  const session = await context.request.get('/api/auth/session');
  const result4 = await session.json();

  expect(result4.access).toBe('anonymous');

  await passwordStart(page, email, replacement);

  const factor = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(factor);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();
});

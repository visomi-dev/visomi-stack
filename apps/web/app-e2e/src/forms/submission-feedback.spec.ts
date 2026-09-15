import { expect, test } from '@playwright/test';

for (const scenario of [
  { route: '/auth/sign-up', button: 'Create account with passkey', field: 'Email address' },
  { route: '/auth/sign-up?method=password', button: 'Create account', field: 'Email address' },
  { route: '/auth/sign-in?method=password', button: 'Sign in with password', field: 'Email address' },
]) {
  test(`explains missing fields when submitting ${scenario.route}`, async ({ page }) => {
    const mutations: string[] = [];

    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/auth/')) mutations.push(request.url());
    });
    await page.goto(`/app/en${scenario.route}`);
    await expect(page.getByRole('textbox', { name: scenario.field, exact: true })).toBeEditable();
    const submit = page.getByRole('button', { name: scenario.button, exact: true });

    await expect(submit).toBeEnabled();
    await submit.click();
    const summary = page.getByRole('alert').filter({ hasText: 'Check the following before continuing:' });

    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('Enter your email address.');
    expect(mutations).toEqual([]);
    if (scenario.route === '/auth/sign-up?method=password') {
      await expect(summary).toContainText('Enter a password.');
      await page.screenshot({ path: 'tmp/auth-captures/submission-errors-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: 'tmp/auth-captures/submission-errors-mobile.png', fullPage: true });
    }
  });
}

test('separates password length compliance from estimated resistance to guessing', async ({ page }) => {
  await page.goto('/app/en/auth/sign-up?method=password');
  await page.getByLabel('Password', { exact: true }).fill('Password123!');
  await expect(page.getByText('Length requirement met (12–128 characters).')).toBeVisible();
  const estimate = page.locator('[data-slot="password-strength-label"]');

  await expect(estimate).toHaveText(/^(Very weak|Weak|Fair)$/);
  await expect(page.getByText('Try several unrelated words.', { exact: false })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('cobalt hammock orchard lantern');
  await expect(estimate).toHaveText(/^(Strong|Very strong)$/);
  await page.screenshot({ path: 'tmp/auth-captures/password-estimate.png', fullPage: true });
});

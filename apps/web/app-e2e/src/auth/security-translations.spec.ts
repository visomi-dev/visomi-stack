import { expect, test } from '@playwright/test';

import { authenticateViaDeterministicTestSession, createCredentials } from '../support/auth';

for (const action of ['add', 'revoke'] as const) {
  test(`preserves the Spanish ${action} passkey button interpolation while submitting`, async ({ page, request }) => {
    const credentials = createCredentials();

    await authenticateViaDeterministicTestSession(page, request, credentials.email, credentials.password);
    await page.route('**/api/auth/passkey/credentials', (route) =>
      route.fulfill({
        json: {
          data: {
            credentials: [
              {
                id: 'translation-fixture',
                label: 'Saved passkey',
                createdAt: '2026-09-01T00:00:00Z',
                lastUsedAt: null,
                revokedAt: null,
                transports: ['internal'],
                backupEligible: true,
                backupState: true,
              },
            ],
          },
        },
      }),
    );
    await page.goto('/app/es/security');
    if (action === 'add') {
      await page.getByRole('button', { name: 'Add passkey', exact: true }).click();
      await page.getByRole('textbox', { name: 'Passkey name' }).fill('Backup');
    } else {
      await page.getByRole('button', { name: 'Revoke', exact: true }).first().click();
    }
    const idle = action === 'add' ? 'Confirm and add passkey' : 'Confirm passkey and revoke';
    const busy = action === 'add' ? 'Waiting for confirmation...' : 'Confirming...';
    const gate = Promise.withResolvers<void>();

    await page.route('**/api/auth/passkey/authentication/begin', async (route) => {
      await gate.promise;
      await route.abort();
    });
    await expect(page.getByRole('button', { name: idle, exact: true })).toBeVisible();
    try {
      await page.getByRole('button', { name: idle, exact: true }).click();
      await expect(page.getByRole('button', { name: busy, exact: true })).toBeDisabled();
      await expect(page.getByText('<x id=', { exact: false })).toHaveCount(0);
    } finally {
      gate.resolve();
    }
    await expect(page.getByRole('button', { name: idle, exact: true })).toBeEnabled();
  });
}

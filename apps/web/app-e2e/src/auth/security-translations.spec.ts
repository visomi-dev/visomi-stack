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
      await page.getByRole('button', { name: 'Añadir clave de acceso', exact: true }).click();
      await page.getByRole('textbox', { name: 'Nombre de la clave de acceso' }).fill('Backup');
    } else {
      await page.getByRole('button', { name: 'Revocar', exact: true }).first().click();
    }
    const idle = action === 'add' ? 'Confirmar y añadir clave' : 'Confirmar clave y revocar';
    const busy = action === 'add' ? 'Esperando confirmación…' : 'Confirmando…';
    const gate = Promise.withResolvers<void>();

    await page.route('**/api/auth/passkey/authentication/begin', async (route) => {
      await gate.promise;
      await route.abort();
    });
    await expect(page.getByRole('button', { name: idle, exact: true })).toBeVisible();
    try {
      await page.getByRole('button', { name: idle, exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Continuar con una clave de acceso' }).click();
      await expect(page.getByRole('button', { name: busy, exact: true })).toBeDisabled();
      await expect(page.getByText('<x id=', { exact: false })).toHaveCount(0);
    } finally {
      gate.resolve();
    }
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByRole('button', { name: idle, exact: true })).toBeEnabled();
  });
}

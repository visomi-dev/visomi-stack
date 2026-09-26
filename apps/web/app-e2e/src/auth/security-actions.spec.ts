import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { authenticateViaDeterministicTestSession, createCredentials } from '../support/auth';

// Presentation-only: cancellation and layout must start with an existing sign-in method.
const activePasskey = {
  id: 'existing-presentation-passkey',
  label: 'Existing laptop',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  transports: ['internal'],
  backupEligible: false,
  backupState: false,
};

test.beforeEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});
test.afterEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});

test('cancels a contextual action before requesting credential proof', async ({ page, request }) => {
  const credentials = createCredentials();
  let assertions = 0;

  await authenticateViaDeterministicTestSession(page, request, credentials.email, '');
  await page.route('**/api/auth/passkey/credentials', (route) =>
    route.fulfill({ json: { data: { credentials: [activePasskey] } } }),
  );
  await page.route('**/api/auth/passkey/authentication/begin', (route) => {
    assertions += 1;

    return route.continue();
  });
  await page.goto('/app/en/security');
  await page.getByRole('button', { name: 'Add passkey', exact: true }).click();
  await page.getByRole('textbox', { name: 'Passkey name' }).fill('Unconfirmed laptop');
  await page.getByRole('button', { name: 'Confirm and add passkey' }).click();
  await expect(page.getByRole('dialog')).toContainText('Confirm your passkey to add a new sign-in method');
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();

  expect(accessibility.violations).toEqual([]);
  expect(assertions).toBe(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm and add passkey' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Confirm and add passkey' })).toBeFocused();
  expect(assertions).toBe(0);
});

test('keeps passkey settings available after an overview failure', async ({ page, request }) => {
  const credentials = createCredentials();

  await authenticateViaDeterministicTestSession(page, request, credentials.email, '');
  await page.route('**/api/auth/security/overview', (route) =>
    route.fulfill({ status: 503, json: { code: 'unavailable' } }),
  );
  await page.goto('/app/en/security');
  await expect(page.getByRole('alert')).toContainText('We could not load your account overview');
  await expect(page.getByRole('button', { name: 'Add passkey', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Reload account overview' })).toBeEnabled();
});

for (const locale of ['en', 'es']) {
  for (const width of [360, 768, 1440]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`renders account security at ${width}px in ${locale} ${theme}`, async ({ page, request }, testInfo) => {
        const credentials = createCredentials();

        // Presentation fixtures must not consume the native authentication rate budget.
        await page.addInitScript(() =>
          Object.defineProperty(PublicKeyCredential, 'getClientCapabilities', {
            value: async () => ({ conditionalGet: false, immediateGet: false }),
          }),
        );
        await page.route('**/api/auth/passkey/credentials', (route) =>
          route.fulfill({ json: { data: { credentials: [activePasskey] } } }),
        );
        await authenticateViaDeterministicTestSession(page, request, credentials.email, '');
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.goto(`/app/${locale}/security`);
        await expect(
          page.getByRole('heading', {
            name: locale === 'en' ? 'Account recovery' : 'Recuperación de la cuenta',
            exact: true,
          }),
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const accessibility = await new AxeBuilder({ page })
          .include('[aria-labelledby="security-title"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();

        expect(accessibility.violations).toEqual([]);
        const screenshot = await page.screenshot({
          path: `tmp/auth-captures/security-${locale}-${width}-${theme}.png`,
          fullPage: true,
          mask: [page.getByText(credentials.email, { exact: true })],
        });

        await testInfo.attach('account-security', { body: screenshot, contentType: 'image/png' });
        await page
          .getByRole('button', { name: locale === 'en' ? 'Add passkey' : 'Añadir clave de acceso', exact: true })
          .click();
        await page
          .getByRole('textbox', { name: locale === 'en' ? 'Passkey name' : 'Nombre de la clave de acceso' })
          .fill('Personal laptop');
        await page
          .getByRole('button', { name: locale === 'en' ? 'Confirm and add passkey' : 'Confirmar y añadir clave' })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        const dialogAudit = await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();

        expect(dialogAudit.violations).toEqual([]);
        await page.screenshot({
          path: `tmp/auth-captures/confirmation-${locale}-${width}-${theme}.png`,
          fullPage: true,
          mask: [page.getByText(credentials.email, { exact: true })],
        });
        await page
          .getByRole('dialog')
          .getByRole('button', { name: locale === 'en' ? 'Cancel' : 'Cancelar', exact: true })
          .click();
        const requestId = '12345678-1234-4234-8234-123456789abc';
        const expiresAt = '2030-01-01T12:00:00.000Z';

        await page.route('**/api/auth/device-approval/request', (route) =>
          route.fulfill({ status: 201, json: { data: { requestId, userCode: '012345', expiresAt } } }),
        );
        await page.route('**/api/auth/device-approval/status', (route) =>
          route.fulfill({ json: { data: { requestId, status: 'pending', expiresAt } } }),
        );
        await page.goto(`/app/${locale}/security/device-approval`);
        await page
          .getByRole('button', { name: locale === 'en' ? 'Create approval request' : 'Crear solicitud de aprobación' })
          .click();
        await expect(
          page.getByRole('img', {
            name: locale === 'en' ? 'Device approval link QR code' : 'Código QR del enlace de aprobación',
          }),
        ).toBeVisible();
        const approvalAudit = await new AxeBuilder({ page })
          .include('[aria-labelledby="device-setup-title"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();

        expect(approvalAudit.violations).toEqual([]);
        await page.screenshot({
          path: `tmp/auth-captures/approval-${locale}-${width}-${theme}.png`,
          fullPage: true,
          mask: [page.getByText(credentials.email, { exact: true })],
        });
      });
    }
  }
}

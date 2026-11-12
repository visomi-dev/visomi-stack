import { expect, test, signup } from './support/fixtures';

const createdAt = '2026-01-02T10:30:00.000Z';
const lastUsedAt = '2026-01-03T11:45:00.000Z';
const credentials = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    label: 'Passkey',
    providerName: 'Google Password Manager',
    createdAt,
    lastUsedAt,
    backupEligible: true,
    backupState: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    label: 'Travel key',
    providerName: '1Password',
    createdAt,
    lastUsedAt: null,
    backupEligible: true,
    backupState: false,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    label: 'Passkey',
    createdAt,
    lastUsedAt: null,
    backupEligible: false,
    backupState: false,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    label: 'Passkey',
    providerName: null,
    createdAt,
    lastUsedAt: null,
    backupEligible: true,
    backupState: true,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    label: 'Passkey',
    providerName: null,
    createdAt,
    lastUsedAt: null,
    backupEligible: true,
    backupState: false,
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    label: 'Passkey',
    labelIsCustom: true,
    providerName: 'Google Password Manager',
    createdAt,
    lastUsedAt: null,
    backupEligible: true,
    backupState: true,
  },
];

for (const [locale, names, never, rename, cancel, label] of [
  [
    'en',
    ['Google Password Manager', 'Travel key', 'Device-bound passkey', 'Synced passkey', 'Syncable passkey', 'Passkey'],
    'Not used yet',
    'Rename',
    'Cancel',
    'Passkey name',
  ],
  [
    'es',
    [
      'Google Password Manager',
      'Travel key',
      'Clave vinculada a un dispositivo',
      'Clave de acceso sincronizada',
      'Clave de acceso sincronizable',
      'Passkey',
    ],
    'Aún no se ha usado',
    'Cambiar nombre',
    'Cancelar',
    'Nombre de la clave de acceso',
  ],
] as const) {
  test(`${locale} passkeys use available metadata and preserve custom names`, async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 844 });

    await signup(page);

    await page.route('**/api/auth/passkeys', (route) => route.fulfill({ json: { credentials } }));

    await page.goto(`/app/${locale}/security/passkeys`);

    const cards = page.locator('app-manage-passkeys section[appUI="card"]');

    await expect(cards).toHaveCount(6);

    for (const [index, name] of names.entries()) {
      await expect(cards.nth(index).getByRole('heading', { level: 2 })).toHaveText(name);

      await expect(cards.nth(index).locator('time').first()).toHaveAttribute('datetime', createdAt);
    }

    await expect(cards.first().locator('time').nth(1)).toHaveAttribute('datetime', lastUsedAt);

    await expect(cards.nth(1).getByText('1Password', { exact: true })).toBeVisible();

    await expect(cards.nth(1).getByText(never, { exact: true })).toBeVisible();

    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

    expect(fits).toBe(true);

    const overflow = await cards
      .locator('dd')
      .evaluateAll((elements) => elements.some((element) => element.scrollWidth > element.clientWidth));

    expect(overflow).toBe(false);

    await cards.first().screenshot({ path: info.outputPath(`passkey-metadata-${locale}.png`), animations: 'disabled' });

    await cards.first().getByRole('button', { name: rename, exact: true }).click();

    await expect(page.getByLabel(label, { exact: true })).toHaveValue('Google Password Manager');

    await page.getByRole('button', { name: cancel, exact: true }).click();

    await cards.nth(1).getByRole('button', { name: rename, exact: true }).click();

    await expect(page.getByLabel(label, { exact: true })).toHaveValue('Travel key');
  });
}

import { expect, test, signup } from './support/fixtures';
import { expectCenteredDigits } from './support/pin-layout';

test('PIN setup and offline reopen work without WebAuthn and preserve ciphertext after a wrong PIN', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'credentials', { value: undefined }));

  await page.setContent('<textarea aria-label="Clipboard fixture">0042</textarea>');

  const source = page.getByRole('textbox', { name: 'Clipboard fixture' });

  await source.press('ControlOrMeta+KeyA');

  await source.press('ControlOrMeta+KeyC');

  await signup(page);

  const sent: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('/api/persistence/')) {
      sent.push(request.postData() ?? '');
    }
  });

  await page.goto('/app/en/persistence');

  await page.getByRole('button', { name: 'Create a synthetic workspace', exact: true }).click();

  await expect(page.getByLabel('Local unlock PIN', { exact: true })).toBeEnabled();

  const pin = page.getByLabel('Local unlock PIN', { exact: true });

  await page.getByText('Local unlock PIN', { exact: true }).click();

  await expect(pin).toBeFocused();

  await pin.press('ControlOrMeta+KeyV');

  await expect(pin).toHaveValue('0042');

  await expect(pin.and(page.locator(':invalid'))).toHaveCount(1);

  await expect(pin).toBeFocused();

  await pin.press('Tab');

  await expect(pin).not.toBeFocused();

  await page.keyboard.press('Shift+Tab');

  await expect(pin).toBeFocused();

  await page.getByLabel('Confirm PIN for initial setup', { exact: true }).fill('0042');

  await page.getByRole('button', { name: 'Set up an empty private resource with PIN', exact: true }).click();

  await expect(page.getByText('Enter a six-digit PIN. For initial setup, enter the same PIN twice.')).toBeVisible();

  await expect(page.getByLabel('Private text', { exact: true })).toHaveCount(0);

  await pin.fill('');

  await pin.pressSequentially('0482');

  await expect(pin).toHaveValue('0482');

  await pin.press('ArrowLeft');

  await pin.press('Backspace');

  await expect(pin).toHaveValue('042');

  await pin.fill('048261');

  await expect(pin.and(page.locator(':valid'))).toHaveCount(1);

  await expect(page.locator('app-pin-input')).toHaveCount(2);

  await expect(pin).toHaveJSProperty('scrollLeft', 0);

  await expectCenteredDigits(page.locator('app-pin-input > div').filter({ has: pin }));

  await page.getByLabel('Confirm PIN for initial setup', { exact: true }).fill('048261');

  await page.getByRole('button', { name: 'Set up an empty private resource with PIN', exact: true }).click();

  await expect(page.getByLabel('Private text', { exact: true })).toBeEnabled();

  expect(sent.join('')).not.toContain('048261');
  const workspace = new URL(page.url()).pathname;

  await context.setOffline(true);

  const marker = 'SYNTHETIC_PIN_OFFLINE_SECRET';

  await page.getByLabel('Private text', { exact: true }).fill(marker);

  await page.getByRole('button', { name: 'Save encrypted change', exact: true }).click();

  await expect(page.locator('pre')).toHaveText(marker);

  await context.setOffline(false);

  await page.getByRole('link', { name: 'Home', exact: true }).first().click();

  await expect(page).toHaveURL(/\/home$/);

  await expect(page.getByRole('heading', { name: 'Unlock your private resources', exact: true })).toHaveCount(0);

  await expect(page.getByLabel('Local unlock PIN', { exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: 'Account', exact: true }).first().click();

  await expect(page).toHaveURL(/\/account$/);

  await expect(page.getByLabel('Local unlock PIN', { exact: true })).toHaveCount(0);

  await page.goBack();

  await expect(page).toHaveURL(/\/home$/);

  await page.goBack();

  await expect(page).toHaveURL(new RegExp(`${workspace}$`));

  await expect(page.locator('pre')).toHaveText(marker);

  await expect(page.getByLabel('Local unlock PIN', { exact: true })).toHaveCount(0);

  const objectId = await page.evaluate(() => crypto.randomUUID());
  const otherObject = workspace.slice(0, workspace.lastIndexOf('/') + 1) + objectId;

  await page.evaluate((path) => {
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
  }, otherObject);

  await expect(page).toHaveURL(new RegExp(`${otherObject}$`));

  await expect(page.getByLabel('Local unlock PIN', { exact: true })).toHaveCount(0);

  await expect(page.locator('pre')).toHaveCount(0);

  await expect(page.getByLabel('Private text', { exact: true })).toBeDisabled();

  await expect(page.getByText('An encrypted change is waiting for synchronization.', { exact: false })).toBeVisible();

  await page.goBack();

  await expect(page.locator('pre')).toHaveText(marker);

  await context.setOffline(true);

  await page.getByRole('button', { name: 'Lock private resources', exact: true }).click();

  await expect(page.locator('pre')).toHaveCount(0);

  await page.getByLabel('Local unlock PIN', { exact: true }).fill('999999');

  await page.getByRole('button', { name: 'Unlock locally with PIN', exact: true }).click();

  await expect(page.getByRole('status')).toContainText(['Integrity could not be verified']);

  await expect(page.locator('pre')).toHaveCount(0);

  await page.getByLabel('Local unlock PIN', { exact: true }).fill('048261');

  await page.getByRole('button', { name: 'Unlock locally with PIN', exact: true }).click();

  await expect(page.locator('pre')).toHaveText(marker);

  await expect(page.getByText('An encrypted change is waiting for synchronization.', { exact: false })).toBeVisible();

  const serialized = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const rows: unknown[] = [];

    for (const { name } of databases) {
      if (!name?.startsWith('visomi-vault:') && !name?.startsWith('visomi-sync:')) {
        continue;
      }

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      for (const store of db.objectStoreNames) {
        const values = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).getAll();

          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        rows.push(...values);
      }

      db.close();
    }

    return JSON.stringify(rows);
  });

  expect(serialized).not.toContain(marker);
  expect(serialized).not.toContain('048261');
  expect(sent.join('')).not.toContain(marker);

  await context.setOffline(false);

  await page.getByRole('button', { name: 'Synchronize encrypted changes', exact: true }).click();

  await expect(page.getByLabel('Private text', { exact: true })).toBeEnabled();

  await page.reload();

  await expect(page.locator('pre')).toHaveCount(0);

  await page.getByLabel('Local unlock PIN', { exact: true }).fill('048261');

  await page.getByRole('button', { name: 'Unlock locally with PIN', exact: true }).click();

  await expect(page.locator('pre')).toHaveText(marker);

  await page.goto('/app/en/home');

  await expect(page.getByRole('heading', { name: 'Unlock your private resources', exact: true })).toBeVisible();

  await expect(page.locator('pre')).toHaveCount(0);

  await context.setOffline(true);

  await page.getByLabel('Local unlock PIN', { exact: true }).fill('048261');

  await page.getByRole('button', { name: 'Unlock locally with PIN', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Unlock your private resources', exact: true })).toHaveCount(0);

  await context.setOffline(false);

  await page.evaluate((path) => {
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
  }, workspace);

  await expect(page.locator('pre')).toHaveText(marker);

  await expect(page.getByLabel('Local unlock PIN', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Lock private resources', exact: true }).click();

  await expect(page.getByLabel('Local unlock PIN', { exact: true })).toBeVisible();

  await expect(page.locator('pre')).toHaveCount(0);
});

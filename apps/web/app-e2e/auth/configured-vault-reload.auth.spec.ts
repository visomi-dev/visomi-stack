import type { Page, Request, Response, TestInfo } from '@playwright/test';

import { expect, expireSession, passkeySignup, signup, test, vaultUnlockUrl, virtualPasskey } from './support/fixtures';
import {
  firstDocument,
  expectAuthenticatedDocument,
  observeHydration,
  hydrationSession,
} from './support/session-reload';

const note = 'Synthetic note already opened before reload';
const vaultPath = '/app/en/db-example/vault';
const vaultApi = '/api/example/vault/';

async function hardReload(page: Page, url: string) {
  // Routing bypasses Playwright's HTTP cache on engines without Chromium's Page.reload command.
  await page.route(
    url,
    (route) =>
      route.continue({
        headers: { ...route.request().headers(), 'cache-control': 'no-cache' },
      }),
    { times: 1 },
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
}

test.beforeEach(async ({ context }) => {
  await observeHydration(context);
});

async function reloadHomeFromOpenVault(page: Page, info: TestInfo, label: string) {
  await page.getByRole('link', { name: label, exact: true }).first().click();

  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();

  const url = page.url();

  expect(new URL(url).pathname.endsWith('/home')).toBe(true);

  await expectAuthenticatedDocument(page, info, url, note, () => page.reload());

  await expect(page).toHaveURL(url);

  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
}

async function setupVault(page: Page) {
  await page.goto(vaultPath);

  await page.getByRole('button', { name: 'Set up my vault', exact: true }).click();
}

async function saveNote(page: Page) {
  const [publication] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/sync/push')),
    page.getByLabel('Your note', { exact: true }).fill(note),
  ]);

  expect(publication.ok()).toBe(true);
}

async function setupPinVault(page: Page) {
  await page.addInitScript(() => Object.defineProperty(navigator, 'credentials', { value: undefined }));

  await signup(page);

  await setupVault(page);

  await page.getByRole('button', { name: 'Use a PIN on this device', exact: true }).click();

  await page.getByLabel('Local unlock PIN', { exact: true }).fill('048261');

  await page.getByLabel('Confirm your new PIN', { exact: true }).fill('048261');

  await page.getByRole('button', { name: 'Set up with PIN', exact: true }).click();

  await expect(page.getByLabel('Your note', { exact: true })).toBeVisible();
}

function expectSignInRedirect(status: number, location: string | undefined, protectedUrl: string) {
  const target = new URL(protectedUrl);
  const redirect = new URL(location ?? '', target);

  expect(status).toBe(302);
  expect(redirect.origin).toBe(target.origin);
  expect(redirect.pathname).toBe('/app/en/auth/sign-in');
  expect(redirect.searchParams.get('returnTo')).toBe(
    target.pathname.endsWith('/home') ? '/home' : '/db-example/vault' + target.search,
  );
}

function trackSignInVaultRequests(page: Page) {
  let signInReceived = false;
  let vaultRequests = 0;
  const markSignIn = (response: Response) => {
    if (response.request().isNavigationRequest() && new URL(response.url()).pathname === '/app/en/auth/sign-in') {
      signInReceived = true;
    }
  };
  const traceVault = (request: Request) => {
    vaultRequests += Number(signInReceived && new URL(request.url()).pathname.startsWith(vaultApi));
  };

  page.on('response', markSignIn);
  page.on('request', traceVault);

  return () => {
    page.off('response', markSignIn);
    page.off('request', traceVault);

    return { signInReceived, vaultRequests };
  };
}

test('hard reload locks a configured passkey vault with a live session and keeps the note URL', async ({
  page,
  browser,
  browserName,
}, info) => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(browserName !== 'chromium', 'Requires a real WebAuthn PRF assertion from a Chromium virtual authenticator');
  const { cdp, credentialIds } = await virtualPasskey(page);
  const email = await passkeySignup(page);
  const registered = await credentialIds();
  const assertions: string[] = [];

  cdp.on('WebAuthn.credentialAsserted', ({ credential }) => assertions.push(credential.credentialId));

  await setupVault(page);

  await page.getByRole('button', { name: 'Set up with a passkey', exact: true }).click();

  await saveNote(page);

  const url = page.url();
  const unlockUrl = vaultUnlockUrl(url);
  const editor = page.getByLabel('Your note', { exact: true });
  const locked = page.getByRole('region', { name: 'Unlock your vault', exact: true });
  const unlock = locked.getByRole('button', { name: 'Use a passkey', exact: true });

  await expect(editor).toHaveValue(note);

  expect(assertions).toEqual(registered);

  await page.setViewportSize({ width: 390, height: 844 });

  // Start from a previously configured vault opened with its stored credential.
  await expectAuthenticatedDocument(page, info, url, note, () => page.goto(url));

  await expect(page).toHaveURL(unlockUrl);

  await unlock.click();

  await expect(editor).toHaveValue(note);

  const beforeReload = [...registered, ...registered];

  expect(assertions).toEqual(beforeReload);

  const reload = () => cdp.send('Page.reload', { ignoreCache: true });

  await expectAuthenticatedDocument(page, info, url, note, reload);

  await expect(page).toHaveURL(unlockUrl);

  await expect(unlock).toBeEnabled();

  await expect(locked.getByText('Use your passkey to view your data.', { exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();

  await expect(page.locator('app-pin-input')).toHaveCount(0);

  await expect(editor).toHaveCount(0);

  expect(assertions).toEqual(beforeReload);

  await page.evaluate(() => {
    Object.defineProperty(navigator.credentials, 'get', {
      configurable: true,
      value: async () => {
        Reflect.deleteProperty(navigator.credentials, 'get');

        throw new DOMException('Synthetic user cancellation', 'NotAllowedError');
      },
    });
  });

  await unlock.click();

  await expect(page.getByRole('status').filter({ hasText: 'Unlock canceled.' })).toBeVisible();

  await expect(page).toHaveURL(unlockUrl);

  await expect(editor).toHaveCount(0);

  expect(assertions).toEqual(beforeReload);

  await unlock.click();

  await expect(editor).toHaveValue(note);

  await expect(page).toHaveURL(url);

  expect(assertions).toEqual([...beforeReload, ...registered]);
  const afterUnlock = await credentialIds();

  expect(afterUnlock).toEqual(registered);

  const anonymous = await browser.newContext();

  try {
    const response = await anonymous.request.get(unlockUrl, { maxRedirects: 0 });

    expectSignInRedirect(response.status(), response.headers()['location'], url);
  } finally {
    await anonymous.close();
  }

  await expireSession(email);

  const expired = firstDocument(page, url);
  const finishTrace = trackSignInVaultRequests(page);

  await reload();

  const redirect = await expired;

  expectSignInRedirect(redirect.status(), redirect.headers()['location'], url);

  await expect(page.getByRole('heading', { name: 'Sign-in options', exact: true })).toBeVisible();

  const { signInReceived, vaultRequests } = finishTrace();

  expect(signInReceived).toBe(true);
  expect(vaultRequests).toBe(0);

  await info.attach('denied-document', {
    body: JSON.stringify({ initialStatus: redirect.status(), destination: 'sign-in', vaultRequests }),
    contentType: 'application/json',
  });

  const beforeSignIn = assertions.length;
  const [verified] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/passkeys/authentication/verify'),
    page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click(),
  ]);

  expect(verified.status()).toBe(200);
  expect(assertions).toHaveLength(beforeSignIn + 1);

  await expect(page).toHaveURL(unlockUrl);

  await expect(locked).toBeVisible();

  await expect(editor).toHaveCount(0);

  const beforeHome = assertions.length;

  await page.goto('/app/en/home');

  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

  await expect(locked).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Unlock your private resources', exact: true })).toHaveCount(0);

  expect(assertions).toHaveLength(beforeHome);
});

test('ordinary reload retains the session before and after passkey unlock on Vault and Home', async ({
  page,
  browserName,
}, info) => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(browserName !== 'chromium', 'Requires Chromium virtual WebAuthn PRF');
  const { cdp } = await virtualPasskey(page);

  await passkeySignup(page);

  await setupVault(page);

  await page.getByRole('button', { name: 'Set up with a passkey', exact: true }).click();

  await saveNote(page);

  const url = page.url();
  const locked = vaultUnlockUrl(url);
  const editor = page.getByLabel('Your note', { exact: true });
  const unlock = page.getByRole('button', { name: 'Use a passkey', exact: true });

  await page.setViewportSize({ width: 390, height: 844 });

  await page.reload();

  await expect(page).toHaveURL(locked);

  let assertions = 0;

  cdp.on('WebAuthn.credentialAsserted', () => assertions++);

  await expectAuthenticatedDocument(page, info, locked, note, () => page.reload());

  await expect(unlock).toBeEnabled();

  expect(assertions).toBe(0);

  await unlock.click();

  await expect(editor).toHaveValue(note);

  await expect(page).toHaveURL(url);

  await expectAuthenticatedDocument(page, info, url, note, () => page.reload());

  await expect(page).toHaveURL(locked);

  expect(assertions).toBe(1);

  await unlock.click();

  await expect(editor).toHaveValue(note);

  await reloadHomeFromOpenVault(page, info, 'Home');

  expect(assertions).toBe(2);
});

test('ordinary reload retains the session before and after PIN unlock on Vault and Home', async ({ page }, info) => {
  await setupPinVault(page);

  await saveNote(page);

  const url = page.url().replace('/app/en/', '/app/es/');
  const unlockUrl = vaultUnlockUrl(url);
  const pin = page.getByLabel('PIN de desbloqueo local', { exact: true });
  const editor = page.getByLabel('Tu nota', { exact: true });

  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(unlockUrl);

  await expectAuthenticatedDocument(page, info, unlockUrl, note, () => page.reload());

  await expect(page).toHaveURL(unlockUrl);

  await pin.fill('048261');

  await expect(editor).toHaveValue(note);

  await expectAuthenticatedDocument(page, info, url, note, () => page.reload());

  await expect(page).toHaveURL(unlockUrl);

  await pin.fill('048261');

  await expect(editor).toHaveValue(note);

  await reloadHomeFromOpenVault(page, info, 'Inicio');
});

test('a directly opened PIN vault stays in the localized shell after hard reload and opens the same note', async ({
  page,
}, info) => {
  await setupPinVault(page);

  await saveNote(page);

  const url = page.url().replace('/app/en/', '/app/es/');
  const unlockUrl = vaultUnlockUrl(url);
  const locked = page.getByRole('region', { name: 'Abre tu bóveda', exact: true });
  const pin = locked.getByLabel('PIN de desbloqueo local', { exact: true });
  const unlock = locked.getByRole('button', { name: 'Desbloquear con PIN', exact: true });
  const editor = page.getByLabel('Tu nota', { exact: true });

  await page.setViewportSize({ width: 390, height: 844 });

  await expectAuthenticatedDocument(page, info, unlockUrl, note, () => page.goto(unlockUrl));

  await expect(page).toHaveURL(unlockUrl);

  await pin.fill('04826');

  await expect(pin).toHaveValue('04826');

  await expect(editor).toHaveCount(0);

  await pin.pressSequentially('1');

  await expect(editor).toHaveValue(note);

  await expectAuthenticatedDocument(page, info, url, note, () => hardReload(page, url));

  await expect(page).toHaveURL(unlockUrl);

  await expect(editor).toHaveCount(0);

  await expect(locked.getByRole('button', { name: 'Usar passkey', exact: true })).toHaveCount(0);

  await expect(unlock).toHaveCount(0);

  await expect(locked.getByText('Usa tu PIN para ver tus datos.', { exact: true })).toBeVisible();

  await expect(locked.getByText('6 dígitos', { exact: true })).toHaveClass(/\bsr-only\b/);

  await expect(pin).toHaveAccessibleDescription('6 dígitos');

  await expect(pin).toHaveAttribute('maxlength', '6');

  await expect(page.getByRole('button', { name: 'Menú', exact: true })).toBeVisible();

  await pin.focus();

  await expect(pin).toBeFocused();

  await pin.evaluate((element) => {
    (element as HTMLInputElement).value = '048261';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
  });

  await expect(editor).toHaveValue(note);

  await expect(page).toHaveURL(url);

  await page.context().setOffline(true);

  try {
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

    await expect(page).toHaveURL(unlockUrl);

    await pin.fill('048261');

    await expect(editor).toHaveValue(note);

    await expect(page).toHaveURL(url);
  } finally {
    await page.context().setOffline(false);
  }
});

test('a locked vault links to its device pairing instructions by keyboard', async ({ page }, info) => {
  await setupPinVault(page);

  const url = page.url().replace('/app/en/', '/app/es/');
  const target = new URL(url).searchParams;

  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(vaultUnlockUrl(url));

  await expect(page.getByRole('heading', { name: 'Abre tu bóveda', exact: true })).toBeVisible();

  const pairing = page.getByRole('link', { name: 'Vincular otro dispositivo', exact: true });

  await pairing.focus();

  await expect(pairing).toBeFocused();

  await page.screenshot({ path: info.outputPath('vault-pin-es-mobile.png'), animations: 'disabled' });

  await pairing.press('Enter');

  await expect(page.getByRole('heading', { name: 'Seguridad', exact: true })).toBeVisible();

  const security = new URL(page.url());

  for (const field of ['tenantId', 'scopeId', 'objectId']) {
    expect(target.has(field)).toBe(true);
    expect(security.searchParams.get(field)).toBe(target.get(field));
  }

  await expect(
    page.getByText('Desbloquea la nota en este dispositivo para poder aprobar el otro.', { exact: true }),
  ).toBeVisible();
});

test('a session without a configured vault can load setup and ordinary protected pages', async ({ page }, info) => {
  await signup(page);

  const url = new URL(vaultPath, page.url()).href;

  await expectAuthenticatedDocument(page, info, url, note, () => page.goto(url));

  await expect(page).toHaveURL(url);

  await expect(page.getByRole('button', { name: 'Set up my vault', exact: true })).toBeVisible();

  await expect(page.getByRole('region', { name: 'Unlock your vault', exact: true })).toHaveCount(0);

  const unsafe = new URL(vaultUnlockUrl(url));

  unsafe.search = new URLSearchParams({
    tenantId: '11111111-1111-4111-8111-111111111111',
    scopeId: '22222222-2222-4222-8222-222222222222',
    objectId: '33333333-3333-4333-8333-333333333333',
    returnTo: 'https://external.example/',
  }).toString();

  await page.goto(unsafe.href);

  await expect(page).toHaveURL(url);

  await expect(page.getByRole('button', { name: 'Set up my vault', exact: true })).toBeVisible();

  await page.goto('/app/en/home');

  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

  await expect(page.getByRole('region', { name: 'Unlock your vault', exact: true })).toHaveCount(0);
});

test('Home reload redirects expired and anonymous sessions to sign-in with the Home return path', async ({
  page,
  browser,
}) => {
  const email = await signup(page);
  const homeUrl = page.url();

  await expireSession(email);

  const anonymous = await browser.newContext();

  try {
    await observeHydration(anonymous);

    const visitor = await anonymous.newPage();

    for (const [tab, navigate] of [
      [page, () => page.reload()],
      [visitor, () => visitor.goto(homeUrl)],
    ] as const) {
      const document = firstDocument(tab, homeUrl);
      const [first] = await Promise.all([document, navigate()]);
      const session = await hydrationSession(tab);

      expectSignInRedirect(first.status(), first.headers()['location'], homeUrl);
      expect(session).toEqual({ status: 200, access: 'anonymous' });

      await expect(tab.getByRole('button', { name: 'Sign in with a passkey', exact: true })).toBeVisible();
    }
  } finally {
    await anonymous.close();
  }
});

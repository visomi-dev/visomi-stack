import type { Page, Request, Response, TestInfo } from '@playwright/test';

import { expect, expireSession, passkeySignup, signup, test, vaultUnlockUrl, virtualPasskey } from './support/fixtures';

const note = 'Synthetic note already opened before reload';
const vaultPath = '/app/en/db-example/vault';
const vaultApi = '/api/example/vault/';

function firstDocument(page: Page, url: string) {
  return page.waitForResponse(
    (response) =>
      response.url() === url &&
      response.request().isNavigationRequest() &&
      response.request().redirectedFrom() === null,
  );
}

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

async function expectAuthenticatedVault(page: Page, info: TestInfo, url: string, navigate: () => Promise<unknown>) {
  const cookies = await page.context().cookies(url);
  const hasSessionCookie = cookies.some((cookie) => cookie.name === 'visomi.sid');
  const document = firstDocument(page, url);
  const order: string[] = [];
  const sessionRequests = new Set<Request>();
  const markDocument = (response: Response) => {
    if (response.url() === url && response.request().isNavigationRequest()) {
      order.push('protected-document-response');
    }
  };
  const revalidation = page.waitForResponse((response) => sessionRequests.has(response.request()));
  const trace = (request: Request) => {
    const path = new URL(request.url()).pathname;

    if (path === '/api/auth/session' && request.method() === 'GET' && order.includes('protected-document-response')) {
      sessionRequests.add(request);
    }

    if (path === vaultApi + 'policy') {
      order.push('vault-policy');
    }
  };
  const policy = page.waitForResponse((response) => new URL(response.url()).pathname === vaultApi + 'policy');

  page.on('response', markDocument);
  page.on('request', trace);

  const [first, revalidated, vaultPolicy] = await Promise.all([document, revalidation, policy, navigate()]);

  expect(first.status()).toBe(200);
  expect(first.request().redirectedTo()).toBeNull();
  const html = await first.text();
  const ssrFull = /"auth-initial-session":\{"available":true,"session":\{[^<]+?"access":"full"/.test(html);

  page.off('response', markDocument);
  page.off('request', trace);

  const session = await page.evaluate(async () => {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    const value: { access?: string; user?: { emailVerified?: boolean } } = await response.json();

    return { status: response.status, access: value.access, verified: value.user?.emailVerified };
  });

  expect(first.headers()['cache-control']).toBe('no-store');
  expect(ssrFull).toBe(true);
  expect(html.includes('<app-authenticated-layout')).toBe(true);
  expect(html.includes(note)).toBe(false);
  expect(revalidated.status()).toBe(200);
  expect(session.status).toBe(200);
  expect(session.access).toBe('full');
  expect(session.verified).toBe(true);
  expect(vaultPolicy.status()).toBe(200);
  expect(hasSessionCookie).toBe(true);
  expect(order.slice(0, 2)).toEqual(['protected-document-response', 'vault-policy']);

  await info.attach('protected-document', {
    body: JSON.stringify({
      initialStatus: first.status(),
      redirected: Boolean(first.request().redirectedTo()),
      hasSessionCookie,
      ssrSession: ssrFull ? 'full' : 'other',
      revalidationStatus: revalidated.status(),
      browserSession: session.access === 'full' ? 'full' : 'other',
      browserOrder: order.slice(0, 2),
    }),
    contentType: 'application/json',
  });
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

function expectSignInRedirect(status: number, location: string | undefined, protectedUrl: string) {
  const target = new URL(protectedUrl);
  const redirect = new URL(location ?? '', target);

  expect(status).toBe(302);
  expect(redirect.origin).toBe(target.origin);
  expect(redirect.pathname).toBe('/app/en/auth/sign-in');
  expect(redirect.searchParams.get('returnTo')).toBe('/db-example/vault' + target.search);
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
  await expectAuthenticatedVault(page, info, url, () => page.goto(url));

  await expect(page).toHaveURL(unlockUrl);

  await unlock.click();

  await expect(editor).toHaveValue(note);

  const beforeReload = [...registered, ...registered];

  expect(assertions).toEqual(beforeReload);

  const reload = () => cdp.send('Page.reload', { ignoreCache: true });

  await expectAuthenticatedVault(page, info, url, reload);

  await expect(page).toHaveURL(unlockUrl);

  await expect(unlock).toBeEnabled();

  await expect(
    locked.getByText('You’re still signed in. Use your passkey to unlock this vault.', { exact: true }),
  ).toBeVisible();

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

  await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();

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

test('a directly opened PIN vault stays in the localized shell after hard reload and opens the same note', async ({
  page,
}, info) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'credentials', { value: undefined }));

  await signup(page);

  await setupVault(page);

  await page.getByRole('button', { name: 'Use a PIN on this device', exact: true }).click();

  await page.getByLabel('Local unlock PIN', { exact: true }).fill('048261');

  await page.getByLabel('Confirm your new PIN', { exact: true }).fill('048261');

  await page.getByRole('button', { name: 'Set up with PIN', exact: true }).click();

  await saveNote(page);

  const url = page.url().replace('/app/en/', '/app/es/');
  const unlockUrl = vaultUnlockUrl(url);
  const locked = page.getByRole('region', { name: 'Desbloquea tu bóveda', exact: true });
  const pin = locked.getByLabel('PIN de desbloqueo local', { exact: true });
  const unlock = locked.getByRole('button', { name: 'Desbloquear con PIN', exact: true });
  const editor = page.getByLabel('Tu nota', { exact: true });

  await page.setViewportSize({ width: 390, height: 844 });

  await expectAuthenticatedVault(page, info, unlockUrl, () => page.goto(unlockUrl));

  await expect(page).toHaveURL(unlockUrl);

  await pin.fill('04826');

  await expect(pin).toHaveValue('04826');

  await expect(editor).toHaveCount(0);

  await pin.pressSequentially('1');

  await expect(editor).toHaveValue(note);

  await expectAuthenticatedVault(page, info, url, () => hardReload(page, url));

  await expect(page).toHaveURL(unlockUrl);

  await expect(editor).toHaveCount(0);

  await expect(locked.getByRole('button', { name: 'Usar passkey', exact: true })).toHaveCount(0);

  await expect(unlock).toHaveCount(0);

  await expect(
    locked.getByText('Sigues en tu cuenta. Usa tu PIN para abrir la bóveda.', { exact: true }),
  ).toBeVisible();

  await expect(locked.getByText('6 dígitos', { exact: true })).toHaveClass(/\bsr-only\b/);

  await expect(pin).toHaveAccessibleDescription('6 dígitos');

  await expect(pin).toHaveAttribute('maxlength', '6');

  await expect(page.getByRole('button', { name: 'Menú', exact: true })).toBeVisible();

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

test('a session without a configured vault can load setup and ordinary protected pages', async ({ page }, info) => {
  await signup(page);

  const url = new URL(vaultPath, page.url()).href;

  await expectAuthenticatedVault(page, info, url, () => page.goto(url));

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

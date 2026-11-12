import { expect, test, signup } from './support/fixtures';

test('retries Google reauthentication after another tab invalidates the attempt', async ({ page, context }) => {
  await signup(page);

  const sessionResponse = await context.request.get('/api/auth/session');
  const session = await sessionResponse.json();
  const flowId = '33333333-3333-4333-8333-333333333333';
  const expiresAt = '2099-01-01T00:00:00Z';
  const verifications: { flowId: string; code: string }[] = [];
  const retry = page.getByRole('button', { name: 'Try Google again', exact: true });
  let attempts = 0;

  await page.route('**/api/auth/providers', (route) =>
    route.fulfill({
      json: { passkey: true, password: true, totp: true, google: { enabled: true, clientId: 'synthetic-client' } },
    }),
  );

  await page.route('**/api/auth/methods', (route) =>
    route.fulfill({ json: { passkeys: [], password: false, totp: false, google: [{ id: 'synthetic-google' }] } }),
  );

  await page.route('**/api/auth/google/start', (route) => {
    expect(route.request().postDataJSON()).toEqual({ intent: 'reauth' });

    return route.fulfill({
      status: 201,
      json: {
        flowId: '22222222-2222-4222-8222-222222222222',
        expiresAt,
        nonce: 'synthetic-nonce',
        clientId: 'synthetic-client',
      },
    });
  });

  await page.route('**/api/auth/google/complete', async (route) => {
    attempts++;

    if (attempts === 1) {
      await page.evaluate(() => {
        const channel = new BroadcastChannel('visomi-auth');

        channel.postMessage('session-changed');
        channel.close();
      });

      await retry.waitFor({ state: 'visible' });

      await route.abort();

      return;
    }

    await route.fulfill({ status: 202, json: { flowId, expiresAt, factor: 'email' } });
  });

  await page.route('**/api/auth/google/email/verify', (route) => {
    const proof = route.request().postDataJSON() as { flowId: string; code: string };

    verifications.push(proof);

    if (proof.code === '001234') {
      return route.fulfill({ status: 400, json: { error: 'verification_failed' } });
    }

    return route.fulfill({ json: { ...session, method: 'google' } });
  });

  await page.addInitScript(() => {
    let callback: (result: { credential: string }) => void;

    Object.defineProperty(window, 'google', {
      value: {
        accounts: {
          id: {
            initialize: (options: { callback: typeof callback }) => {
              callback = options.callback;
            },
            renderButton: (element: HTMLElement) => {
              const button = document.createElement('button');

              button.type = 'button';
              button.textContent = 'Synthetic Google account';
              button.onclick = () => callback({ credential: 'synthetic-id-token' });
              element.replaceChildren(button);
            },
            cancel: () => undefined,
          },
        },
      },
    });
  });

  await page.goto('/app/en/auth/reauthenticate?returnTo=%2Fsecurity%2Fpassword');

  await page.getByRole('button', { name: 'Synthetic Google account', exact: true }).click();

  await expect(retry).toBeEnabled();

  await retry.click();

  await page.getByRole('button', { name: 'Synthetic Google account', exact: true }).click();

  await expect(page.getByText('Verify your email to finish continuing with Google.', { exact: true })).toBeVisible();

  await expect(page).toHaveURL(/auth\/reauthenticate/);

  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);

  expect(verifications).toHaveLength(0);

  await page.getByLabel('Verification code', { exact: true }).fill('001234');

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('We could not verify these details.');

  await expect(page).toHaveURL(/auth\/reauthenticate/);

  await page.getByLabel('Verification code', { exact: true }).fill('005678');

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Manage password', exact: true })).toBeVisible();

  await expect(page).toHaveURL('/app/en/security/password');

  expect(verifications).toEqual([
    { flowId, code: '001234' },
    { flowId, code: '005678' },
  ]);
});

for (const locale of ['en', 'es']) {
  test.describe(`${locale} page locale`, () => {
    test.use({ locale: locale === 'en' ? 'es-MX' : 'en-US' });

    test(`${locale} GIS presentation follows its container and theme without restarting the transaction`, async ({
      page,
    }) => {
      let starts = 0;
      let attempts = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      await page.route('**/api/auth/providers', (route) =>
        route.fulfill({
          json: { passkey: true, password: true, totp: false, google: { enabled: true, clientId: 'synthetic-client' } },
        }),
      );

      await page.route('**/api/auth/google/start', (route) => {
        starts++;

        return route.fulfill({
          status: 201,
          json: {
            flowId: '22222222-2222-4222-8222-222222222222',
            expiresAt: '2099-01-01T00:00:00Z',
            nonce: 'synthetic-nonce',
            clientId: 'synthetic-client',
          },
        });
      });

      await page.route('**/api/auth/google/complete', async (route) => {
        attempts++;

        await gate;

        await route.fulfill({ status: 401, json: { error: 'google_token_invalid' } });
      });

      const mockGoogle = () => {
        let callback: (result: { credential: string }) => void;
        let initialized = 0;
        let renders = 0;

        Object.defineProperty(window, 'google', {
          value: {
            accounts: {
              id: {
                initialize: (options: { callback: typeof callback }) => {
                  callback = options.callback;
                  initialized++;
                },
                renderButton: (element: HTMLElement, options: Record<string, string>) => {
                  const frame = document.createElement('div');
                  const button = document.createElement('button');

                  // GIS reserves frame space outside the visible control. Flex shrinking must not narrow it.
                  frame.style.display = 'flex';
                  frame.style.width = `${Number(options['width']) + 20}px`;
                  button.type = 'button';
                  button.textContent = 'Synthetic Google account';
                  button.style.width = `${options['width']}px`;
                  button.style.height = '40px';
                  button.style.margin = '0 10px';
                  button.setAttribute('data-initialized', String(initialized));
                  button.setAttribute('data-renders', String(++renders));
                  for (const [key, value] of Object.entries(options)) {
                    button.setAttribute(`data-google-${key}`, value);
                  }
                  button.onclick = () => callback({ credential: 'synthetic-id-token' });
                  frame.append(button);
                  element.replaceChildren(frame);
                },
                cancel: () => undefined,
              },
            },
          },
        });
      };

      await page.route('https://accounts.google.com/gsi/client?**', (route) => {
        expect(new URL(route.request().url()).searchParams.get('hl')).toBe(locale);

        return route.fulfill({ contentType: 'application/javascript', body: `(${mockGoogle.toString()})();` });
      });

      await page.setViewportSize({ width: 320, height: 844 });

      await page.emulateMedia({ colorScheme: 'light' });

      await page.goto(`/app/${locale}/auth/sign-in`);

      const provider = page.getByRole('button', { name: 'Synthetic Google account', exact: true });
      const container = page.locator('app-google-button div[aria-busy]');

      await expect(provider).toHaveAttribute('data-google-locale', locale);

      await expect(provider).toHaveAttribute('data-google-shape', 'rectangular');

      await expect(provider).toHaveAttribute('data-google-size', 'large');

      await expect(provider).toHaveAttribute('data-google-text', 'continue_with');

      await expect(provider).toHaveAttribute('data-google-theme', 'outline');

      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });

        await expect
          .poll(async () => {
            const configuredWidth = await provider.getAttribute('data-google-width');
            const configured = Number(configuredWidth);
            const measured = await page
              .locator('app-sign-in > section > button')
              .evaluate((element) => Math.min(400, Math.floor(element.getBoundingClientRect().width)));
            const visible = await provider.boundingBox();

            return configured === measured && Math.abs((visible?.width ?? 0) - measured) <= 1;
          })
          .toBe(true);

        await expect(provider).toHaveAttribute('data-initialized', '1');
      }

      await page.locator('button[app-theme-switcher]').click();

      await expect(provider).toHaveAttribute('data-google-theme', 'filled_black');

      await expect(container).toHaveCSS('color-scheme', 'light');

      expect(starts).toBe(1);
      const rendered = await provider.getAttribute('data-renders');

      try {
        await provider.click();

        await expect(container).toHaveAttribute('aria-busy', 'true');

        await expect(page.getByRole('status', { name: /Working|Procesando/ })).toHaveCount(1);

        await expect(page.locator('app-auth-feedback [appUI="loader"]')).toHaveCount(0);

        await page.setViewportSize({ width: 390, height: 844 });

        await expect(provider).toHaveAttribute('data-renders', rendered!);

        // A callback can arrive twice even though the parent makes the provider inert.
        await provider.evaluate((element: HTMLButtonElement) => element.click());

        await expect.poll(() => attempts).toBe(1);

        expect(starts).toBe(1);
      } finally {
        release();
      }

      const retry = page.getByRole('button', {
        name: locale === 'en' ? 'Try Google again' : 'Intentar con Google de nuevo',
      });

      await expect(retry).toBeEnabled();

      await expect(container).toHaveAttribute('aria-busy', 'false');

      await retry.click();

      await expect.poll(() => starts).toBe(2);

      await expect(provider).toHaveAttribute('data-initialized', '2');

      await expect(provider).toHaveAttribute('data-google-theme', 'filled_black');
    });
  });
}

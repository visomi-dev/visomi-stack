import type { Page } from '@playwright/test';

import { expect, test, password } from './support/fixtures';

for (const locale of ['en', 'es']) {
  for (const method of ['passkey', 'password']) {
    const suffix = method === 'password' ? '/password' : '';
    const endpoint = method === 'passkey' ? 'passkeys/authentication/options' : 'password/sign-in';
    const name =
      method === 'passkey'
        ? locale === 'en'
          ? 'Sign in with a passkey'
          : 'Entrar con una clave de acceso'
        : locale === 'en'
          ? 'Sign in'
          : 'Iniciar sesión';
    const prepare =
      method === 'password'
        ? async (page: Page) => {
            await page
              .getByLabel(locale === 'en' ? 'Email address' : 'Correo electrónico', { exact: true })
              .fill('loading@example.test');

            await page.locator('#account-password').fill(password);
          }
        : undefined;

    test(`${locale} ${method} sign-in keeps progress inside the active button`, async ({ page, browserName }, info) => {
      // eslint-disable-next-line playwright/no-skipped-test -- Match the existing Chromium-only WebAuthn coverage.
      test.skip(method === 'passkey' && browserName !== 'chromium', 'Passkey browser coverage uses Chromium.');
      const failures: string[] = [];

      page.on('pageerror', (error) => failures.push(error.name));
      page.on('console', (message) => {
        if (message.type() === 'error') {
          failures.push(message.text());
        }
      });

      await page.setViewportSize({ width: 390, height: 844 });

      await page.emulateMedia({ reducedMotion: 'no-preference' });

      await page.goto(`/app/${locale}/auth/sign-in${suffix}`);

      await prepare?.(page);

      const button = page.getByRole('button', { name, exact: true });

      await expect(button).toBeEnabled();

      await page.evaluate(() => document.fonts.ready);

      const before = await button.boundingBox();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let requests = 0;

      await page.route(`**/api/auth/${endpoint}`, async (route) => {
        requests++;

        await gate;

        await route.fulfill({ status: 400, json: { error: 'invalid_credentials' } });
      });

      try {
        await button.click();

        await expect(button).toHaveAttribute('aria-busy', 'true');

        await expect(button).toBeDisabled();

        await expect(button).toHaveText(name);

        await expect.poll(() => requests).toBe(1);

        const spinner = await button.evaluate((element) => {
          const style = getComputedStyle(element, '::after');

          return {
            content: style.content,
            width: style.width,
            height: style.height,
            mask: style.maskImage,
            ink: style.backgroundColor,
            color: getComputedStyle(element).color,
          };
        });

        expect(spinner.content).toBe('""');
        expect(spinner.width).toBe('16px');
        expect(spinner.height).toBe('16px');
        expect(spinner.mask).toContain('visomi-loader-smil');
        expect(spinner.ink).toBe(spinner.color);
        const during = await button.boundingBox();

        expect(during?.width).toBe(before?.width);
        expect(during?.height).toBe(before?.height);
        const feedback = page
          .locator('app-auth-feedback')
          .filter({ has: page.getByRole('status', { name: /Working|Procesando/ }) });

        await expect(feedback).toHaveClass(/sr-only/);

        expect(failures).toEqual([]);
        const firstFrame = await button.screenshot({ caret: 'initial' });

        await expect
          .poll(async () => {
            const frame = await button.screenshot({ caret: 'initial' });

            return !frame.equals(firstFrame);
          })
          .toBe(true);

        await page.screenshot({ path: info.outputPath(`${locale}-${method}-loading.png`), caret: 'initial' });

        await page.emulateMedia({ reducedMotion: 'reduce' });

        const reducedMask = await button.evaluate((element) => getComputedStyle(element, '::after').maskImage);

        expect(reducedMask).toContain('isotype');

        await page.screenshot({ path: info.outputPath(`${locale}-${method}-static.png`), caret: 'initial' });

        await button.evaluate((element: HTMLButtonElement) => element.click());

        expect(requests).toBe(1);
      } finally {
        release();
      }

      await expect(button).toBeEnabled();

      await expect(button).toHaveAttribute('aria-busy', 'false');

      await expect(page.locator('[data-action-error]')).toBeFocused();

      const stopped = await button.evaluate((element) => getComputedStyle(element, '::after').visibility);

      expect(stopped).toBe('hidden');
    });
  }
}

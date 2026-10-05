import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const directory = resolve('dist/email-previews');

try {
  for (const locale of ['en', 'es']) {
    for (const name of ['verification', 'recovery-notice', 'email-change-notice']) {
      const html = await readFile(resolve(directory, `${name}.${locale}.html`), 'utf8');

      for (const width of [375, 800]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
        const page = await context.newPage();

        try {
          await page.setContent(html);
          assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();

          assert.deepEqual(audit.violations, [], `${name}.${locale}: accessibility violations`);
          await page.screenshot({ path: resolve(directory, `${name}.${locale}.${width}.png`), fullPage: true });
        } finally {
          await context.close();
        }
      }
    }
  }

  console.log('All 12 localized email previews passed layout and accessibility checks.');
} finally {
  await browser.close();
}

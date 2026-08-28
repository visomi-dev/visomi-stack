/* eslint-disable no-console */
'use strict';

const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8081';
const MEDIA_DIR = path.join(process.cwd(), 'media/aria-foundation');

const VIEWPORTS = [
  { label: 'mobile', width: 390, height: 844 },
  { label: 'desktop', width: 1280, height: 800 },
];

const THEMES = ['light', 'dark'];

async function bootstrapSession(request) {
  const email = `engineer+${randomUUID()}@themis.visomi.dev`;
  const password = 'S3cureAuth!';

  await request.post(`${BASE_URL}/api/auth/sign-up`, { data: { email, password } });

  const mailbox = await request.get(
    `${BASE_URL}/api/test/mailbox/latest?email=${encodeURIComponent(email)}&purpose=sign_up`,
  );
  const payload = await mailbox.json();

  if (!payload.challengeId || !payload.pin) {
    throw new Error(`Mailbox response missing challengeId/pin: ${JSON.stringify(payload)}`);
  }

  await request.post(`${BASE_URL}/api/auth/sign-up/verify`, {
    data: { challengeId: payload.challengeId, pin: payload.pin },
  });

  const session = await request.get(`${BASE_URL}/api/auth/session`);

  if (!session.ok()) {
    throw new Error('Failed to establish session after sign-up');
  }

  return { email };
}

async function captureShot(browser, viewport, theme, shot) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    colorScheme: theme,
    viewport: { width: viewport.width, height: viewport.height },
  });

  try {
    if (shot.auth) {
      const { email } = await bootstrapSession(context.request);
      console.log(`    [auth] ${email} for ${shot.name} (${viewport.label} ${theme})`);
    }

    const page = await context.newPage();
    await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: 'domcontentloaded' });

    if (shot.collapsed) {
      const collapseButton = page.locator('aside').getByRole('button', { name: /Collapse navigation/ });

      if (await collapseButton.isVisible().catch(() => false)) {
        await collapseButton.click();
      }
    }

    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(500);

    const fileName = `${shot.name}-${viewport.label}-${theme}.png`;
    const filePath = path.join(MEDIA_DIR, fileName);

    await page.screenshot({ path: filePath, fullPage: true });
    console.log(`  [shot] ${fileName}`);
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const browser = await chromium.launch();
  const shots = [
    { name: 'sign-in', path: '/app/en/sign-in', auth: false },
    { name: 'dashboard', path: '/app/en/dashboard', auth: true },
    { name: 'projects', path: '/app/en/projects', auth: true },
    { name: 'gallery', path: '/app/en/gallery', auth: true },
    { name: 'sidebar-collapsed', path: '/app/en/dashboard', auth: true, collapsed: true },
  ];
  let failed = 0;

  for (const shot of shots) {
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        try {
          await captureShot(browser, viewport, theme, shot);
        } catch (error) {
          failed += 1;
          console.error(`  [shot] ${shot.name} ${viewport.label} ${theme} failed:`, error.message);
        }
      }
    }
  }

  await browser.close();

  if (failed > 0) {
    console.error(`[aria-foundation] ${failed} screenshots failed`);
    process.exit(1);
  }

  console.log(
    `[aria-foundation] ${shots.length * VIEWPORTS.length * THEMES.length} screenshots captured in ${path.relative(process.cwd(), MEDIA_DIR)}`,
  );
}

main().catch((error) => {
  console.error('[aria-foundation] fatal:', error);
  process.exit(1);
});

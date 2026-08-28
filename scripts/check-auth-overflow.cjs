/* eslint-disable */
// Quick check: for each auth route snapshot, compare document height vs
// viewport height to confirm there's no page-level scroll.

const fs = require('node:fs');
const path = require('node:path');

const { chromium } = require('@playwright/test');

const VIEWPORTS = [
  { label: '360', width: 360, height: 720 },
  { label: '390', width: 390, height: 844 },
  { label: '520', width: 520, height: 720 },
  { label: '768', width: 768, height: 1024 },
  { label: '1280', width: 1280, height: 800 },
];
const AUTH_ROUTES = ['sign-in', 'sign-up', 'forgotten-password', 'verify-email', 'verify-device', 'reset-password'];

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8081';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  try {
    for (const viewport of VIEWPORTS) {
      console.log(`\n[auth][${viewport.label}]`);
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();

      for (const route of AUTH_ROUTES) {
        await page.goto(`${BASE_URL}/app/en/${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(300);
        const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        const overflow = docHeight > viewport.height ? 'OVERFLOW' : 'ok';
        console.log(`    ${route.padEnd(20)} doc=${docHeight} viewport=${viewport.height} ${overflow}`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }
})();

/* eslint-disable */
// Captures a structured snapshot grid for the Themis surfaces after the
// post-refactor UI review pass.
//
// Surfaces:
//   - Site:  <base>/en/, <base>/es/                -> 2 routes x 3 viewports x 2 themes = 12 PNGs
//   - Auth:  <base>/app/<locale>/<route>          -> 6 routes x 5 viewports x 2 themes = 60 PNGs
//
// Both surfaces are served by the same gateway (`apps/web/server`). The site
// is mounted at `/` and the auth Angular app is mounted at `/app/`, so a
// single BASE_URL covers both halves.
//
// The docs route (/docs/) is currently not linked from the production nav and
// is documented as a P3 follow-up in the post-refactor UI review spec. The
// snapshot script intentionally skips it rather than failing the rest of the
// run.
//
// Behavior:
//   - Boots against one port: BASE_URL (default: http://127.0.0.1:8081).
//   - Probes the gateway first; if unreachable, the script logs a clear
//     message and exits non-zero so the caller can boot the gateway.
//   - Each surface is captured sequentially. The auth half requires the test
//     API to be enabled (`ENABLE_TEST_API=true`); without it, the auth routes
//     still load but OTP steps cannot be exercised interactively. The
//     snapshot script does not need the test API — it only captures static
//     route states.
//   - Uses waitUntil: 'domcontentloaded' + a 400ms settle so SSR-rendered
//     HTML is captured before any client-only hydration effects.
//
// Output:
//   media/ui-snapshots/site-<route>-<width>-<theme>.png
//   media/ui-snapshots/auth-<route>-<width>-<theme>.png
//
// Run:
//   # Boot the full gateway once
//   pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production
//   node dist/apps/web/server/main.js &
//
//   # Capture both halves against the same port
//   node scripts/capture-ui-snapshots.cjs
//
//   # Or override the base URL
//   BASE_URL=http://127.0.0.1:8082 node scripts/capture-ui-snapshots.cjs
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const MEDIA_ROOT = path.join(process.cwd(), 'media', 'ui-snapshots');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8081';

const SITE_VIEWPORTS = [
  { label: '375', width: 375, height: 812 },
  { label: '768', width: 768, height: 1024 },
  { label: '1280', width: 1280, height: 800 },
];

const AUTH_VIEWPORTS = [
  { label: '360', width: 360, height: 720 },
  { label: '390', width: 390, height: 844 },
  { label: '520', width: 520, height: 720 },
  { label: '768', width: 768, height: 1024 },
  { label: '1280', width: 1280, height: 800 },
];

const THEMES = ['light', 'dark'];

const SITE_ROUTES = [
  { label: 'en-home', path: '/en/' },
  { label: 'es-home', path: '/es/' },
];

const AUTH_ROUTES = [
  { label: 'sign-in', path: '/app/en/sign-in' },
  { label: 'sign-up', path: '/app/en/sign-up' },
  { label: 'forgotten-password', path: '/app/en/forgotten-password' },
  { label: 'verify-email', path: '/app/en/verify-email' },
  { label: 'verify-device', path: '/app/en/verify-device' },
  { label: 'reset-password', path: '/app/en/reset-password' },
];

async function isReachable(baseUrl, timeoutMs = 1500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(baseUrl, { method: 'GET', signal: controller.signal });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function captureSurface({ name, baseUrl, routes, viewports, themes }) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  let count = 0;
  try {
    for (const viewport of viewports) {
      console.log(`\n[${name}] viewport ${viewport.label} (${viewport.width}x${viewport.height})`);
      for (const theme of themes) {
        console.log(`  -- theme ${theme} --`);
        for (const route of routes) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 1,
            colorScheme: theme,
          });
          const page = await context.newPage();
          const url = `${baseUrl}${route.path}`;
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(400);
            const filename = `${name}-${route.label}-${viewport.label}-${theme}.png`;
            const out = path.join(MEDIA_ROOT, filename);
            await page.screenshot({ path: out, fullPage: true });
            count += 1;
            console.log(`    ${route.label} -> ${path.relative(process.cwd(), out)}`);
          } catch (err) {
            console.warn(`    ${route.label} FAILED: ${err.message}`);
          } finally {
            await context.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  return count;
}

(async () => {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
  console.log(`output -> ${path.relative(process.cwd(), MEDIA_ROOT)}`);
  console.log(`base URL -> ${BASE_URL}`);

  if (!(await isReachable(BASE_URL))) {
    console.error(`gateway ${BASE_URL} is not reachable.`);
    console.error('boot the gateway first, e.g.:');
    console.error(
      '  pnpm exec nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production',
    );
    console.error('  node dist/apps/web/server/main.js &');
    process.exit(1);
  }

  const siteCount = await captureSurface({
    name: 'site',
    baseUrl: BASE_URL,
    routes: SITE_ROUTES,
    viewports: SITE_VIEWPORTS,
    themes: THEMES,
  });
  console.log(`\n[site] captured ${siteCount} PNGs.`);

  const authCount = await captureSurface({
    name: 'auth',
    baseUrl: BASE_URL,
    routes: AUTH_ROUTES,
    viewports: AUTH_VIEWPORTS,
    themes: THEMES,
  });
  console.log(`\n[auth] captured ${authCount} PNGs.`);

  console.log('\nDone.');
})();

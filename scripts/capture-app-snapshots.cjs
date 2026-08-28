/* eslint-disable */
// Focused capture for the authenticated layout. Uses the Playwright UI for
// the sign-up + OTP flow (mirroring apps/web/app-e2e/src/support/auth.ts) so
// the session cookie lives on the browser context. Then walks the routes and
// captures 3 viewports x 2 themes per route so we can verify the bottom nav
// on mobile and the layout on tablet/desktop.

const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const MEDIA_ROOT = path.join(process.cwd(), 'media', 'ui-snapshots');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8081';

const VIEWPORTS = [
  { label: '360', width: 360, height: 720 },
  { label: '768', width: 768, height: 1024 },
  { label: '1280', width: 1280, height: 800 },
];
const THEMES = ['light', 'dark'];
const ROUTES = ['/app/en', '/app/en/activation', '/app/en/projects', '/app/en/projects/new'];

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

async function readLatestPin(api, email, purpose) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await api.get(
      `${BASE_URL}/api/test/mailbox/latest?email=${encodeURIComponent(email)}&purpose=${purpose}`,
    );

    if (response.ok()) {
      const payload = await response.json();

      if (payload.pin) {
        return payload.pin;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`pin not delivered for ${email} (purpose=${purpose})`);
}

async function fillOtp(page, code) {
  const digits = code.split('');

  for (const [index, digit] of digits.entries()) {
    await page.locator('[data-slot=pin-input] input').nth(index).fill(digit);
  }
}

async function signUpAndVerify(page, email, password) {
  const api = page.context().request;

  // Sign-up via the test API (same as registerAndAuthenticate in e2e).
  const signUp = await api.post(`${BASE_URL}/api/auth/sign-up`, {
    data: { email, password },
  });

  if (!signUp.ok()) {
    throw new Error(`sign-up failed: ${signUp.status()} ${await signUp.text()}`);
  }

  const mailbox = await api.get(
    `${BASE_URL}/api/test/mailbox/latest?email=${encodeURIComponent(email)}&purpose=sign_up`,
  );
  const { pin } = await mailbox.json();

  const verify = await api.post(`${BASE_URL}/api/auth/sign-up/verify`, {
    data: { challengeId: (await signUp.json()).data.challengeId, pin },
  });

  if (!verify.ok()) {
    throw new Error(`verify failed: ${verify.status()} ${await verify.text()}`);
  }

  await api.post(`${BASE_URL}/api/activation/complete`, { data: { complete: true } });
}

async function signInViaUi(page, email, password) {
  await page.goto(`${BASE_URL}/app/en/sign-in`);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/verify-device/, { timeout: 15000 });

  const api = page.context().request;
  const pin = await readLatestPin(api, email, 'sign_in');

  await fillOtp(page, pin);
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  // Post-verify navigates to /app/en. If activation is incomplete the
  // activatedGuard may redirect to /app/en/activation. Reject sub-routes
  // like /app/en/sign-in or /app/en/verify-device (those would mean auth failed).
  await page.waitForURL(
    (url) => url.pathname === '/app/en' || url.pathname === '/app/en/' || url.pathname.startsWith('/app/en/activation'),
    { timeout: 15000 },
  );
  console.log(`    [signInViaUi] post-verify url: ${page.url()}`);
}

async function captureForTheme(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: theme,
  });

  const page = await context.newPage();

  const email = `engineer+layout-spec-${Date.now()}-${Math.floor(Math.random() * 10000)}@themis.visomi.dev`;
  const password = 'Strong-Pass-12!';

  await signUpAndVerify(page, email, password);

  // The sign-up + verify flow sets a session cookie. Sign out so the sign-in
  // page doesn't redirect straight to the dashboard.
  await page.context().request.post(`${BASE_URL}/api/auth/sign-out`);
  await page.context().clearCookies();

  await signInViaUi(page, email, password);

  for (const viewport of VIEWPORTS) {
    console.log(`\n[app][${theme}] viewport ${viewport.label} (${viewport.width}x${viewport.height})`);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of ROUTES) {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      const filename = `app${route.replace(/\//g, '-')}-${viewport.label}-${theme}.png`;
      const out = path.join(MEDIA_ROOT, filename);

      // Capture the actual viewport (not fullPage) so we can verify the
      // layout height math: topbar + main + bottom-nav must fit in dvh
      // without page-level scroll. Also screenshot the document height to
      // compare against viewport height for the overflow check.
      const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const viewHeight = viewport.height;
      console.log(
        `    ${route} doc=${docHeight}px viewport=${viewHeight}px (overflow: ${docHeight > viewHeight ? 'YES' : 'no'})`,
      );
      await page.screenshot({ path: out, fullPage: false });
    }
  }

  await context.close();
}

(async () => {
  if (!(await isReachable(BASE_URL))) {
    console.error(`gateway ${BASE_URL} not reachable`);
    process.exit(1);
  }

  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  let count = 0;

  try {
    for (const theme of THEMES) {
      console.log(`\n[theme ${theme}]`);
      await captureForTheme(browser, theme);
      count += VIEWPORTS.length * ROUTES.length;
    }
  } finally {
    await browser.close();
  }

  console.log(`\n[app] captured ${count} PNGs.`);
})();

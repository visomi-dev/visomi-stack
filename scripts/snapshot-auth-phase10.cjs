/* eslint-disable */
// Captures the auth fidelity pass screens at the Phase 10 viewport matrix
// (360/390/520/768/1280) x light/dark, for each auth route.
//
// Requires the gateway running at http://localhost:8081 with ENABLE_TEST_API=true.
// Writes PNGs to .opencode/snapshots/auth-phase10/<route>-<width>-<theme>.png.
//
// For OTP screens (verify-email, verify-device, reset-password OTP step)
// the script auto-creates a sign-up challenge via the API and renders the
// page with the pending challenge in session, so the OTP screen is reachable.
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = 'http://localhost:8081';
const MEDIA_ROOT = path.join(process.cwd(), '.opencode', 'snapshots', 'auth-phase10');

const VIEWPORTS = [
  { label: '360', width: 360, height: 720 },
  { label: '390', width: 390, height: 844 },
  { label: '520', width: 520, height: 720 },
  { label: '768', width: 768, height: 1024 },
  { label: '1280', width: 1280, height: 800 },
];

const THEMES = ['light', 'dark'];

const ROUTES = [
  { label: 'sign-in', path: '/app/en/sign-in', needsUser: false },
  { label: 'sign-up', path: '/app/en/sign-up', needsUser: false },
  { label: 'forgotten-password', path: '/app/en/forgotten-password', needsUser: false },
  { label: 'verify-email', path: '/app/en/verify-email', needsUser: true, purpose: 'sign_up' },
  { label: 'verify-device', path: '/app/en/verify-device', needsUser: true, purpose: 'sign_in' },
  { label: 'reset-password', path: '/app/en/reset-password', needsUser: true, purpose: 'password_reset' },
];

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function bootstrapUser(email, password, purpose) {
  await fetch(`${BASE_URL}/api/test/mailbox`, { method: 'DELETE' });
  await fetchJson(`${BASE_URL}/api/auth/sign-up`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const pin = (
    await fetchJson(
      `${BASE_URL}/api/test/mailbox/latest?${new URLSearchParams({ email, purpose: 'sign_up' }).toString()}`,
    )
  ).pin;
  if (!pin) throw new Error(`no sign_up pin for ${email}`);
  return { email, password, pin };
}

async function primeVerifyContext(page, route) {
  const request = page.context().request;
  const email = `engineer+visual-${Date.now()}-${Math.floor(Math.random() * 10000)}@themis.visomi.dev`;
  const password = 'Strong-Pass-12!';

  if (route.purpose === 'sign_up') {
    await page.goto(`${BASE_URL}/app/en/sign-up`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
    await page.getByRole('textbox', { name: 'Confirm password' }).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/app\/en\/verify-email$/, { timeout: 15000, waitUntil: 'commit' });

    return true;
  }

  await request.delete(`${BASE_URL}/api/test/mailbox`);
  const signUp = await request.post(`${BASE_URL}/api/auth/sign-up`, { data: { email, password } });
  if (!signUp.ok()) throw new Error(`sign-up failed: ${signUp.status()}`);

  const signUpData = await signUp.json();
  const signUpPin = (
    await fetchJson(
      `${BASE_URL}/api/test/mailbox/latest?${new URLSearchParams({ email, purpose: 'sign_up' }).toString()}`,
    )
  ).pin;

  const verify = await request.post(`${BASE_URL}/api/auth/sign-up/verify`, {
    data: { challengeId: signUpData.data.challengeId, pin: signUpPin },
  });
  if (!verify.ok()) throw new Error(`sign-up verification failed: ${verify.status()}`);

  await request.post(`${BASE_URL}/api/auth/sign-out`);

  if (route.purpose === 'sign_in') {
    await page.goto(`${BASE_URL}/app/en/sign-in`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/app\/en\/verify-device$/, { timeout: 15000, waitUntil: 'commit' });

    return true;
  }

  await page.goto(`${BASE_URL}/app/en/forgotten-password`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('button', { name: 'Send recovery link' }).click();
  await page.waitForURL(/\/app\/en\/reset-password$/, { timeout: 15000, waitUntil: 'commit' });

  return true;
}

async function captureRoute(browser, route, viewport, theme) {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: theme,
  });
  const page = await context.newPage();
  const url = `${BASE_URL}${route.path}`;
  try {
    const prepared = route.needsUser ? await primeVerifyContext(page, route) : false;

    const response = prepared ? null : await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('[data-od-id="auth-shell"]', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    const filename = `${route.label}-${viewport.label}-${theme}.png`;
    const out = path.join(MEDIA_ROOT, filename);
    await page.screenshot({ path: out, fullPage: true });
    console.log(
      `  ${route.label} @ ${viewport.label} ${theme} -> ${path.relative(process.cwd(), out)} (${response ? response.status() : '?'})`,
    );
  } catch (err) {
    console.warn(`  ${route.label} @ ${viewport.label} ${theme} FAILED: ${err.message}`);
  } finally {
    await context.close();
  }
}

(async () => {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  try {
    for (const viewport of VIEWPORTS) {
      console.log(`\n=== viewport ${viewport.label} (${viewport.width}x${viewport.height}) ===`);
      for (const theme of THEMES) {
        console.log(`-- theme ${theme} --`);
        for (const route of ROUTES) {
          await captureRoute(browser, route, viewport, theme);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log('\nDone.');
})();

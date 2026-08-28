/* eslint-disable */
// Captures the full auth fidelity pass e2e flow on two viewports:
// - iPhone 13 Mini (375x812)
// - HD desktop (1920x1080)
//
// Drives every step through the UI (no page.goto after the cold-start bootstrap)
// with ~1s pauses between actions so each step is visible in the recording.
//
// Full flow:
//   1. Bootstrap: open /app/en/sign-in
//   2. Click "Create an account" -> sign-up
//   3. Fill sign-up form -> click Create account -> verify-email
//   4. Read OTP from mailbox via Test API, type 6 cells, click Verify and continue
//   5. (Skip activation via UI if first-run) -> dashboard
//   6. Open user menu -> click Sign out
//   7. Click "Forgotten password?" -> forgotten-password
//   8. Enter email -> click Send recovery link -> /reset-password (UI nav)
//   9. Read OTP (password_reset purpose) from mailbox, type, click Verify code
//  10. Enter New password + Confirm new password -> click Update password -> success state
//  11. Click "Sign in to continue" -> sign-in
//  12. Enter NEW password -> click Sign in -> verify-device
//  13. Read OTP (sign_in purpose) from mailbox, type, click Verify and continue -> dashboard
const { chromium, devices } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = 'http://localhost:8081';
const MEDIA_ROOT = path.join(process.cwd(), 'media', 'auth-flow-videos');

const VIEWPORTS = [
  {
    label: 'iphone-13-mini',
    dir: path.join(MEDIA_ROOT, 'iphone-13-mini'),
    viewport: { width: 375, height: 812 },
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    deviceScaleFactor: 3,
    finalName: 'auth-flow-iphone-13-mini.webm',
  },
  {
    label: 'hd',
    dir: path.join(MEDIA_ROOT, 'hd-1920x1080'),
    viewport: { width: 1920, height: 1080 },
    isMobile: false,
    finalName: 'auth-flow-hd-1920x1080.webm',
  },
];

const PAUSE_MS = 1000;
const STEP_PAUSE_MS = 150;

function pause(page, ms = PAUSE_MS) {
  return page.waitForTimeout(ms);
}

async function fetchLatestPin(email, purpose) {
  const params = new URLSearchParams({ email, purpose });
  const res = await fetch(`${BASE_URL}/api/test/mailbox/latest?${params.toString()}`);
  if (!res.ok) throw new Error(`mailbox fetch failed: ${res.status}`);
  const body = await res.json();
  return body?.pin ?? null;
}

async function clearMailbox() {
  await fetch(`${BASE_URL}/api/test/mailbox`, { method: 'DELETE' });
}

async function completeActivationViaApi() {
  // Tells the API the user already finished activation so the /app/activation
  // screen is skipped on subsequent logins.
  await fetch(`${BASE_URL}/api/activation/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ complete: true }),
    credentials: 'include',
  });
}

async function typeOtp(page, pin) {
  const cellLocator = page.locator('[data-slot="pin-input"] input');
  const cellCount = await cellLocator.count();
  if (cellCount > 0) {
    for (let i = 0; i < pin.length; i += 1) {
      await cellLocator.nth(i).fill(pin[i]);
      await page.waitForTimeout(STEP_PAUSE_MS);
    }
    return;
  }
  const single = page.getByRole('textbox', { name: 'Verification code' });
  await single.fill(pin);
}

async function runFlow(viewport) {
  fs.mkdirSync(viewport.dir, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: viewport.viewport,
    deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    userAgent: viewport.userAgent,
    recordVideo: { dir: viewport.dir, size: viewport.viewport },
  });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (err) => errors.push(`PAGE ERROR: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`CONSOLE ERROR: ${msg.text()}`);
  });

  const email = `engineer+video-${Date.now()}@themis.visomi.dev`;
  const initialPassword = 'Strong-Pass-12!';
  const newPassword = 'Recovered-Pass-34#';

  try {
    console.log(`\n[${viewport.label}] ========== SIGN UP ==========`);
    await page.goto(`${BASE_URL}/app/en/sign-in`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-od-id="auth-shell"]');
    await pause(page);

    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.waitForURL(/\/app\/en\/sign-up$/);
    await page.waitForSelector('[data-slot="kicker"]');
    await pause(page);

    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await pause(page);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(initialPassword);
    await pause(page);
    await page.getByRole('textbox', { name: 'Confirm password' }).fill(initialPassword);
    await pause(page);

    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/app\/en\/verify-email$/, { timeout: 15000 });
    await page.waitForSelector('[data-od-id="auth-shell"]');
    await pause(page);

    // Wait briefly for the mailbox to receive the OTP.
    let signUpPin = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      signUpPin = await fetchLatestPin(email, 'sign_up');
      if (signUpPin) break;
      await page.waitForTimeout(500);
    }
    if (!signUpPin) throw new Error(`no sign_up pin (URL: ${page.url()})`);
    console.log(`[${viewport.label}] sign_up pin: ${signUpPin}`);
    await typeOtp(page, signUpPin);
    await pause(page);

    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await page.waitForURL(/\/app\/en\/(dashboard|activation)$/);
    await pause(page);

    if (/\/activation$/.test(page.url())) {
      console.log(`[${viewport.label}] first-run activation -> click Skip for now`);
      await page.getByRole('button', { name: /Skip for now/i }).click();
      await page.waitForURL(/\/app\/en\/(dashboard|projects)$/);
      await pause(page);
    }

    await completeActivationViaApi();
    console.log(`[${viewport.label}] post-auth URL: ${page.url()}`);
    await pause(page, 1500);

    console.log(`\n[${viewport.label}] ========== LOG OUT ==========`);
    await page.getByRole('button', { name: 'Open user menu' }).click();
    await pause(page);
    await page.getByRole('option', { name: /Sign out/i }).click();
    await page.waitForURL(/\/app\/en\/sign-in$/);
    await pause(page);

    console.log(`\n[${viewport.label}] ========== FORGOTTEN PASSWORD ==========`);
    await page.getByRole('link', { name: 'Forgotten password?' }).click();
    await page.waitForURL(/\/app\/en\/forgotten-password$/);
    await page.waitForSelector('[data-slot="kicker"]');
    await pause(page);

    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await pause(page);
    await page.getByRole('button', { name: 'Send recovery link' }).click();
    await page.waitForURL(/\/app\/en\/reset-password$/, { timeout: 15000 });
    await page.waitForSelector('[data-slot="kicker"]');
    await pause(page);

    console.log(`\n[${viewport.label}] ========== PASSWORD RECOVERY ==========`);
    let resetPin = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      resetPin = await fetchLatestPin(email, 'password_reset');
      if (resetPin) break;
      await page.waitForTimeout(500);
    }
    if (!resetPin) throw new Error(`no password_reset pin (URL: ${page.url()})`);
    console.log(`[${viewport.label}] reset pin: ${resetPin}`);
    await typeOtp(page, resetPin);
    await pause(page);

    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await page.waitForSelector('[data-slot="title"]');
    // wait for the password step (title stays Reset your password but a new field appears)
    await page.getByRole('textbox', { name: 'New password', exact: true }).waitFor();
    await pause(page);

    await page.getByRole('textbox', { name: 'New password', exact: true }).fill(newPassword);
    await pause(page);
    await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill(newPassword);
    await pause(page);

    await page.getByRole('button', { name: 'Update password' }).click();
    await page.waitForSelector('text=Password updated', { timeout: 15000 });
    await pause(page, 1500);

    console.log(`\n[${viewport.label}] ========== SIGN IN WITH NEW PASSWORD ==========`);
    await page.getByRole('link', { name: 'Sign in to continue' }).click();
    await page.waitForURL(/\/app\/en\/sign-in$/);
    await pause(page);

    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await pause(page);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(newPassword);
    await pause(page);

    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/app\/en\/verify-device$/, { timeout: 15000 });
    await page.waitForSelector('[data-slot="kicker"]');
    await pause(page);

    let signInPin = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      signInPin = await fetchLatestPin(email, 'sign_in');
      if (signInPin) break;
      await page.waitForTimeout(500);
    }
    if (!signInPin) throw new Error(`no sign_in pin (URL: ${page.url()})`);
    console.log(`[${viewport.label}] sign_in pin: ${signInPin}`);
    await typeOtp(page, signInPin);
    await pause(page);

    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await page.waitForURL(/\/app\/en\/(dashboard|activation)$/, { timeout: 15000 });
    if (/\/activation$/.test(page.url())) {
      await page.getByRole('button', { name: /Skip for now/i }).click();
      await page.waitForURL(/\/app\/en\/(dashboard|projects)$/);
    }
    await pause(page, 1500);

    console.log(`[${viewport.label}] final URL: ${page.url()}`);

    if (errors.length) {
      console.warn(`[${viewport.label}] captured ${errors.length} runtime errors:`);
      for (const err of errors.slice(0, 5)) console.warn(`  - ${err}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

async function renameRecording(viewport) {
  const files = fs.readdirSync(viewport.dir).filter((f) => f.endsWith('.webm'));
  if (files.length === 0) {
    console.warn(`[${viewport.label}] no webm found in ${viewport.dir}`);
    return;
  }
  const latest = files
    .map((f) => ({ f, mtime: fs.statSync(path.join(viewport.dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].f;
  const finalPath = path.join(viewport.dir, viewport.finalName);
  fs.renameSync(path.join(viewport.dir, latest), finalPath);
  console.log(`[${viewport.label}] saved -> ${path.relative(process.cwd(), finalPath)}`);
}

(async () => {
  await clearMailbox();
  console.log('mailbox cleared');

  for (const viewport of VIEWPORTS) {
    console.log(`\n========== ${viewport.label} ==========`);
    try {
      await runFlow(viewport);
      await renameRecording(viewport);
    } catch (err) {
      console.error(`[${viewport.label}] FAILED:`, err.message);
      console.error(err.stack);
      process.exitCode = 1;
    }
  }
})();

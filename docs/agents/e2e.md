# End-To-End Testing Guidance

These instructions apply to Playwright and route-flow tests, especially auth and app-shell flows.

## Organization

- Organize Playwright specs by route and feature area, not as one monolithic auth flow file.
- Put shared helpers under `src/support/` for mailbox access, OTP filling, route constants, and auth helpers.
- Keep test names and helper names in English.
- Prefer one scenario group per PR when the helper infrastructure already exists.

## Selectors And Assertions

- Prefer `getByRole`, `getByLabel`, and visible heading assertions over brittle CSS selectors or test IDs.
- Use stable accessible names for buttons, links, fields, and headings.
- Avoid assertions that depend on implementation-only DOM structure.
- Keep route-level auth forms accessible with explicit labels and straightforward heading text.

## Auth Route Coverage

Auth changes should keep the route suite green for:

- `/app/sign-in`
- `/app/sign-up`
- `/app/verify-email`
- `/app/`
- theme behavior across auth and app routes

## Workflow

- Separate enabling Playwright utilities from new product behavior when practical.
- Add or update route-specific specs with the feature slice they verify.
- Avoid combining every auth scenario into one PR unless it is initial infrastructure work.
- Prefer deterministic helpers for OTP, mailbox, session, and route setup.
- When debugging flakiness, isolate the failing route spec before broad suite runs.

## Verification

- Run E2E through Nx targets, not Playwright directly, unless there is no target for the scenario.
- Prefer focused route or project verification before broad e2e runs.
- If an E2E run is too expensive for the current turn, report the exact Nx command to run later and explain why it was skipped.

## Full-Server E2E Playbook

These tests boot the real gateway (api + app + site + worker + realtime) and need Redis for the worker's BullMQ queues. They are gated by the pre-commit hook (`pnpm exec nx affected -t e2e`); understand the boot path before you try to skip the hook.

### Local environment prerequisites

- **Playwright browsers installed.** The hook fails fast with "Executable doesn't exist at chrome-headless-shell" if the OS image has never been used. Install once per checkout:
  ```bash
  pnpm exec playwright install chromium
  ```
- **Ports `8080` and `8081` free.** The gateway listens on `8081`; the worker process spawned by the gateway binds `8080`. Stale `dist/apps/web/server/main.js` and `dist/apps/worker/main.js` processes from a previous run block the next run. Before re-running, kill them:
  ```bash
  ps aux | grep "dist/apps" | grep -v grep | awk '{print $2}' | xargs -r kill -9
  ```
- **Redis reachable at `redis://127.0.0.1:6379`.** `libs/shared/src/lib/env.ts` defaults `REDIS_URL` to that address. Without Redis the worker exits and the gateway shuts down. For local runs, a sidecar is enough:
  ```bash
  podman run -d --name themis-redis docker.io/library/redis:7-alpine
  ```
  If you ran the hook before, leftover worker processes are usually the visible symptom; the root cause is the missing Redis.

### Reproducing a single e2e project outside the hook

When iterating on a failing spec, run the same boot path the hook uses, but in a controlled terminal so you can attach probes and read logs.

1. Build the runtime bundle the e2e webServer depends on:
   ```bash
   pnpm nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production
   ```
2. Boot the gateway with the same env vars `apps/web/app-e2e/playwright.config.ts` injects:
   ```bash
   node dist/apps/web/server/main.js
   # env (same as the webServer block):
   #   DATABASE_AUTO_MIGRATE=true DATABASE_DRIVER=memory
   #   MAIL_TRANSPORT=memory ENABLE_TEST_API=true
   #   HOST=127.0.0.1 NG_ALLOWED_HOSTS=127.0.0.1
   #   PORT=8081 SESSION_SECRET=themis-app-e2e-secret
   ```
3. Run only the project you care about:
   ```bash
   pnpm nx e2e app-e2e --skip-nx-cache
   # For just one file, target it via the per-file nx targets, e.g.
   #   pnpm nx e2e-ci--src/app/activation.spec.ts
   ```

The hook's lint/test/e2e pipeline runs in this order, so a unit-test failure short-circuits the e2e step. Fix unit tests first if both are red.

### Test API for short-circuiting the UI

`ENABLE_TEST_API=true` exposes the helpers in `apps/web/api/src/test/` so a probe can drive the flow without a browser:

| Verb + path                                                       | Purpose                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `DELETE /api/test/mailbox`                                        | Wipe the in-memory mailbox before a flow.                        |
| `GET /api/test/mailbox/latest?email=...&purpose=sign_up\|sign_in` | Read the latest OTP for an email.                                |
| `POST /api/auth/sign-up` `{ email, password }`                    | Create an unverified account.                                    |
| `POST /api/auth/sign-up/verify` `{ code }`                        | Verify the sign-up OTP.                                          |
| `POST /api/auth/sign-in/password` `{ email, password }`           | Start the sign-in flow.                                          |
| `POST /api/auth/sign-in/verify` `{ code }`                        | Verify the sign-in OTP.                                          |
| `POST /api/activation/complete` `{ complete: true }`              | Skip the activation page in tests that need a logged-in session. |

Use these from Playwright's `request` fixture or from a probe script so you do not depend on UI selectors that are still in flux.

### Probing a single page with Playwright

When a test fails on a `getByRole` / `getByLabel` selector, the fastest feedback loop is a one-off script that loads the real HTML and prints the accessibility tree. Drop a `probe-*.cjs` next to the e2e project (delete before committing):

```js
// apps/web/app-e2e/probe.cjs
const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

(async () => {
  const server = spawn('node', ['dist/apps/web/server/main.js'], {
    cwd: '/home/<you>/Projects/GitHub/visomi-dev/themis',
    env: {
      ...process.env,
      DATABASE_AUTO_MIGRATE: 'true',
      DATABASE_DRIVER: 'memory',
      MAIL_TRANSPORT: 'memory',
      ENABLE_TEST_API: 'true',
      HOST: '127.0.0.1',
      NG_ALLOWED_HOSTS: '127.0.0.1',
      PORT: '8081',
      SESSION_SECRET: 'themis-app-e2e-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await sleep(6000);
  const browser = await chromium.launch();
  const page = await browser.newContext({ baseURL: 'http://127.0.0.1:8081' }).then((c) => c.newPage());
  await page.goto('http://127.0.0.1:8081/app/en/sign-in', { waitUntil: 'networkidle' });
  console.log(await page.$$eval('h1, h2', (els) => els.map((e) => `${e.tagName}: "${e.textContent?.trim()}"`)));
  await browser.close();
  server.kill('SIGTERM');
})();
```

Run with `node apps/web/app-e2e/probe.cjs`. The chromium binary it depends on is the same one Playwright uses, so the previous `playwright install chromium` step covers it.

### Common gotchas observed in this repo

- **Angular SSR rejects unknown `Host` headers.** `apps/web/app/project.json` whitelists `themis.visomie.dev` and `localhost`. When curling, set `-H "Host: localhost"`. Curl on `127.0.0.1` returns 400 with `Header "host" with value "127.0.0.1:8081" is not allowed` because the gateway rewrites the port-less host. The Astro site has no such check.
- **Component content projection in SSR.** `i18n` on a component host (e.g. `<app-heading i18n="@@x">Text</app-heading>`) strips the projected text in SSR, so `getByRole('heading', { name: 'Text' })` fails. Pass the text via a required `[text]` input instead and update every caller. The same fix applied to `app-link`, `app-link-button`, and any custom component that wraps user-visible text.
- **Duplicate DOM ids break label association.** `<app-input id="x">` puts `id="x"` on both the host and the inner `<input>`. Browsers stop matching `<label for="x">` to either input. Rename the input to `controlId` (and similar) and pass it via `[controlId]`.
- **`pattern` triggers Angular's `PatternValidator`.** `[pattern][formControlName]` is a real selector, so `pattern="[0-9]{1}"` on `<app-pin-input formControlName="pin">` makes the form reject multi-digit values. Rename the input to `digitPattern`.
- **Nested buttons swallow clicks.** A CDK overlay trigger wrapped in another `<button>` does not propagate click events. Use a `<span role="presentation">` wrapper and delegate clicks to the projected trigger manually.
- **`role="alert"` vs `role="status"`.** Tests use `getByRole('alert')`. The in-house `app-alert` defaults to `role="status"`; switch to `role="alert"` for `danger` tone so the error is exposed as a live region.
- **Toggle button aria-labels collide with field labels.** A button labeled "Show password" matches `getByLabel('Password')`. Use neutral copy like "Show characters" / "Hide characters" so the field is the only match.
- **commitlint body line limit is 240 chars.** Break long explanations across multiple `-m` flags or wrap prose manually before committing.

### When a test is genuinely hard to run

Do not "fix" the hook by skipping it. If the run is too expensive for the current turn, the right move is:

1. Note the failing spec by file and line.
2. Provide the exact `pnpm nx e2e <project>` (or per-file target) command for the next agent.
3. Leave the worktree clean so the next agent can re-run hooks from a known-good state.

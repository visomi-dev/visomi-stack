---
name: ui-screenshots
description: Capture and inspect web UI states with the repository's existing Node.js Playwright tooling. Use for authorized before/after evidence and visual review, without changing source history or installing another screenshot stack.
---

# UI Screenshots

Capture the agreed application, route, viewport, and interaction state using existing Playwright fixtures and configured Nx targets. A screenshot is evidence of a rendered state, not proof of accessibility, correctness, or product-owner approval.

## Scope and prerequisites

- Inspect the existing Playwright configuration, package manager, app target, and synthetic fixtures first.
- Reuse installed Node.js tooling; do not install Python, Pillow, global packages, browsers, or a separate test framework implicitly.
- If required tooling or a test server is unavailable, report the blocker and propose the smallest setup step.
- Use synthetic data. Do not capture real customer records, credentials, recovery keys, or unrelated desktop content.
- Capturing evidence does not authorize source edits, baseline updates, uploads, deployment, or desktop access.

## Capture workflow

1. Choose representative real viewport dimensions, not an artificially tall viewport intended to render everything at once.
2. Navigate through the existing test fixture and wait for observable readiness: a heading, loaded data, resolved loading state, or a chart's documented ready signal.
3. Use Playwright's auto-retrying assertions. Do not treat `networkidle` or a fixed sleep as proof that a page or chart is ready.
4. Wait for fonts/images or chart readiness where the selected screen requires them. Freeze dates, randomness, and animation through existing test fixtures where necessary.
5. Capture the viewport, full page, or a specific locator, depending on the evidence needed.
6. Inspect the actual image and record the route, viewport, theme, locale, fixture, and relevant limitations.

### Example using an existing Node.js test suite

Adapt names and paths to the real project; do not create a parallel configuration merely to use this example.

```ts
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('capture the agreed screen', async ({ page }) => {
  // baseURL and synthetic authentication/data come from the existing configuration.
  await page.goto('/example');
  await expect(page.getByRole('heading', { name: 'Example', level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  // Add screen-specific ready assertions when it includes async data or charts.
  await page.screenshot({
    path: 'test-results/example-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});
```

For a particular region, use the existing locator's `screenshot()` method after checking visibility. A crop may help explain a finding, but retain the original evidence and identify the crop; it does not replace verification at the intended viewport.

## Before/after comparisons

- Capture the before state before authorized edits whenever possible.
- Use the same viewport, device scale, route, theme, locale, synthetic data, and interaction state for both images.
- Never overwrite the working tree or index to recreate a before image. Do not use checkout/reset/revert commands on the user's files as a screenshot shortcut.
- If the before image is unavailable, say so. A separately authorized isolated checkout of a confirmed base revision is an option; the previous commit is not automatically the correct base.
- Preserve uncommitted work and existing baselines. Updating a baseline requires inspecting and accepting the visual change, not merely making a test pass.

## Interactive and responsive states

- Cover relevant normal, focus, hover, expanded, disabled, loading, empty, and error states.
- Assert the requested state before capturing it; avoid arbitrary sleeps after hover/click.
- Include keyboard and touch-relevant behavior and the product's agreed viewport sizes.
- Keep screenshot failures, interaction failures, and untested states distinct in the report.

## Artifacts and delivery

Keep screenshots and traces in the repository's configured local artifact paths. Check them for sensitive content before sharing. Do not upload artifacts or enable a remote reporter unless explicitly authorized. For non-web or desktop capture, use a separately approved workflow rather than extending this skill's scope.

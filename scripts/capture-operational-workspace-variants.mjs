import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4300';
const outputRoot = process.env.OUTPUT_ROOT ?? join(process.cwd(), 'media/operational-workspace-variants');
const manifestPath = join(
  process.cwd(),
  'docs/architecture/system/operational-workspace-visual-coverage-manifest.json',
);

const viewports = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};
const themes = ['light', 'dark'];
const surfaces = [
  { id: 'project-workspace', selector: '[data-surface="project-workspace"]' },
  { id: 'work-item-detail', selector: '[data-surface="work-item-detail"]' },
  { id: 'validation-evidence', selector: '[data-surface="work-item-detail"] [aria-labelledby="validation-title"]' },
  { id: 'timeline', selector: '[data-surface="timeline"]' },
];
const states = [
  'loading',
  'empty',
  'attention',
  'blocked',
  'active-execution',
  'evidence-missing',
  'evidence-present',
  'review-pending',
  'accepted',
  'rejected',
  'rework',
  'locked',
  'unavailable',
  'stale',
  'error',
];

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const variants = [];

try {
  for (const [viewportId, viewport] of Object.entries(viewports)) {
    for (const theme of themes) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: theme });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/preview/operational-workspace/frame?theme=${theme}&state=review-pending`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.waitForTimeout(250);

      for (const surface of surfaces) {
        const locator = page.locator(surface.selector);
        await locator.waitFor({ state: 'visible' });
        for (const state of states) {
          await page.goto(`${baseUrl}/preview/operational-workspace/frame?theme=${theme}&state=${state}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          });
          await page.waitForTimeout(50);
          const filename = `${surface.id}-${state}-${viewportId}-${theme}.png`;
          const outputPath = join(outputRoot, filename);
          const screenshot = await locator.screenshot({ path: outputPath, animations: 'disabled' });
          const renderedContent = await locator.innerText();
          variants.push({
            surface: surface.id,
            state,
            viewport: viewportId,
            theme,
            screenshot: relative(process.cwd(), outputPath),
            renderedContentHash: createHash('sha256').update(renderedContent).digest('hex'),
            screenshotSha256: createHash('sha256').update(screenshot).digest('hex'),
          });
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const contentGroups = new Map();
for (const variant of variants) {
  const key = `${variant.surface}:${variant.viewport}:${variant.theme}`;
  const group = contentGroups.get(key) ?? new Set();
  group.add(variant.renderedContentHash);
  contentGroups.set(key, group);
}
for (const [key, hashes] of contentGroups) {
  if (hashes.size !== states.length) {
    throw new Error(
      `Rendered-content distinction failed for ${key}: ${hashes.size}/${states.length} unique state hashes`,
    );
  }
}

const manifest = {
  schemaVersion: 1,
  prototype: 'operational-workspace',
  captureCommand: 'pnpm exec node scripts/capture-operational-workspace-variants.mjs',
  dimensions: Object.fromEntries(Object.entries(viewports).map(([id, value]) => [id, value])),
  themes,
  surfaces: surfaces.map(({ id }) => id),
  states,
  variantCount: variants.length,
  renderedContentDistinct: true,
  distinctionAssertion: `Each surface/viewport/theme group has ${states.length} unique rendered-content hashes, one per state.`,
  variants,
};

if (process.env.WRITE_MANIFEST !== 'false') {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
console.log(`Captured ${variants.length} variants.`);
console.log(`Manifest: ${relative(process.cwd(), manifestPath)}`);

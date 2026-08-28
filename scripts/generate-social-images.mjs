import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const tmpDir = resolve(rootDir, 'tmp', 'og-images');

const SOCIAL_IMAGE_WIDTH = 1200;
const SOCIAL_IMAGE_HEIGHT = 630;

const locales = ['en', 'es'];
const pages = ['home'];

const chromiumPathCandidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable'];

const findChromium = async () => {
  for (const candidate of chromiumPathCandidates) {
    try {
      const { access } = await import('node:fs/promises');
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('Chromium not found');
};

const generateImages = async () => {
  const executablePath = process.env['PUPPETEER_EXECUTABLE_PATH'] || (await findChromium());
  console.log(`[ generate ] using Chromium at ${executablePath}`);

  const browser = await puppeteer.launch({
    executablePath,
    args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
    headless: true,
  });

  try {
    let count = 0;
    for (const locale of locales) {
      for (const page of pages) {
        const previewDir = resolve(rootDir, 'apps', 'web', 'site', 'public', 'social-image-previews', locale);
        const previewPath = resolve(previewDir, `${page}.html`);
        const html = await readFile(previewPath, 'utf8');
        const outDir = resolve(tmpDir, locale);
        const outPath = resolve(outDir, `${page}.png`);
        const publicDir = resolve(rootDir, 'apps', 'web', 'site', 'public', 'images', 'seo', locale);
        const publicPath = resolve(publicDir, `${page}.png`);

        await mkdir(outDir, { recursive: true });
        await mkdir(publicDir, { recursive: true });

        const page2 = await browser.newPage();
        try {
          await page2.setViewport({ deviceScaleFactor: 1, width: SOCIAL_IMAGE_WIDTH, height: SOCIAL_IMAGE_HEIGHT });
          await page2.setContent(html, { waitUntil: 'networkidle0' });
          await page2.screenshot({ path: outPath, type: 'png' });
        } finally {
          await page2.close();
        }

        await copyFile(outPath, publicPath);
        count++;
        console.log(`[ generate ] ${locale}/${page} -> ${publicPath}`);
      }
    }
    console.log(`[ generate ] done — ${count} images generated`);
  } finally {
    await browser.close();
  }
};

generateImages().catch((err) => {
  console.error('[ generate ] failed:', err);
  process.exit(1);
});

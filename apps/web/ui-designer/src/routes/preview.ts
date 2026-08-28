import { Router } from 'express';

import { loadPrototype } from './index';

export function previewRouter(): Router {
  const router = Router();

  router.get('/preview/:slug', async (req, res) => {
    const slug = String(req.params['slug'] ?? '');

    const prototypeHtml = await loadPrototype(slug);

    if (!prototypeHtml) {
      res.status(404).send(`Prototype "${slug}" not found.`);

      return;
    }

    const viewport = String(req.query['viewport'] ?? 'desktop');

    if (viewport !== 'mobile' && viewport !== 'tablet' && viewport !== 'desktop') {
      res.status(400).send(`Invalid viewport "${viewport}". Use mobile, tablet, or desktop.`);

      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderChrome(slug, viewport));
  });

  router.get('/preview/:slug/frame', async (req, res) => {
    const slug = String(req.params['slug'] ?? '');

    const prototypeHtml = await loadPrototype(slug);

    if (!prototypeHtml) {
      res.status(404).send(`Prototype "${slug}" not found.`);

      return;
    }

    const theme = String(req.query['theme'] ?? 'light') === 'dark' ? 'dark' : 'light';
    const state = String(req.query['state'] ?? 'review-pending').replace(/[^a-z-]/g, '');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      prototypeHtml.replace('<html', `<html class="${theme}"`).replace('<body', `<body data-preview-state="${state}"`),
    );
  });

  return router;
}

function renderChrome(slug: string, initialViewport: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${slug} — Preview</title>
  <link rel="stylesheet" href="/public/tailwind.css" />
</head>
<body class="bg-bg text-fg">
  <header class="border-border-subtle bg-panel border-b px-4 py-2">
    <div class="mx-auto flex max-w-screen-2xl items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <a class="text-fg hover:text-accent font-mono text-xs no-underline" href="/">← Index</a>
        <span class="text-muted-fg font-mono text-xs">${slug}</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="border-border-subtle flex items-center gap-1 rounded-md border p-1" role="group" aria-label="Viewport">
          <button type="button" data-viewport="mobile" class="viewport-btn rounded-sm px-2 py-1 text-xs font-medium">Mobile</button>
          <button type="button" data-viewport="tablet" class="viewport-btn rounded-sm px-2 py-1 text-xs font-medium">Tablet</button>
          <button type="button" data-viewport="desktop" class="viewport-btn rounded-sm px-2 py-1 text-xs font-medium">Desktop</button>
        </div>
        <button type="button" id="theme-toggle" class="border-border-subtle rounded-md border px-3 py-1 text-xs font-medium">
          <span data-theme-label="light">Light</span>
          <span data-theme-label="dark" hidden>Dark</span>
        </button>
      </div>
    </div>
  </header>
  <main class="preview-frame">
    <iframe id="preview-iframe" data-viewport="${initialViewport}" title="${slug} preview" src="/preview/${slug}/frame?theme=light"></iframe>
  </main>
  <script type="module">${chromeScript(slug, initialViewport)}</script>
</body>
</html>`;
}

function chromeScript(slug: string, initialViewport: string): string {
  return `
    const iframe = document.getElementById('preview-iframe');
    const themeButton = document.getElementById('theme-toggle');
    const viewportButtons = document.querySelectorAll('[data-viewport]');

    const setTheme = (theme) => {
      iframe.src = '/preview/${slug}/frame?theme=' + theme;
      themeButton.querySelector('[data-theme-label="light"]').hidden = theme === 'dark';
      themeButton.querySelector('[data-theme-label="dark"]').hidden = theme !== 'dark';
    };

    const setViewport = (viewport) => {
      const url = new URL(window.location.href);
      url.searchParams.set('viewport', viewport);
      window.location.search = url.searchParams.toString();
    };

    themeButton.addEventListener('click', () => {
      const current = new URL(iframe.src).searchParams.get('theme') ?? 'light';
      setTheme(current === 'dark' ? 'light' : 'dark');
    });

    viewportButtons.forEach((button) => {
      if (button.dataset.viewport === '${initialViewport}') {
        button.dataset.active = 'true';
      }
      button.addEventListener('click', () => setViewport(button.dataset.viewport));
    });
  `;
}

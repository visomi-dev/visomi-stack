import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Router } from 'express';

const prototypesSourceDir = join(process.cwd(), 'apps/web/ui-designer/src/prototypes');

const publicDir = join(process.cwd(), 'dist/apps/web/ui-designer/public');

const prototypesPublicDir = join(publicDir, 'prototypes');

type PrototypeSummary = {
  slug: string;
  title: string;
};

export async function ensurePrototypesSynced(): Promise<void> {
  await mkdir(prototypesPublicDir, { recursive: true });

  const entries = await readdir(prototypesSourceDir).catch(() => [] as string[]);

  await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.html'))
      .map(async (entry) => {
        await copyFile(join(prototypesSourceDir, entry), join(prototypesPublicDir, entry));
      }),
  );
}

export async function listPrototypes(): Promise<PrototypeSummary[]> {
  await ensurePrototypesSynced();

  const entries = await readdir(prototypesPublicDir).catch(() => [] as string[]);

  return entries
    .filter((entry) => entry.endsWith('.html'))
    .map((file) => {
      const slug = file.replace(/\.html$/, '');

      return {
        slug,
        title: slug
          .split('-')
          .map((word) => (word ? word[0]?.toUpperCase() + word.slice(1) : ''))
          .join(' '),
      };
    });
}

export async function loadPrototype(slug: string): Promise<string | undefined> {
  if (!isSafeSlug(slug)) {
    return undefined;
  }

  await ensurePrototypesSynced();

  try {
    return await readFile(join(prototypesPublicDir, `${slug}.html`), 'utf8');
  } catch {
    return undefined;
  }
}

function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function indexRouter(): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const prototypes = await listPrototypes();

    const cards = prototypes
      .map(
        (p) => `
        <li class="border-border-subtle bg-panel rounded-md border p-4">
          <a class="text-fg hover:text-accent block font-medium no-underline" href="/preview/${p.slug}">${p.title}</a>
          <p class="text-muted-fg mt-1 text-xs font-mono">${p.slug}</p>
        </li>`,
      )
      .join('');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Themis UI Designer</title>
  <link rel="stylesheet" href="/public/tailwind.css" />
</head>
<body class="bg-bg text-fg min-h-screen">
  <header class="border-border-subtle border-b px-4 py-4 md:px-8">
    <h1 class="font-heading text-lg font-bold tracking-tight">Themis UI Designer</h1>
    <p class="text-muted-fg text-sm">Pick a prototype to preview.</p>
  </header>
  <main class="mx-auto w-full max-w-2xl px-4 py-8 md:py-12">
    <ul class="grid gap-3">
      ${cards || '<li class="text-muted-fg text-sm">No prototypes yet. Add an HTML file under apps/web/ui-designer/src/prototypes/.</li>'}
    </ul>
  </main>
</body>
</html>`);
  });

  return router;
}

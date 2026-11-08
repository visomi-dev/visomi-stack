import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const loadingPrefix = '/__dev/live-reload';

// Compile once in a short-lived process so Tailwind does not stay in the supervisor's heap.
export async function createLoadingPage() {
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url)], {
    maxBuffer: 1024 * 1024,
  });

  return JSON.parse(stdout);
}

async function compile() {
  const [{ default: postcss }, { default: tailwind }, { container, card }, { heading, text }] = await Promise.all([
    import('postcss'),
    import('@tailwindcss/postcss'),
    import(new URL('../../libs/web/frontend/ui/src/lib/layout.ts', import.meta.url)),
    import(new URL('../../libs/web/frontend/ui/src/lib/typography.ts', import.meta.url)),
  ]);
  const template = await readFile(new URL('./loading-page.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('./loading-page.css', import.meta.url), 'utf8');
  const classes = {
    container: container.classes({ width: 'sm', gutter: 'compact' }),
    card: card.classes({ padding: 'lg' }),
    heading: heading.classes(),
    label: text.classes({ size: 'xs', tone: 'accent', weight: 'semibold', mono: true }),
    body: text.classes({ tone: 'muted' }),
    status: text.classes({ size: 'sm', tone: 'muted' }),
    footer: text.classes({ size: 'xs', tone: 'subtle' }),
  };
  const messages = {
    en: {
      title: 'Getting your workspace ready',
      environment: 'Development preview',
      description: 'The gateway is building your latest changes.',
      refresh: 'This page refreshes automatically when ready.',
      terminal: 'Build details and any errors appear in your terminal.',
      noScript: 'JavaScript is disabled. Refresh this page once the build finishes.',
    },
    es: {
      title: 'Preparando tu espacio de trabajo',
      environment: 'Vista de desarrollo',
      description: 'El gateway está compilando tus últimos cambios.',
      refresh: 'Esta página se actualizará automáticamente cuando esté lista.',
      terminal: 'Los detalles de compilación y los errores aparecen en tu terminal.',
      noScript: 'JavaScript está desactivado. Actualiza la página cuando termine la compilación.',
    },
  };
  const pages = Object.fromEntries(
    Object.entries(messages).map(([locale, copy]) => {
      const values = { ...classes, ...copy, locale };

      return [locale, template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => values[key])];
    }),
  );
  const candidates = [...pages.en.matchAll(/class="([^"]+)"/g)].map((match) => match[1]).join(' ');
  const result = await postcss([tailwind({ optimize: true })]).process(
    `${source}\n@source inline(${JSON.stringify(candidates)});`,
    { from: fileURLToPath(new URL('./loading-page.css', import.meta.url)) },
  );
  const fonts = {};
  const css = result.css.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (_, _quote, url) => {
    const name = basename(url);
    const family = /^(inter|manrope|jetbrains-mono)-latin-\d+-normal\.woff2?$/.exec(name)?.[1];

    if (!family) {
      throw new Error('development_font_invalid');
    }

    fonts[`${loadingPrefix}/fonts/${name}`] = fileURLToPath(import.meta.resolve(`@fontsource/${family}/files/${name}`));

    return `url("${loadingPrefix}/fonts/${name}")`;
  });

  return { pages, css, fonts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const assets = await compile();

  process.stdout.write(JSON.stringify(assets));
}

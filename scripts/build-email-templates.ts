import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import mjml2html from 'mjml';
import { format, resolveConfig } from 'prettier';

const root = resolve('libs/backend/shared/src/lib/mail');
const names = ['verification', 'recovery-notice', 'email-change-notice'];
const layout = await readFile(resolve(root, 'templates/layout.mjml'), 'utf8');
const templates: Record<string, string> = {};

for (const name of names) {
  const content = await readFile(resolve(root, `templates/${name}.mjml`), 'utf8');
  const output = await mjml2html(layout.replace('{{{content}}}', content), {
    validationLevel: 'strict',
    fonts: {},
    ignoreIncludes: true,
  });

  templates[name] = output.html;
}

const english = JSON.parse(await readFile(resolve(root, 'copy.en.json'), 'utf8')) as unknown;
const spanish = JSON.parse(await readFile(resolve(root, 'copy.es.json'), 'utf8')) as unknown;
const filePath = resolve(root, 'generated/email-resources.ts');
const resources =
  '// Generated email resources. Regenerate with pnpm nx run shared:emails-build.\n' +
  `export const englishMailCopy = ${JSON.stringify(english, null, 2)} as const;\n\n` +
  `export const spanishMailCopy = ${JSON.stringify(spanish, null, 2)} as const;\n\n` +
  `export const emailTemplates = ${JSON.stringify(templates, null, 2)} as const;\n`;

await mkdir(resolve(root, 'generated'), { recursive: true });
await writeFile(filePath, await format(resources, { ...(await resolveConfig(filePath)), filepath: filePath }));

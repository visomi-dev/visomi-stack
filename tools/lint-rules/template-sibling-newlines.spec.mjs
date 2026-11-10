import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { templateParser } from 'angular-eslint';
import * as astroParser from 'astro-eslint-parser';
import { ESLint, Linter } from 'eslint';
import * as prettier from 'prettier';

import rule from './template-sibling-newlines.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ruleId = 'workspace/template-sibling-newlines';
const linter = new Linter();

function configuration(parser) {
  return [
    {
      files: ['**/*.html', '**/*.astro'],
      languageOptions: { parser },
      plugins: { workspace: { rules: { 'template-sibling-newlines': rule } } },
      rules: { [ruleId]: 'error' },
    },
  ];
}

for (const syntax of ['html', 'angular', 'astro']) {
  const filename = 'example.' + (syntax === 'astro' ? 'astro' : 'html');
  const config = configuration(syntax === 'astro' ? astroParser : templateParser);

  test(`${syntax}: separates nested and root siblings without padding parents`, () => {
    for (const source of ['<a></a>\n<div></div>\n<p></p>\n', '<main>\n<a></a>\n<div></div>\n<p></p>\n</main>\n']) {
      const expected = source.replace('</a>\n', '</a>\n\n').replace('</div>\n', '</div>\n\n');
      const fixed = linter.verifyAndFix(source, config, { filename });

      assert.equal(fixed.output, expected);
      assert.deepEqual(fixed.messages, []);
      assert.equal(linter.verifyAndFix(fixed.output, config, { filename }).fixed, false);
    }
  });

  test(`${syntax}: preserves inline text, comments and literal content`, () => {
    for (const source of [
      '<p><strong>Hello</strong><em>world</em></p>\n',
      '<p><strong>Hello</strong> and\n<em>world</em></p>\n',
      '<a></a>\n<!-- This comment belongs to the following block. -->\n<div></div>\n',
      ...['pre', 'code', 'textarea'].map((tag) => `<${tag}>\n<a></a>\n<div></div>\n</${tag}>\n`),
      '<script>\nconst markup = `<a></a>\n<div></div>`;\n</script>\n',
      '<style>\na {}\ndiv {}\n</style>\n',
      '<pre><section>\n<a></a>\n<div></div>\n</section></pre>\n',
    ]) {
      const result = linter.verifyAndFix(source, config, { filename });

      assert.equal(result.output, source);
      assert.deepEqual(result.messages, []);
    }
  });

  test(`${syntax}: preserves CRLF and existing blank lines`, () => {
    const source = '<a></a>\r\n<div></div>\r\n\r\n<p></p>\r\n';
    const result = linter.verifyAndFix(source, config, { filename });

    assert.equal(result.output, '<a></a>\r\n\r\n<div></div>\r\n\r\n<p></p>\r\n');
    assert.deepEqual(result.messages, []);
  });

  test(`${syntax}: remains stable through the actual Prettier and ESLint pipeline`, async () => {
    const resolved = await prettier.resolveConfig(resolve(root, filename));
    const options = { ...resolved, parser: syntax };
    const source = '<main>\n<a></a>\n<div></div>\n<p></p>\n</main>\n';
    const formatted = await prettier.format(source, options);
    const fixed = linter.verifyAndFix(formatted, config, { filename });
    const reformatted = await prettier.format(fixed.output, options);

    assert.equal(reformatted, fixed.output);
    assert.deepEqual(linter.verify(reformatted, config, { filename }), []);
  });
}

test('Angular: separates siblings within and around control flow without splitting continuations', () => {
  const config = configuration(templateParser);
  const filename = 'example.html';

  for (const block of [
    '@if (ready) {\n<a></a>\n<div></div>\n} @else {\n<a></a>\n<div></div>\n}',
    '@for (item of items; track item) {\n<a></a>\n<div></div>\n} @empty {\n<a></a>\n<div></div>\n}',
    '@switch (value) { @case (1) {\n<a></a>\n<div></div>\n} @default {\n<a></a>\n<div></div>\n} }',
    '@defer {\n<a></a>\n<div></div>\n} @placeholder {\n<a></a>\n<div></div>\n} @loading {\n<a></a>\n<div></div>\n} @error {\n<a></a>\n<div></div>\n}',
  ]) {
    const source = `<header></header>\n${block}\n<footer></footer>\n`;
    const expected = source
      .replaceAll('</a>\n', '</a>\n\n')
      .replace('</header>\n', '</header>\n\n')
      .replace('\n<footer>', '\n\n<footer>');
    const fixed = linter.verifyAndFix(source, config, { filename });

    assert.equal(fixed.output, expected);
    assert.deepEqual(fixed.messages, []);
  }
});

test('Astro: separates expressions and JSX fragments as siblings', () => {
  const source = '<main>\n<a />\n{items.map(item => <span>{item}</span>)}\n<>\n<a />\n<div />\n</>\n</main>\n';
  const expected = '<main>\n<a />\n\n{items.map(item => <span>{item}</span>)}\n\n<>\n<a />\n\n<div />\n</>\n</main>\n';
  const result = linter.verifyAndFix(source, configuration(astroParser), { filename: 'example.astro' });

  assert.equal(result.output, expected);
  assert.deepEqual(result.messages, []);
});

test('Angular: handles ng-template and structural directive wrappers', () => {
  const source =
    '<main>\n<ng-template>\n<a></a>\n<div></div>\n</ng-template>\n<section *ngIf="ready">\n<a></a>\n<div></div>\n</section>\n</main>\n';
  const expected = source.replaceAll('</a>\n', '</a>\n\n').replace('</ng-template>\n', '</ng-template>\n\n');
  const result = linter.verifyAndFix(source, configuration(templateParser), { filename: 'example.html' });

  assert.equal(result.output, expected);
  assert.deepEqual(result.messages, []);
});

test('Astro: keeps comment-only expressions attached to nearby elements', () => {
  const source = '<main>\n<a></a>\n{/* Document the following div. */}\n<div></div>\n</main>\n';
  const result = linter.verifyAndFix(source, configuration(astroParser), { filename: 'example.astro' });

  assert.equal(result.output, source);
  assert.deepEqual(result.messages, []);
});

test('editor and CLI configurations classify toSignal as state before computed properties', async () => {
  const filename = resolve(root, 'apps/web/app/src/app/shared/navigation.ts');
  const source = await readFile(filename, 'utf8');
  const sortingRule = 'perfectionist/sort-classes';

  for (const cwd of [root, resolve(root, 'apps/web/app')]) {
    const eslint = new ESLint({ cwd });
    const config = await eslint.calculateConfigForFile(filename);
    const isolated = [
      {
        languageOptions: config.languageOptions,
        plugins: config.plugins,
        rules: { [sortingRule]: config.rules[sortingRule] },
      },
    ];
    const valid = linter.verify(source, isolated);
    const invalid = linter.verify(
      'class Example {\nreadonly value = computed(() => 0);\nprivate readonly state = toSignal(events);\n}',
      isolated,
    );

    assert.deepEqual(valid, []);
    assert.ok(invalid.some((message) => message.ruleId === sortingRule));
  }
});

test('actual root and project configs enforce the same template rule', async () => {
  for (const [path, directory] of [
    ['tools/development/fixture.html', '.'],
    ['apps/web/app/src/app/fixture.html', 'apps/web/app'],
    ['apps/web/site/src/pages/fixture.astro', 'apps/web/site'],
  ]) {
    const filename = resolve(root, path);
    const source = '<section>\n<div></div>\n<p></p>\n</section>\n';
    const results = [];

    for (const cwd of [root, resolve(root, directory)]) {
      const eslint = new ESLint({ cwd });
      const [result] = await eslint.lintText(source, { filePath: filename });

      results.push(result.messages.filter((message) => message.ruleId === ruleId));
    }

    assert.equal(results[0].length, 1);
    assert.deepEqual(results[0], results[1]);
  }
});

test('Nx selects lint and rule regressions when only a shared rule changes', async () => {
  const { stdout } = await promisify(execFile)(
    'pnpm',
    [
      'nx',
      'affected',
      '-t',
      'lint',
      'test',
      '--files=tools/lint-rules/template-sibling-newlines.mjs',
      '--graph=stdout',
    ],
    { cwd: root, env: { ...process.env, NX_DAEMON: 'false' }, maxBuffer: 4 * 1024 * 1024 },
  );
  const graph = JSON.parse(stdout);

  for (const task of ['dev-testing:eslint-check', 'dev-testing:test', 'web-app:lint', 'web-site:lint']) {
    assert.ok(graph.tasks.tasks[task], `Missing affected task: ${task}`);
  }
});

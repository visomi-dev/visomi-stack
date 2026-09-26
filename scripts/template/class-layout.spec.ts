import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';
import { format } from 'prettier';
import { createSourceFile, isClassDeclaration, ScriptTarget, transpile } from 'typescript';

async function fixClass(source: string): Promise<string> {
  const config = await new ESLint().calculateConfigForFile('apps/web/app/src/app/account/account.ts');
  const eslint = new ESLint({
    overrideConfigFile: true,
    fix: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: config.languageOptions,
        plugins: config.plugins,
        rules: { 'perfectionist/sort-classes': config.rules['perfectionist/sort-classes'] },
      },
    ],
  });
  const [result] = await eslint.lintText(source, { filePath: 'class-layout.ts' });

  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
  const output = result.output ?? source;
  const [secondPass] = await eslint.lintText(output, { filePath: 'class-layout.ts' });

  assert.equal(secondPass.output, undefined, 'Autofix must reach a stable result.');
  const formatted = await format(output, { parser: 'typescript' });
  const [afterPrettier] = await eslint.lintText(formatted, { filePath: 'class-layout.ts' });

  assert.equal(afterPrettier.output, undefined, 'Prettier and the class rule must agree.');

  return output;
}

test('class groups keep injections and state compact, forms before computed, and effects last', async () => {
  const fixed = await fixClass(`class Example {
  private readonly watch = effect(() => {});
  readonly ready = computed(() => true);
  readonly profileForm = form(this.profileModel);
  readonly profileModel = signal({ name: '' });

  readonly codeModel = signal({ code: '' });
  private readonly service = inject(Service);

  private readonly router = inject(Router);
  save() {}
  reset() {}
  private readonly render = afterRenderEffect(() => {});
}`);
  const file = createSourceFile('class-layout.ts', fixed, ScriptTarget.Latest, true);
  const declaration = file.statements.find(isClassDeclaration);

  assert.ok(declaration);
  assert.deepEqual(
    declaration.members.map((member) => member.name?.getText(file)),
    ['service', 'router', 'profileModel', 'codeModel', 'profileForm', 'ready', 'save', 'reset', 'watch', 'render'],
  );
  assert.match(fixed, /inject\(Service\);\n {2}private readonly router/);
  assert.match(fixed, /inject\(Router\);\n\n {2}readonly profileModel/);
  assert.match(fixed, /name: '' }\);\n {2}readonly codeModel/);
  assert.match(fixed, /this.profileModel\);\n\n {2}readonly ready/);
  assert.match(fixed, /save\(\) {}\n\n {2}reset/);
});

test('dependency order preserves runtime initialization despite cosmetic group ordering', async () => {
  const source = `class Example {
  private readonly model = { count: 7 };
  protected readonly form = { model: this.model };
  public result() { return this.form.model.count; }
}
new Example().result();`;
  const fixed = await fixClass(source);

  assert.equal(runInNewContext(transpile(fixed)), runInNewContext(transpile(source)));
  assert.match(fixed, /count: 7 };\n {2}protected readonly form/);
});

test('comments stay attached to compact fields and overload signatures stay adjacent', async () => {
  const fixed = await fixClass(`class Example {
  readonly first = 1;
  /** Description of second. */
  readonly second = 2;
  call(value: string): string;
  call(value: number): number;
  call(value: string | number) { return value; }
}`);

  assert.match(fixed, /first = 1;\n {2}\/\*\* Description of second\. \*\//);
  assert.match(fixed, /call\(value: string\): string;\n {2}call\(value: number\): number;\n {2}call/);
});

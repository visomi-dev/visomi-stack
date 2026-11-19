import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint, Linter } from 'eslint';

const root = fileURLToPath(new URL('../../', import.meta.url));
const filename = resolve(root, 'apps/web/app/src/app/db/example/example.ts');
const ruleId = 'perfectionist/sort-classes';

async function configuration(directory) {
  const eslint = new ESLint({ cwd: resolve(root, directory) });
  const resolved = await eslint.calculateConfigForFile(filename);

  return [
    {
      languageOptions: resolved.languageOptions,
      plugins: resolved.plugins,
      rules: { [ruleId]: resolved.rules[ruleId] },
    },
  ];
}

for (const [name, directory] of [
  ['root hooks and editor', '.'],
  ['Nx Angular task', 'apps/web/app'],
]) {
  test(`${name}: groups signal properties by visibility`, async () => {
    const config = await configuration(directory);
    const linter = new Linter();
    const source = `class Example {
  readonly busy = signal(false);
  private readonly configured = signal(false);
  readonly notice = signal('');
}`;
    const expected = `class Example {
  private readonly configured = signal(false);

  readonly busy = signal(false);
  readonly notice = signal('');
}`;
    const messages = linter.verify(source, config);
    const fixed = linter.verifyAndFix(source, config);

    assert.ok(messages.some((message) => message.ruleId === ruleId && message.severity === 2));
    assert.equal(fixed.output, expected);
    assert.deepEqual(fixed.messages, []);
    assert.equal(linter.verifyAndFix(fixed.output, config).fixed, false);
  });

  test(`${name}: separates implicit public, explicit public, protected and private properties`, async () => {
    const config = await configuration(directory);
    const linter = new Linter();

    for (const initializer of [
      'inject(Service)',
      'input.required<string>()',
      'output<string>()',
      'viewChild<ElementRef>("heading")',
      'signal<boolean>(false)',
      'linkedSignal(() => false)',
      'toSignal(events)',
      'form(model)',
      'computed(() => false)',
      'false',
    ]) {
      const source = `class Example {
  readonly first = ${initializer};
  protected readonly inherited = ${initializer};
  private readonly hidden = ${initializer};
  public readonly second = ${initializer};
  readonly #secret = ${initializer};
}`;
      const expected = `class Example {
  private readonly hidden = ${initializer};
  readonly #secret = ${initializer};

  protected readonly inherited = ${initializer};

  readonly first = ${initializer};
  public readonly second = ${initializer};
}`;
      const fixed = linter.verifyAndFix(source, config);

      assert.equal(fixed.output, expected);
      assert.deepEqual(fixed.messages, []);
    }
  });

  test(`${name}: visibility takes precedence over property kind and readonly`, async () => {
    const config = await configuration(directory);
    const linter = new Linter();
    const source = `class Example {
  readonly busy = signal(false);
  private pending = false;
  readonly caption = 'Ready';
  private readonly configured = computed(() => true);
}`;
    const expected = `class Example {
  private readonly configured = computed(() => true);

  private pending = false;

  readonly busy = signal(false);

  readonly caption = 'Ready';
}`;
    const fixed = linter.verifyAndFix(source, config);

    assert.equal(fixed.output, expected);
    assert.deepEqual(fixed.messages, []);
  });

  test(`${name}: preserves eager dependencies and keeps Angular effects after methods`, async () => {
    const config = await configuration(directory);
    const linter = new Linter();
    const source = `class Example {
  readonly state = signal(false);

  private readonly exposed = this.state.asReadonly();

  update() { this.state.set(true); }

  private readonly observe = effect(() => this.exposed());

  private readonly render = afterNextRender(() => this.update());
}`;

    assert.deepEqual(linter.verify(source, config), []);
    assert.equal(linter.verifyAndFix(source, config).output, source);
  });
}

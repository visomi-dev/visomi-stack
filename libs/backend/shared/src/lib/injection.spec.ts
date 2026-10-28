import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { createInjector, inject, InjectionToken, Injector, runInInjectionContext } from './injection';

type Resource = { value: string };
const RESOURCE = new InjectionToken<Resource>('synthetic resource');
const ABSENT = new InjectionToken<string>('absent synthetic value');

class Dependency {
  readonly resource = inject<Resource>(RESOURCE);
}
class Consumer {
  readonly dependency = inject(Dependency);
  readonly optional = inject<string>(ABSENT, { optional: true });
}
class AsyncConsumer {
  private readonly resource = inject<Resource>(RESOURCE);

  async read(): Promise<string> {
    await Promise.resolve();

    return this.resource.value;
  }
}

describe('backend injection without decorators or metadata', () => {
  it('constructs services through the public exports in Node without a metadata polyfill', async () => {
    const execute = promisify(execFile);
    const result = await execute(
      process.execPath,
      [
        '--import',
        'tsx',
        '-e',
        `
      const metadataBefore = typeof Reflect.getOwnMetadata;
      const { createInjector, inject } = require(${JSON.stringify(resolve(import.meta.dirname, '../index.ts'))});
      class Dependency {}
      class Consumer { dependency = inject(Dependency); }
      const injector = createInjector([Dependency, Consumer]);
      const value = injector.get(Consumer);
      console.log(JSON.stringify({ metadataBefore, metadataAfter: typeof Reflect.getOwnMetadata, same: value.dependency === injector.get(Dependency) }));
    `,
      ],
      { cwd: resolve(import.meta.dirname, '../../../../..'), timeout: 5000 },
    );

    expect(JSON.parse(result.stdout)).toEqual({ metadataBefore: 'undefined', metadataAfter: 'undefined', same: true });
  });

  it('constructs property-injected services lazily and caches them within each injector', () => {
    const value = { value: 'first' };
    const first = createInjector([{ provide: RESOURCE, useValue: value }, Dependency, Consumer]);
    const second = createInjector([{ provide: RESOURCE, useValue: { value: 'second' } }, Dependency, Consumer]);
    const consumer = first.get<Consumer>(Consumer);

    expectTypeOf(consumer.dependency).toEqualTypeOf<Dependency>();
    expect(consumer.dependency).toBe(first.get<Dependency>(Dependency));
    expect(consumer.dependency.resource).toBe(value);
    expect(consumer.optional).toBeNull();
    expect(first.get<Consumer>(Consumer)).toBe(consumer);
    expect(second.get<Consumer>(Consumer)).not.toBe(consumer);
    expect(second.get<Consumer>(Consumer).dependency.resource.value).toBe('second');
    expect(first.get<Injector>(Injector)).toBe(first);
  });

  it('supports explicit factories, aliases and child overrides without inspecting constructor parameters', () => {
    const ALIAS = new InjectionToken<Resource>('synthetic alias');
    const CREATED = new InjectionToken<Resource>('factory result');
    const parent = createInjector([
      { provide: RESOURCE, useValue: { value: 'parent' } },
      { provide: ALIAS, useExisting: RESOURCE },
      { provide: CREATED, useFactory: () => inject<Resource>(ALIAS) },
    ]);
    const child = createInjector([{ provide: RESOURCE, useValue: { value: 'child' } }, Dependency], parent);

    expect(parent.get<Resource>(CREATED)).toBe(parent.get<Resource>(RESOURCE));
    expect(child.get<Dependency>(Dependency).resource.value).toBe('child');
    expect(child.get<Resource>(ALIAS).value).toBe('parent');
    expect(() => child.get(ABSENT)).toThrow(/No provider/);
  });

  it('restores a surrounding context after nested construction fails', () => {
    class Failing {
      constructor() {
        throw new Error('synthetic construction failure');
      }
    }
    const outer = createInjector([{ provide: RESOURCE, useValue: { value: 'outer' } }]);
    const inner = createInjector([Failing]);

    runInInjectionContext(outer, () => {
      expect(() => inner.get<Failing>(Failing)).toThrow('synthetic construction failure');
      expect(inject<Resource>(RESOURCE).value).toBe('outer');
      expect(() => runInInjectionContext(inner, () => inject(ABSENT))).toThrow(/No provider/);
      expect(inject<Resource>(RESOURCE).value).toBe('outer');
    });
    expect(() => inject(RESOURCE)).toThrow(/injection context/);
  });

  it('detects circular service graphs and releases their construction context', () => {
    class First {
      readonly second = inject(Second);
    }
    class Second {
      readonly first = inject(First);
    }
    const injector = createInjector([First, Second]);

    expect(() => injector.get<First>(First)).toThrow(/cyclic dependency/i);
    expect(() => inject(RESOURCE)).toThrow(/injection context/);
  });

  it('retains captured dependencies across concurrent async work without propagating inject past await', async () => {
    const first = createInjector([{ provide: RESOURCE, useValue: { value: 'first' } }, AsyncConsumer]);
    const second = createInjector([{ provide: RESOURCE, useValue: { value: 'second' } }, AsyncConsumer]);
    const results = await Promise.all([
      first.get<AsyncConsumer>(AsyncConsumer).read(),
      second.get<AsyncConsumer>(AsyncConsumer).read(),
    ]);

    expect(results).toEqual(['first', 'second']);
    await runInInjectionContext(first, async () => {
      const resource = inject<Resource>(RESOURCE);

      await Promise.resolve();
      expect(resource.value).toBe('first');
      expect(() => inject(RESOURCE)).toThrow(/injection context/);
    });
  });
});

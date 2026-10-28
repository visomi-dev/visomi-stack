import { ReflectiveInjector } from 'injection-js';
import type { Injector, Provider } from 'injection-js';

export { inject, InjectionToken, Injector, runInInjectionContext } from 'injection-js';
export type { Provider, Type } from 'injection-js';

export function createInjector(providers: Provider[], parent?: Injector): Injector {
  return ReflectiveInjector.resolveAndCreate(providers, parent);
}

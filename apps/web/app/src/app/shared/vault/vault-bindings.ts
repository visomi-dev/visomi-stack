import { keyDomainId, type WrappingContext } from '@visomi-stack/shared-db';

export function latestBindings(current: WrappingContext[], bindings: WrappingContext[]): WrappingContext[] {
  const latest = new Map<string, WrappingContext>();

  for (const binding of [...current, ...bindings]) {
    const id = keyDomainId(binding.ownerId, { ...binding.key, generation: 1 });
    const previous = latest.get(id);

    if (!previous || previous.key.generation <= binding.key.generation) {
      latest.set(id, binding);
    }
  }

  return [...latest.values()];
}

export function custodyId(binding: WrappingContext): string {
  return JSON.stringify([
    binding.ownerId,
    binding.key.product,
    binding.key.scope.tenantId,
    binding.deviceId,
    binding.methodId,
    binding.origin,
  ]);
}

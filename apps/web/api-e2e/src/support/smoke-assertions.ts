/** Writing failed observations to a report must never produce a green verification target. */
export function requireObservedSmokeResults(results: ReadonlyArray<{ name: string; observed: boolean }>): void {
  const failures = results.filter((result) => !result.observed);

  if (failures.length) throw new Error(`The HTTP smoke verification failed ${failures.length} required assertions.`);
}

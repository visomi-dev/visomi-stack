import { expect, test } from '../../../../e2e/fixtures/http';

test('exports one completion, span and metric contribution per successful or failed request', async ({
  request,
  telemetry: telemetryFiles,
}) => {
  const success = await request.get('/');
  const missing = await request.get('/synthetic-missing');
  const body = await success.json();
  const ids = [success, missing].map((response) => response.headers()['x-request-id']);

  expect(success.status()).toBe(200);
  expect(body).toEqual({ message: 'Hello API' });
  expect(missing.status()).toBe(404);
  await expect
    .poll(async () => {
      const telemetry = await telemetryFiles.read();
      const logs = telemetry.logs.filter((log) => ids.includes(log.requestId as string));

      return telemetry.spans.filter((span) =>
        logs.some((log) => log.spanId === (span.context as { spanId: string }).spanId),
      ).length;
    })
    .toBe(2);
  const telemetry = await telemetryFiles.read();
  const completions = telemetry.logs.filter((log) => ids.includes(log.requestId as string));

  expect(completions).toHaveLength(2);
  expect(completions.map((log) => log.outcome)).toEqual(['success', 'client_error']);
  expect(completions.map((log) => log.status)).toEqual([200, 404]);
  for (const log of completions) {
    const span = telemetry.spans.find((entry) => (entry.context as { spanId: string }).spanId === log.spanId);

    expect(span?.name).toBe('http.request');
    expect(span?.attributes).toEqual({
      operation: 'http.request',
      outcome: log.outcome,
      'http.response.status_code': log.status,
    });
    expect(span?.parent).toBeUndefined();
  }

  await expect
    .poll(async () => {
      const exported = await telemetryFiles.read();
      const latest = exported.metrics.at(-1) as
        | {
            scopeMetrics: { metrics: { descriptor: { name: string }; dataPoints: { value: number }[] }[] }[];
          }
        | undefined;
      const metrics = latest?.scopeMetrics.flatMap((scope) => scope.metrics) ?? [];
      const counter = metrics.find((metric) => metric.descriptor.name === 'http.server.requests');
      const duration = metrics.find((metric) => metric.descriptor.name === 'http.server.request.duration');
      const expected = exported.logs.filter((log) => log.event === 'http.request').length;

      return {
        allRequestsCounted: counter?.dataPoints.reduce((sum, point) => sum + point.value, 0) === expected,
        bothOutcomesTimed: (duration?.dataPoints.length ?? 0) >= 2,
      };
    })
    .toEqual({ allRequestsCounted: true, bothOutcomesTimed: true });
});

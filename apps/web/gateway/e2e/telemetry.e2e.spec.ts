import { expect, test } from '../../../../e2e/fixtures/http';

test('exports one completion per concurrent request across both middleware layers', async ({
  request,
  telemetry: telemetryFiles,
}) => {
  const responses = await Promise.all(['/api/', '/api/missing', '/missing'].map((path) => request.get(path)));
  const ids = responses.map((response) => response.headers()['x-request-id']);

  expect(responses.map((response) => response.status())).toEqual([200, 404, 404]);
  expect(new Set(ids).size).toBe(3);
  await expect
    .poll(async () => {
      const telemetry = await telemetryFiles.read();
      const completions = telemetry.logs.filter((log) => ids.includes(log.requestId as string));

      return completions.filter((log) =>
        telemetry.spans.some((span) => (span.context as { spanId: string }).spanId === log.spanId),
      ).length;
    })
    .toBe(3);
  const telemetry = await telemetryFiles.read();

  for (const id of ids) {
    const completions = telemetry.logs.filter((log) => log.requestId === id);

    expect(completions).toHaveLength(1);
    expect(completions[0].service).toBe('web-gateway');
    expect(
      telemetry.spans.filter((span) => (span.context as { spanId: string }).spanId === completions[0].spanId),
    ).toHaveLength(1);
  }

  expect(
    new Set(telemetry.logs.filter((log) => ids.includes(log.requestId as string)).map((log) => log.traceId)).size,
  ).toBe(3);

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
      const expected = exported.logs.filter((log) => log.event === 'http.request').length;

      return counter?.dataPoints.reduce((sum, point) => sum + point.value, 0) === expected;
    })
    .toBe(true);
});

test('keeps request and error material out of local exported telemetry', async ({
  request,
  telemetry: telemetryFiles,
}) => {
  const marker = 'SYNTHETIC_PRIVATE_GATEWAY_71d3';
  const initial = await request.get('/api/auth/session');
  const state = await initial.json();
  const rejected = await request.post(`/api/auth/passkeys/registration/options?secret=${marker}`, {
    headers: {
      origin: 'http://127.0.0.1:3317',
      'x-csrf-token': state.csrfToken,
      authorization: `Bearer ${marker}`,
      'x-request-id': marker,
      baggage: `secret=${marker}`,
    },
    data: { customer: marker },
  });
  const body = await rejected.json();
  const id = rejected.headers()['x-request-id'];

  expect(rejected.status()).toBe(400);
  expect(body).toEqual({ error: 'request_invalid' });
  expect(id).not.toBe(marker);
  await expect
    .poll(async () => {
      const telemetry = await telemetryFiles.read();
      const log = telemetry.logs.find((entry) => entry.requestId === id);

      return (
        telemetry.metrics.length > 0 &&
        telemetry.spans.some((span) => (span.context as { spanId: string }).spanId === log?.spanId)
      );
    })
    .toBe(true);
  const telemetry = await telemetryFiles.read();
  const serialized = JSON.stringify(telemetry);

  expect(serialized).not.toContain(marker);
  expect(serialized).not.toContain(state.csrfToken);
  expect(
    telemetry.metrics.every(
      (metric) =>
        (metric.resource as { attributes: Record<string, unknown> }).attributes['service.name'] === 'web-gateway',
    ),
  ).toBe(true);
});

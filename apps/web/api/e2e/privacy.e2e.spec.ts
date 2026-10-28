import { expect, test } from './fixtures/http';

test('excludes synthetic private input from exported operational telemetry', async ({
  request,
  telemetry: telemetryFiles,
}) => {
  const marker = 'SYNTHETIC_PRIVATE_MARKER_e2e_73fa';
  const response = await request.post(`/missing/${marker}?secret=${marker}`, {
    headers: {
      authorization: `Bearer ${marker}`,
      cookie: `session=${marker}`,
      'user-agent': marker,
      'x-forwarded-for': marker,
      baggage: `secret=${marker}`,
      tracestate: `secret=${marker}`,
    },
    data: { private: marker },
  });
  const id = response.headers()['x-request-id'];

  expect(response.status()).toBe(404);

  await expect
    .poll(async () => {
      const telemetry = await telemetryFiles.read();

      return telemetry.spans.some(
        (span) =>
          (span.context as { traceId: string }).traceId === telemetry.logs.find((log) => log.requestId === id)?.traceId,
      );
    })
    .toBe(true);

  await expect
    .poll(async () => {
      const telemetry = await telemetryFiles.read();

      return telemetry.metrics.length;
    })
    .toBeGreaterThan(0);

  const telemetry = await telemetryFiles.read();

  expect(JSON.stringify(telemetry)).not.toContain(marker);
});

import { expect, test } from '../../../../e2e/fixtures/http';

test('concurrent requests own distinct correlation and ignore external trace context', async ({
  request,
  telemetry: telemetryFiles,
}) => {
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      request.get('/', {
        headers: {
          'x-request-id': '12345678-1234-4234-8234-123456789abc',
          traceparent: `00-${'f'.repeat(32)}-${'f'.repeat(16)}-01`,
        },
      }),
    ),
  );
  const ids = responses.map((response) => response.headers()['x-request-id']);

  expect(responses.map((response) => response.status())).toEqual(Array(8).fill(200));
  expect(new Set(ids).size).toBe(8);
  expect(ids).not.toContain('12345678-1234-4234-8234-123456789abc');
  await expect
    .poll(async () => {
      const telemetry = await telemetryFiles.read();

      return telemetry.logs.filter((log) => ids.includes(log.requestId as string)).length;
    })
    .toBe(8);
  const telemetry = await telemetryFiles.read();
  const completions = telemetry.logs.filter((log) => ids.includes(log.requestId as string));

  expect(new Set(completions.map((log) => log.traceId)).size).toBe(8);
  expect(completions.map((log) => log.traceId)).not.toContain('f'.repeat(32));
  await expect
    .poll(async () => {
      const exported = await telemetryFiles.read();

      return exported.spans.filter((span) =>
        completions.some((log) => log.spanId === (span.context as { spanId: string }).spanId),
      ).length;
    })
    .toBe(8);
});

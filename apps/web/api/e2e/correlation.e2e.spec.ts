import { expect, test } from '@playwright/test';

import { readTelemetry } from './telemetry';

test('concurrent requests own distinct correlation and ignore external trace context', async ({ request }) => {
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
      const telemetry = await readTelemetry();

      return telemetry.logs.filter((log) => ids.includes(log.requestId as string)).length;
    })
    .toBe(8);
  const telemetry = await readTelemetry();
  const completions = telemetry.logs.filter((log) => ids.includes(log.requestId as string));

  expect(new Set(completions.map((log) => log.traceId)).size).toBe(8);
  expect(completions.map((log) => log.traceId)).not.toContain('f'.repeat(32));
  await expect
    .poll(async () => {
      const exported = await readTelemetry();

      return exported.spans.filter((span) =>
        completions.some((log) => log.spanId === (span.context as { spanId: string }).spanId),
      ).length;
    })
    .toBe(8);
});

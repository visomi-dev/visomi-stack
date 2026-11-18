import { setImmediate } from 'node:timers/promises';

import { expect, it, vi } from 'vitest';

import { trackVisits } from './visit-browser';

it('sends only the declared visit fields and rejects redirects', async () => {
  const transport = vi.fn<typeof window.fetch>().mockResolvedValue(new Response(null, { status: 204 }));

  transport.mockResolvedValueOnce(Response.json({ enabled: true }));

  const browser = {
    fetch: transport,
    document: Object.assign(new EventTarget(), { visibilityState: 'visible', readyState: 'complete' }),
    location: new URL('https://frontend.example.test/home'),
    navigator: {},
  } as unknown as Window;
  const page = { page: 'home', locale: 'en', path: '/private/SYNTHETIC_DATA' } as const;

  trackVisits(browser, () => page);

  await setImmediate();

  const transportPolicy = { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' };

  expect(transport).toHaveBeenNthCalledWith(
    2,
    '/telemetry/visits',
    expect.objectContaining({
      ...transportPolicy,
      body: JSON.stringify({ page: 'home', locale: 'en' }),
    }),
  );
  expect(transport).toHaveBeenNthCalledWith(1, '/telemetry/visits/config', transportPolicy);
});

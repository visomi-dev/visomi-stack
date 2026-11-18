import { setImmediate } from 'node:timers/promises';

import { expect, it, vi } from 'vitest';

import type { BrowserConsent } from './consent';
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

  const consent = { permit: () => 'grant' } as BrowserConsent;

  trackVisits(browser, consent, () => page);

  await setImmediate();

  const transportPolicy = { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' };

  expect(transport).toHaveBeenNthCalledWith(
    2,
    'https://frontend.example.test/telemetry/visits',
    expect.objectContaining({
      ...transportPolicy,
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify({ page: 'home', locale: 'en' }),
    }),
  );
  expect(transport).toHaveBeenNthCalledWith(1, '/telemetry/visits/config', transportPolicy);
});

it('does not backfill and drops a view awaiting configuration when its grant changes', async () => {
  let resolveConfiguration!: (value: Response) => void;
  const configuration = new Promise<Response>((resolve) => {
    resolveConfiguration = resolve;
  });
  const transport = vi.fn<typeof window.fetch>().mockResolvedValue(new Response(null, { status: 204 }));

  transport.mockReturnValueOnce(configuration);
  const location = new URL('https://frontend.example.test/home');
  const browser = {
    fetch: transport,
    document: Object.assign(new EventTarget(), { visibilityState: 'visible', readyState: 'complete' }),
    location,
  } as unknown as Window;
  let grant: string | undefined;
  const consent = { permit: () => grant } as BrowserConsent;
  const visits = trackVisits(browser, consent, (path) => ({ page: path.slice(1), locale: 'en' }));

  expect(transport).not.toHaveBeenCalled();
  grant = 'first';
  visits.update();
  expect(transport).not.toHaveBeenCalled();
  location.pathname = '/docs';
  visits.update();
  expect(transport).toHaveBeenCalledOnce();
  grant = 'second';
  resolveConfiguration(Response.json({ enabled: true }));

  await setImmediate();

  expect(transport).toHaveBeenCalledOnce();
  location.pathname = '/ui';
  visits.update();

  await setImmediate();

  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls[1][1]?.body).toBe(JSON.stringify({ page: 'ui', locale: 'en' }));
  visits.stop();
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserErrorKind, browserLocation, browserScreen, createBrowserReporter } from './browser';

const marker = 'SYNTHETIC_PRIVATE_BROWSER_DATA_71d3';
const id = 'a'.repeat(64);
const assets = [{ path: '/_astro/synthetic.js', id }];
const config = { token: 'synthetic-report-token', assets };

function fixture(configuration: unknown = config) {
  const host = new EventTarget();
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(undefined, { status: 202 }));

  transport.mockResolvedValueOnce(Response.json(configuration));
  const browser = Object.assign(host, { fetch: transport, location: new URL('https://frontend.example.test/en/ui/') });
  const reporter = createBrowserReporter('web-site', browser as unknown as Window);

  return { browser, transport, reporter };
}

afterEach(() => vi.restoreAllMocks());

describe('browser error capture policy', () => {
  it.each(['/en/', '/es', '/app/en/'])('uses fixed home names for %s', (path) => {
    expect(browserScreen(path)).toBe('home');
  });
  it.each(['/en/ui/', '/app/es/ui', '/es/ui/'])('uses fixed UI names for %s', (path) => {
    expect(browserScreen(path)).toBe('ui');
  });
  it('drops dynamic paths, arbitrary names, raw stacks, and URLs', () => {
    const error = new TypeError(marker);

    error.stack = `TypeError: ${marker}\n at synthetic (https://frontend.example.test/_astro/synthetic.js:2:3)`;
    expect(browserScreen('/en/customer/' + marker)).toBe('unknown');
    expect(browserErrorKind(error)).toBe('TypeError');
    expect(browserErrorKind({ name: marker })).toBe('unknown');
    error.name = marker;
    expect(browserErrorKind(error)).toBe('unknown');
    expect(browserLocation(error, 'https://frontend.example.test', assets)).toEqual({ asset: id, line: 2, column: 3 });
    expect(
      browserLocation(undefined, 'https://frontend.example.test', assets, {
        filename: 'https://frontend.example.test/_astro/synthetic.js',
        lineno: 1,
        colno: 2,
      }),
    ).toEqual({ asset: id, line: 1, column: 2 });
  });

  it.each([
    'https://untrusted.example.test/_astro/synthetic.js:1:1',
    `https://frontend.example.test/_astro/synthetic.js?secret=${marker}:1:1`,
    `https://${marker}@frontend.example.test/_astro/synthetic.js:1:1`,
    'https://frontend.example.test/_astro/missing.js:1:1',
    'https://frontend.example.test/_astro/synthetic.js:0:1',
    'https://frontend.example.test/_astro/synthetic.js:1:0',
    'https://frontend.example.test/_astro/synthetic.js:999999999999999999:1',
    'not-a-source-location',
  ])('discards unverifiable code locations %s', (frame) => {
    const error = new Error(marker);

    error.stack = `Error: ${marker}\n at synthetic (${frame})`;
    expect(browserLocation(error, 'https://frontend.example.test', assets)).toBeUndefined();
  });

  it('isolates hostile error getters', () => {
    const error = new Error();

    Object.defineProperty(error, 'name', {
      get: () => {
        throw new Error(marker);
      },
    });
    Object.defineProperty(error, 'stack', {
      get: () => {
        throw new Error(marker);
      },
    });
    expect(browserErrorKind(error)).toBe('unknown');
    expect(browserLocation(error, 'https://frontend.example.test', assets)).toBeUndefined();
  });

  it('captures global errors and rejections without recording rejection objects or private data', async () => {
    const f = fixture();

    await f.reporter.ready;

    f.browser.dispatchEvent(
      Object.assign(new Event('error'), { error: new TypeError(marker), filename: marker, lineno: 1, colno: 1 }),
    );
    f.browser.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: { customer: marker } }));

    await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(3));

    const calls = f.transport.mock.calls.slice(1);

    expect(calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { application: 'web-site', code: 'unhandled_exception', kind: 'TypeError', screen: 'ui' },
      { application: 'web-site', code: 'unhandled_rejection', kind: 'unknown', screen: 'ui' },
    ]);
    expect(JSON.stringify(calls)).not.toContain(marker);
    expect(calls[0][1]).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      mode: 'same-origin',
      redirect: 'error',
      headers: { 'x-browser-telemetry': config.token },
    });
    f.reporter.stop();
    f.browser.dispatchEvent(new Event('error'));

    await f.reporter.report('startup_failed');

    expect(f.transport).toHaveBeenCalledTimes(3);
  });

  it('deduplicates errors, bounds bursts, refreshes expired permits, and resumes after a window', async () => {
    const f = fixture();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const now = Date.now();

    await f.reporter.report('unhandled_exception');

    await f.reporter.report('unhandled_exception');

    expect(f.transport).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 8; i++) {
      await f.reporter.report('request_failed', undefined, undefined, `synthetic-correlation-${i}`);
    }
    expect(f.transport).toHaveBeenCalledTimes(5);
    clock.mockReturnValue(now + 240001);
    f.transport.mockResolvedValueOnce(Response.json(config));

    await f.reporter.report('startup_failed');

    expect(f.transport).toHaveBeenCalledTimes(7);
    f.reporter.stop();
  });

  it('lets frameworks own global listeners and shares in-flight reports of the same error', async () => {
    const browser = Object.assign(new EventTarget(), {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(undefined, { status: 202 })),
      location: new URL('https://frontend.example.test/app/en/'),
    });
    let resolveConfiguration!: (response: Response) => void;

    browser.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConfiguration = resolve;
        }),
    );
    const add = vi.spyOn(browser, 'addEventListener');
    const remove = vi.spyOn(browser, 'removeEventListener');
    const reporter = createBrowserReporter('web-app', browser as unknown as Window, { globalErrors: false });
    const error = new TypeError(marker);
    const frameworkReport = reporter.report('unhandled_exception', error);
    const startupReport = reporter.report('startup_failed', error);

    expect(startupReport).toBe(frameworkReport);

    await vi.waitFor(() => expect(browser.fetch).toHaveBeenCalledOnce());

    resolveConfiguration(Response.json(config));

    await startupReport.finally(() => reporter.stop());

    expect(browser.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(browser.fetch.mock.calls[1][1]?.body))).toEqual({
      application: 'web-app',
      code: 'unhandled_exception',
      kind: 'TypeError',
      screen: 'home',
    });
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    {},
    null,
    { token: 'synthetic', assets: [{ path: '/synthetic', id: marker }] },
    { token: 'synthetic', assets: [{ path: 42, id }] },
    { token: 'synthetic', assets: Array.from({ length: 513 }) },
  ])('stays silent for an invalid or disabled configuration %j', async (configuration) => {
    const f = fixture(configuration);

    await f.reporter.report('startup_failed', new Error(marker));

    expect(f.transport).toHaveBeenCalledTimes(1);
    f.reporter.stop();
  });

  it('never lets transport errors create reporting loops', async () => {
    const f = fixture();

    await f.reporter.ready;

    f.transport.mockRejectedValue(new Error(marker));

    await expect(f.reporter.report('startup_failed', new Error(marker))).resolves.toBeUndefined();

    expect(f.transport).toHaveBeenCalledTimes(2);
    f.reporter.stop();
  });

  it('observes only explicitly requested same-origin API failures and preserves responses and exceptions', async () => {
    const f = fixture();

    await f.reporter.ready;

    f.transport.mockResolvedValueOnce(
      new Response(undefined, {
        status: 503,
        headers: {
          'x-telemetry-context': 'synthetic-signed-correlation',
        },
      }),
    );
    const response = await f.reporter.fetch('/api/session');

    expect(response.status).toBe(503);

    await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(3));

    const payload = JSON.parse(String(f.transport.mock.calls[2][1]?.body));

    expect(payload.correlation).toBe('synthetic-signed-correlation');
    f.transport.mockRejectedValueOnce(new Error(marker));

    await expect(f.reporter.fetch('/api/network')).rejects.toThrow(marker);

    await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(5));

    f.transport.mockResolvedValueOnce(new Response(undefined, { status: 503 }));

    await f.reporter.fetch('https://third-party.example.test/api/');

    expect(f.transport).toHaveBeenCalledTimes(6);
    f.reporter.stop();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserConsent } from './consent';
import { browserLocation, createBrowserReporter } from './browser';
import { browserErrorKind, browserScreen } from './error-description';

const marker = 'SYNTHETIC_PRIVATE_BROWSER_DATA_71d3';
const id = 'a'.repeat(64);
const assets = [{ path: '/_astro/synthetic.js', id }];
const config = { token: 'synthetic-report-token', assets };

function fixture(configuration: unknown = config, automatic = true) {
  const host = new EventTarget();
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(undefined, { status: 202 }));

  transport.mockResolvedValueOnce(Response.json(configuration));
  const browser = Object.assign(host, { fetch: transport, location: new URL('https://frontend.example.test/en/ui/') });
  let grant = automatic ? 'grant' : undefined;
  const consent = {
    permit: () => grant,
    subscribe: () => () => undefined,
    blocked: () => false,
    decide: () => undefined,
    stop: () => undefined,
  } satisfies BrowserConsent;
  const reporter = createBrowserReporter('web-site', browser as unknown as Window, consent);

  return {
    browser,
    transport,
    reporter,
    grant: (value?: string) => {
      grant = value;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('browser error capture policy', () => {
  it.each(['/en/', '/es', '/app/en/', '/app/en/foundations', '/app/es/foundations/'])(
    'uses fixed home names for %s',
    (path) => {
      expect(browserScreen(path)).toBe('home');
    },
  );
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

    await f.reporter.performanceReady;

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
      mode: 'cors',
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
      await f.reporter.report('unhandled_rejection', new Error(), {
        filename: 'https://frontend.example.test/_astro/synthetic.js',
        lineno: i + 1,
        colno: 1,
      });
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
    const reporter = createBrowserReporter(
      'web-app',
      browser as unknown as Window,
      {
        permit: () => 'grant',
        subscribe: () => () => undefined,
        blocked: () => false,
        decide: () => undefined,
        stop: () => undefined,
      } satisfies BrowserConsent,
      { globalErrors: false },
    );
    const error = new TypeError(marker);
    const frameworkReport = reporter.report('unhandled_exception', error);
    const startupReport = reporter.report('startup_failed', error);

    expect(startupReport).toBe(frameworkReport);

    await vi.waitFor(() => expect(browser.fetch).toHaveBeenCalledOnce());

    resolveConfiguration(Response.json(config));

    await frameworkReport!.finally(() => reporter.stop());

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

    await f.reporter.performanceReady;

    f.transport.mockRejectedValue(new Error(marker));

    await expect(f.reporter.report('startup_failed', new Error(marker))).resolves.toBeUndefined();

    expect(f.transport).toHaveBeenCalledTimes(2);
    f.reporter.stop();
  });

  it('retains only bounded, deduplicated descriptions and expires them without a transport', () => {
    vi.useFakeTimers();

    try {
      const f = fixture(config, false);
      const errors = [Error, TypeError, RangeError, ReferenceError, SyntaxError];

      for (const ErrorKind of errors) {
        const error = new ErrorKind(marker);

        f.reporter.report('unhandled_exception', error);
        f.reporter.report('unhandled_exception', new ErrorKind(marker));
      }
      expect(f.reporter.pending()).toHaveLength(5);
      f.reporter.report('unhandled_rejection', { private: marker });
      const pending = f.reporter.pending();

      expect(pending.map(({ kind }) => kind)).toEqual([
        'TypeError',
        'RangeError',
        'ReferenceError',
        'SyntaxError',
        'unknown',
      ]);
      expect(JSON.stringify(pending)).not.toContain(marker);
      expect(f.transport).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300000);
      expect(f.reporter.pending()).toEqual([]);
      f.reporter.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends only the selected report without changing consent or backfilling on acceptance', async () => {
    const f = fixture(config, false);

    f.reporter.report('unhandled_exception', new Error(marker));
    f.reporter.report('unhandled_rejection', new TypeError(marker));
    const [first, second] = f.reporter.pending();

    const sent = await f.reporter.sendPending(second);

    expect(sent).toBe(true);
    expect(f.reporter.pending()).toEqual([first]);
    expect(f.reporter.consent.permit()).toBeUndefined();
    expect(f.transport.mock.calls.map(([path]) => path)).toEqual([
      '/telemetry/config',
      'https://frontend.example.test/telemetry/errors',
    ]);
    expect(JSON.parse(String(f.transport.mock.calls[1][1]?.body))).toEqual(second);
    f.grant('new');

    await f.reporter.report('unhandled_exception', new RangeError(marker));

    expect(f.transport).toHaveBeenCalledTimes(3);
    expect(f.reporter.pending()).toEqual([first]);
    f.reporter.discard(first);
    expect(f.reporter.pending()).toEqual([]);
    const discarded = await f.reporter.sendPending(first);

    expect(discarded).toBe(false);
    f.reporter.stop();
  });

  it('drops an automatic event if a new grant replaces the one used at capture', async () => {
    const f = fixture(config, false);
    let resolveConfiguration!: (value: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveConfiguration = resolve;
    });

    f.transport.mockImplementationOnce(() => response);
    f.grant('original');
    const sending = f.reporter.report('unhandled_exception', new TypeError(marker));

    f.grant();
    f.grant('new');
    resolveConfiguration(Response.json(config));

    await sending;

    expect(f.transport).toHaveBeenCalledExactlyOnceWith('/telemetry/config', expect.anything());
    expect(f.reporter.pending()).toEqual([]);
    f.reporter.stop();
  });
});

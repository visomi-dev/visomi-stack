import { expect, type BrowserContext, type Page, type Request, type Response, type TestInfo } from '@playwright/test';

export function firstDocument(page: Page, url: string) {
  return page.waitForResponse(
    (response) =>
      response.url() === url &&
      response.request().isNavigationRequest() &&
      response.request().redirectedFrom() === null,
  );
}

export async function expectAuthenticatedDocument(
  page: Page,
  info: TestInfo,
  url: string,
  note: string,
  navigate: () => Promise<unknown>,
) {
  const home = new URL(url).pathname.endsWith('/home');
  const cookies = await page.context().cookies(url);
  const hasSessionCookie = cookies.some((cookie) => cookie.name === 'visomi.sid');
  const document = firstDocument(page, url);
  let documentReceived = false;
  const policyRequests = new Set<Request>();
  let policyStatus: number | undefined;
  const traceRequest = (request: Request) => {
    if (documentReceived && new URL(request.url()).pathname === '/api/example/vault/policy') {
      policyRequests.add(request);
    }
  };
  const traceResponse = (response: Response) => {
    if (response.url() === url && response.request().isNavigationRequest()) {
      documentReceived = true;
    }

    if (policyRequests.has(response.request())) {
      policyStatus = response.status();
    }
  };

  page.on('request', traceRequest);
  page.on('response', traceResponse);

  try {
    const [first] = await Promise.all([document, navigate()]);
    const location = first.headers()['location'];
    const destination = location ? new URL(location, url) : null;
    let html = '';

    if (first.status() === 200) {
      const body = await first.text();

      html = body;
    }

    const ssr = readTransferredAccess(html);
    const route = home ? 'home' : new URL(url).pathname.endsWith('/vault/unlock') ? 'vault-unlock' : 'vault';

    await info.attach('document-' + route, {
      body: JSON.stringify({
        route,
        initialStatus: first.status(),
        sessionCookieInJar: hasSessionCookie,
        ssr,
        destination: destination
          ? destination.pathname.endsWith('/auth/sign-in')
            ? 'sign-in'
            : 'other'
          : 'same-route',
        returnToHome: destination?.searchParams.get('returnTo') === '/home',
      }),
      contentType: 'application/json',
    });

    expect(first.status()).toBe(200);
    expect(location).toBeUndefined();
    expect(first.headers()['cache-control']).toBe('no-store');
    expect(hasSessionCookie).toBe(true);
    expect(ssr).toBe('full');
    expect(html.includes('<app-authenticated-layout')).toBe(true);
    expect(html.includes(note)).toBe(false);

    const browser = await hydrationSession(page);

    await info.attach('hydration-' + route, { body: JSON.stringify(browser), contentType: 'application/json' });

    expect(browser).toEqual({ status: 200, access: 'full' });

    if (!home) {
      await expect.poll(() => policyStatus).toBe(200);
    }
  } finally {
    page.off('request', traceRequest);
    page.off('response', traceResponse);
  }
}

type SessionEvidence = { status: number; access: 'full' | 'anonymous' | 'other' | 'unavailable' };

type ObservedWindow = Window & { firstSessionRead?: SessionEvidence };

// Observe the first real session fetch in each new document. Browser protocol bodies can be evicted on reload.
export async function observeHydration(context: BrowserContext) {
  await context.addInitScript(() => {
    const view = window as ObservedWindow;
    const fetch = window.fetch.bind(window);
    let observed = false;

    window.fetch = (input, init) => {
      const result = fetch(input, init);
      const url = new URL(input instanceof Request ? input.url : input.toString(), location.href);

      if (!observed && url.origin === location.origin && url.pathname === '/api/auth/session') {
        observed = true;
        void result
          .then(async (response) => {
            if (!response.ok) {
              view.firstSessionRead = { status: response.status, access: 'unavailable' };

              return;
            }

            const body = await response.clone().json();
            const access =
              body?.authenticated && body.access === 'full' && body.user?.emailVerified
                ? 'full'
                : body?.authenticated === false && body.access === 'anonymous'
                  ? 'anonymous'
                  : 'other';

            view.firstSessionRead = { status: response.status, access };
          })
          .catch(() => {
            view.firstSessionRead = { status: 0, access: 'unavailable' };
          });
      }

      return result;
    };
  });
}

export async function hydrationSession(page: Page) {
  const observed = await page.waitForFunction(() => (window as ObservedWindow).firstSessionRead);

  return observed.jsonValue();
}

function classifySession(session?: {
  access?: string;
  authenticated?: boolean;
  user?: { emailVerified?: boolean } | null;
}) {
  if (session?.access === 'full' && session.authenticated && session.user?.emailVerified) {
    return 'full';
  }

  return session?.access === 'anonymous' && session.authenticated === false ? 'anonymous' : 'other';
}

function readTransferredAccess(html: string) {
  const state = html.match(/<script\b[^>]*\bid="[^"]+-state"[^>]*>([^<]*)<\/script>/)?.[1];
  const initial = state && JSON.parse(state)['auth-initial-session'];

  return initial?.available ? classifySession(initial.session) : 'unavailable';
}

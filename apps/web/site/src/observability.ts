import {
  createBrowserConsent,
  createPendingReports,
  describeBrowserError,
  loadBrowserReporter,
  type BrowserErrorReport,
  type UnhandledErrorCode,
} from '@visomi-stack/web-shared-observability/browser';

const consent = createBrowserConsent(window);
const documentPermit = consent.permit() ?? null;
const pending = createPendingReports();
let earlyReports = 0;
let reporter: ReturnType<Awaited<ReturnType<typeof loadBrowserReporter>>['createBrowserReporter']> | undefined;
let loading: Promise<NonNullable<typeof reporter>> | undefined;

function load() {
  loading ??= loadBrowserReporter().then(({ createBrowserReporter, trackVisits, siteVisitPage }) => {
    reporter = createBrowserReporter('web-site', window, consent, { documentPermit, pending, globalErrors: false });

    if (document.querySelector('meta[name="visit-analytics"]')) {
      trackVisits(window, consent, siteVisitPage, {
        ignoreCurrent: !documentPermit || consent.permit() !== documentPermit,
      });
    }

    return reporter;
  });

  return loading;
}

function ignoreImportFailure(): void {
  // A failed optional import must not become another pending exception.
}

function reportAfterLoad(report: BrowserErrorReport, permit: string): void {
  void load()
    .then((ready) => ready.sendCaptured(report, permit))
    .catch(ignoreImportFailure);
}

function capture(code: UnhandledErrorCode, error: unknown, source?: ErrorEvent): void {
  if (reporter) {
    void reporter.report(code, error, source);

    return;
  }

  const report = describeBrowserError('web-site', location.pathname, code, error);
  const permit = consent.permit();

  if (permit) {
    if (earlyReports++ < 5) {
      reportAfterLoad(report, permit);
    }
  } else {
    pending.add(report);
  }
}

window.addEventListener('error', (event) => capture('unhandled_exception', event.error, event));
window.addEventListener('unhandledrejection', (event) => capture('unhandled_rejection', event.reason));

if (documentPermit) {
  void load().catch(ignoreImportFailure);
}

const controls = document.querySelector('[data-browser-privacy]');

if (controls) {
  const open = controls.querySelector<HTMLButtonElement>('[data-open]')!;
  const indicator = controls.querySelector('[data-pending]')!;
  const dialog = controls.querySelector('dialog')!;

  const update = () => {
    indicator.classList.toggle('hidden', !!consent.permit() || !pending.items().length);
  };

  open.disabled = false;
  pending.subscribe(update);
  consent.subscribe(update);
  update();
  open.addEventListener('click', () => {
    void Promise.all([load(), import('./browser-privacy')])
      .then(([ready, { connectBrowserPrivacy }]) => {
        connectBrowserPrivacy(controls, ready);

        if (!dialog.open) {
          dialog.showModal();
        }
      })
      .catch(ignoreImportFailure);
  });
}

const languageLink = document.querySelector<HTMLAnchorElement>('[data-language-switcher]');

if (languageLink) {
  const path = languageLink.getAttribute('href')!;

  // Fragments never reach SSR; enhance the native link without intercepting navigation.
  const preserveFragment = () => {
    languageLink.setAttribute('href', path + window.location.hash);
  };

  preserveFragment();
  window.addEventListener('hashchange', preserveFragment);
}

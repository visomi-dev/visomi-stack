import {
  createBrowserConsent,
  describeBrowserError,
  loadBrowserReporter,
  type BrowserErrorReport,
  type UnhandledErrorCode,
} from '@visomi-stack/web-shared-observability/browser';

const consent = createBrowserConsent(window);
const documentPermit = consent.permit() ?? null;
let earlyReports = 0;
let reporter: ReturnType<Awaited<ReturnType<typeof loadBrowserReporter>>['createBrowserReporter']> | undefined;
let loading: Promise<NonNullable<typeof reporter>> | undefined;
const controls = document.querySelector('[data-browser-privacy]');
const open = controls?.querySelector<HTMLButtonElement>('[data-open]');

function syncReports(): void {
  if (open) {
    open.hidden = !!consent.permit() || !reporter?.pending().length;
  }
}

function load() {
  loading ??= loadBrowserReporter().then(({ createBrowserReporter, trackVisits, siteVisitPage }) => {
    reporter = createBrowserReporter('web-site', window, consent, { documentPermit, globalErrors: false });
    trackVisits(window, consent, siteVisitPage, {
      ignoreCurrent: !documentPermit || consent.permit() !== documentPermit,
    });

    reporter.subscribePending(syncReports);

    return reporter;
  });

  return loading;
}

function ignoreImportFailure(): void {
  // A failed optional import must not become another pending exception.
}

function reportAfterLoad(report: BrowserErrorReport, permit: string | undefined): void {
  const capturedAt = Date.now();

  void load()
    .then((ready) => {
      if (permit) {
        return ready.sendCaptured(report, permit);
      }

      ready.remember(report, capturedAt);

      return;
    })
    .catch(ignoreImportFailure);
}

function capture(code: UnhandledErrorCode, error: unknown, source?: ErrorEvent): void {
  if (reporter) {
    void reporter.report(code, error, source);

    return;
  }

  const report = describeBrowserError('web-site', location.pathname, code, error);
  const permit = consent.permit();

  if (earlyReports++ < 5) {
    reportAfterLoad(report, permit);
  }
}

window.addEventListener('error', (event) => capture('unhandled_exception', event.error, event));
window.addEventListener('unhandledrejection', (event) => capture('unhandled_rejection', event.reason));

if (documentPermit) {
  void load().catch(ignoreImportFailure);
}

if (controls && open) {
  const dialog = controls.querySelector('dialog')!;

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

const notice = document.querySelector<HTMLElement>('[data-consent]');

if (notice && (notice.dataset['consent'] === 'settings' || !consent.decided())) {
  const accept = notice.querySelector<HTMLButtonElement>('[data-choice=accept]')!;
  const status = notice.querySelector<HTMLElement>('[data-choice-status]')!;
  const sync = () => {
    accept.disabled = consent.blocked();
    status.textContent =
      status.dataset[accept.disabled ? 'blocked' : consent.permit() ? 'on' : consent.decided() ? 'off' : ''] ?? '';
  };

  notice.hidden = false;
  notice.onclick = ({ target }) => {
    if (target instanceof HTMLButtonElement && target.dataset['choice']) {
      consent.decide(target === accept);
    }
  };
  consent.subscribe(sync);
  sync();
}

import { createBrowserConsent, createBrowserReporter } from '@visomi-stack/web-shared-observability';
import { trackVisits } from '@visomi-stack/web-shared-observability/visits';

const browserConsent = createBrowserConsent(window);
const reporter = createBrowserReporter('web-site', window, browserConsent);

const controls = document.querySelector('[data-browser-privacy]');

if (controls) {
  const open = controls.querySelector<HTMLButtonElement>('[data-open]')!;
  const indicator = controls.querySelector('[data-pending]')!;
  const dialog = controls.querySelector('dialog')!;

  const update = () => {
    indicator.classList.toggle('hidden', !!browserConsent.permit() || !reporter.pending().length);
  };

  open.disabled = false;
  reporter.subscribePending(update);
  update();
  open.addEventListener('click', async () => {
    const { connectBrowserPrivacy } = await import('./browser-privacy');

    connectBrowserPrivacy(controls, reporter);

    if (!dialog.open) {
      dialog.showModal();
    }
  });
}

if (document.querySelector('meta[name="visit-analytics"]')) {
  trackVisits(window, browserConsent, (path) => {
    const match = /^\/(en|es)(?:\/(architecture|docs|ui))?\/?$/.exec(path);

    return match ? { locale: match[1] === 'es' ? 'es' : 'en', page: match[2] || 'home' } : undefined;
  });
}

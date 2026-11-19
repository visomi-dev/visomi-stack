import type { BrowserConsent } from '@visomi-stack/web-shared-observability';
import { connectConsentNotice } from '@visomi-stack/web-shared-observability/consent-notice';

export function confirmConsent(root: HTMLElement, consent: BrowserConsent, grant: string, startedAt: number): void {
  const card = root.querySelector<HTMLElement>('[data-consent-confirmation]')!;
  const announcement = root.querySelector<HTMLElement>('[data-consent-announcement]')!;
  const seconds = card.querySelector<HTMLElement>('[data-consent-seconds]')!;
  const progress = card.querySelector<HTMLProgressElement>('progress')!;

  connectConsentNotice(
    window,
    consent,
    (view) => {
      card.hidden = view.kind !== 'confirmation';
      const message = card.hidden ? '' : announcement.dataset['thanks']!;

      if (announcement.textContent !== message) {
        announcement.textContent = message;
      }

      if (view.kind === 'confirmation') {
        progress.value = view.seconds;
        seconds.textContent = view.seconds + ' s';
      }
    },
    { grant, startedAt },
  );
}

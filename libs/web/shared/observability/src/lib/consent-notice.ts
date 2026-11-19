import type { BrowserConsent } from './consent';

export const consentConfirmationSeconds = 10;

export type ConsentNoticeView =
  | { kind: 'hidden' }
  | { kind: 'choice'; blocked: boolean; decided: boolean }
  | { kind: 'confirmation'; seconds: number };

export function connectConsentNotice(
  browser: Window,
  consent: BrowserConsent,
  render: (view: ConsentNoticeView) => void,
  initial?: { grant: string; startedAt: number },
) {
  let showChoice = !consent.decided();
  let confirmation = initial && {
    grant: initial.grant,
    expiresAt: initial.startedAt + consentConfirmationSeconds * 1000,
  };
  let timer: number | undefined;

  function sync(): void {
    browser.clearTimeout(timer);
    timer = undefined;
    const grant = consent.permit();

    if (grant) {
      showChoice = false;
    }

    if (confirmation && grant === confirmation.grant) {
      const milliseconds = confirmation.expiresAt - browser.performance.now();

      if (milliseconds > 0) {
        const seconds = Math.ceil(milliseconds / 1000);

        render({ kind: 'confirmation', seconds });
        timer = browser.setTimeout(sync, Math.ceil(milliseconds - (seconds - 1) * 1000));

        return;
      }
    }

    confirmation = undefined;
    render(
      showChoice ? { kind: 'choice', blocked: consent.blocked(), decided: consent.decided() } : { kind: 'hidden' },
    );
  }

  function dismiss(): void {
    if (confirmation) {
      confirmation = undefined;
      sync();
    }
  }

  const unsubscribe = consent.subscribe(sync);

  browser.addEventListener('pagehide', dismiss);
  sync();

  return {
    choose(accepted: boolean): void {
      if (!showChoice) {
        return;
      }

      const previous = consent.permit();

      consent.decide(accepted);
      const grant = accepted ? consent.permit() : undefined;

      if (grant && grant !== previous) {
        confirmation = { grant, expiresAt: browser.performance.now() + consentConfirmationSeconds * 1000 };
        sync();
      }
    },
    dismiss,
    destroy(): void {
      unsubscribe();
      browser.removeEventListener('pagehide', dismiss);
      browser.clearTimeout(timer);
      confirmation = undefined;
      showChoice = false;
    },
  };
}

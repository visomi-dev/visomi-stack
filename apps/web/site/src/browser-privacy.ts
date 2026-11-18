import type { createBrowserReporter } from '@visomi-stack/web-shared-observability';

export function connectBrowserPrivacy(controls: Element, reporter: ReturnType<typeof createBrowserReporter>): void {
  const dialog = controls.querySelector('dialog')!;

  if (dialog.dataset['ready']) {
    return;
  }

  dialog.dataset['ready'] = 'true';

  const { consent } = reporter;
  const close = dialog.querySelector<HTMLButtonElement>('[data-close]')!;
  const status = dialog.querySelector<HTMLElement>('[data-status]')!;
  const accept = dialog.querySelector<HTMLButtonElement>('[data-accept]')!;
  const reports = dialog.querySelector<HTMLElement>('[data-reports]')!;
  const list = reports.querySelector('ul')!;
  const template = controls.querySelector('template')!;
  const feedback = dialog.querySelector<HTMLElement>('[data-feedback]')!;
  let sending = false;

  function sync(): void {
    const automatic = !!consent.permit();
    const pending = automatic ? [] : reporter.pending();

    accept.disabled = consent.blocked();
    status.textContent = status.dataset[accept.disabled ? 'blocked' : automatic ? 'on' : 'off'] ?? '';
    reports.hidden = !pending.length;

    if (list.contains(document.activeElement)) {
      close.focus();
    }

    list.replaceChildren(
      ...pending.map((report) => {
        const item = template.content.cloneNode(true) as DocumentFragment;
        const send = item.querySelector<HTMLButtonElement>('[data-send]')!;

        item.querySelector('[data-type]')!.textContent = template.dataset[report.code] ?? '';
        item.querySelector('[data-kind]')!.textContent =
          report.kind === 'unknown' ? (template.dataset['unknownKind'] ?? '') : report.kind;
        item.querySelector('[data-screen]')!.textContent = template.dataset[report.screen] ?? '';
        send.disabled = sending;
        send.addEventListener('click', async () => {
          sending = true;
          sync();
          const sent = await reporter.sendPending(report);

          feedback.textContent = feedback.dataset[sent ? 'sent' : 'failed'] ?? '';
          sending = false;
          sync();
        });
        item.querySelector('[data-discard]')!.addEventListener('click', () => {
          close.focus();
          feedback.textContent = '';
          reporter.discard(report);
        });

        return item;
      }),
    );
  }

  close.addEventListener('click', () => dialog.close());
  accept.addEventListener('click', () => consent.decide(true));
  dialog.querySelector('[data-reject]')!.addEventListener('click', () => consent.decide(false));
  dialog.querySelector('[data-purpose-link]')!.addEventListener('click', (event) => {
    event.preventDefault();
    dialog.querySelector<HTMLElement>('#browser-privacy-purpose')!.focus();
  });
  reporter.subscribePending(sync);
  sync();
}

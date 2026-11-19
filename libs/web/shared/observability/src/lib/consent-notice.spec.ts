import { afterEach, expect, it, vi } from 'vitest';

import { browserConsentKey, createBrowserConsent } from './consent';
import { connectConsentNotice, type ConsentNoticeView } from './consent-notice';

function fixture(saved?: string) {
  vi.useFakeTimers();
  const values = new Map(saved ? [[browserConsentKey, saved]] : []);
  const navigator = { globalPrivacyControl: false, doNotTrack: '' };
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
  const browser = Object.assign(new EventTarget(), {
    localStorage,
    navigator,
    crypto,
    performance: { now: () => Date.now() },
    setTimeout,
    clearTimeout,
  }) as unknown as Window;
  const consent = createBrowserConsent(browser);
  const render = vi.fn<(view: ConsentNoticeView) => void>();
  const notice = connectConsentNotice(browser, consent, render);

  return { browser, consent, localStorage, navigator, notice, render };
}

afterEach(() => vi.useRealTimers());

it('replaces a local grant for exactly ten seconds without modifying the saved grant on dismissal', () => {
  const { consent, notice, render } = fixture();

  expect(render).toHaveBeenLastCalledWith({ kind: 'choice', blocked: false, decided: false });
  notice.choose(false);
  expect(render).toHaveBeenLastCalledWith({ kind: 'choice', blocked: false, decided: true });
  notice.choose(true);
  const grant = consent.permit();

  expect(grant).toMatch(/^accept:/);
  expect(render).toHaveBeenLastCalledWith({ kind: 'confirmation', seconds: 10 });
  vi.advanceTimersByTime(9_999);
  expect(render).toHaveBeenLastCalledWith({ kind: 'confirmation', seconds: 1 });
  vi.advanceTimersByTime(1);
  expect(render).toHaveBeenLastCalledWith({ kind: 'hidden' });
  expect(consent.permit()).toBe(grant);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not show feedback for a saved grant, cross-tab grant or blocked local attempt', () => {
  const saved = fixture('accept:1-2-3-4');

  expect(saved.render).toHaveBeenCalledExactlyOnceWith({ kind: 'hidden' });
  saved.notice.destroy();
  const { browser, consent, localStorage, navigator, notice, render } = fixture();

  navigator.globalPrivacyControl = true;
  browser.dispatchEvent(new Event('focus'));
  notice.choose(true);
  expect(render).toHaveBeenLastCalledWith({ kind: 'choice', blocked: true, decided: false });
  expect(consent.permit()).toBeUndefined();
  navigator.globalPrivacyControl = false;
  localStorage.setItem(browserConsentKey, 'accept:1-2-3-4');
  browser.dispatchEvent(Object.assign(new Event('storage'), { key: browserConsentKey }));
  expect(render).toHaveBeenLastCalledWith({ kind: 'hidden' });
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['revoke', 'DNT', 'pagehide', 'navigate', 'destroy'])('clears an active timer on %s', (change) => {
  const { browser, consent, localStorage, navigator, notice, render } = fixture();

  notice.choose(true);
  expect(vi.getTimerCount()).toBe(1);

  switch (change) {
    case 'revoke':
      localStorage.setItem(browserConsentKey, 'reject');
      browser.dispatchEvent(Object.assign(new Event('storage'), { key: browserConsentKey }));
      break;
    case 'DNT':
      navigator.doNotTrack = '1';
      browser.dispatchEvent(new Event('focus'));
      break;
    case 'pagehide':
      browser.dispatchEvent(new Event('pagehide'));
      browser.dispatchEvent(new Event('pageshow'));
      break;
    case 'navigate':
      notice.dismiss();
      break;
    case 'destroy':
      notice.destroy();
      consent.decide(false);
      break;
  }

  if (change !== 'destroy') {
    expect(render).toHaveBeenLastCalledWith({ kind: 'hidden' });
  }

  expect(vi.getTimerCount()).toBe(0);
  const calls = render.mock.calls.length;

  vi.advanceTimersByTime(10_000);
  expect(render).toHaveBeenCalledTimes(calls);
});

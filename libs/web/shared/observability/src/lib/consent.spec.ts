import { expect, it, vi } from 'vitest';

import { browserConsentKey, createBrowserConsent } from './consent';

function fixture() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
  const navigator = { doNotTrack: '', globalPrivacyControl: false };
  const browser = Object.assign(new EventTarget(), { localStorage, navigator, crypto });

  return { browser, localStorage, navigator, consent: createBrowserConsent(browser as unknown as Window) };
}

it('shares an explicit decision with new documents and invalidates the old grant on re-acceptance', () => {
  const { browser, consent, localStorage } = fixture();
  const changed = vi.fn();

  consent.subscribe(changed);
  expect(consent.permit()).toBeUndefined();
  consent.decide(false);
  expect(consent.permit()).toBeUndefined();
  consent.decide(true);

  const first = consent.permit();
  const other = createBrowserConsent(browser as unknown as Window);

  expect(first).toBeTruthy();
  expect(other.permit()).toBe(first);
  other.decide(false);
  expect(consent.permit()).toBeUndefined();
  other.decide(true);
  expect(consent.permit()).not.toBe(first);
  browser.dispatchEvent(Object.assign(new Event('storage'), { key: browserConsentKey }));
  expect(changed).toHaveBeenCalledTimes(3);
  expect(localStorage.getItem(browserConsentKey)).toBe(consent.permit());

  other.stop();
  consent.stop();
});

it('gives either privacy signal precedence even with a persisted opt-in', () => {
  const { consent, navigator, localStorage } = fixture();

  consent.decide(true);
  navigator.globalPrivacyControl = true;
  expect(consent.permit()).toBeUndefined();
  consent.decide(true);
  expect(localStorage.setItem).toHaveBeenCalledOnce();
  navigator.globalPrivacyControl = false;
  navigator.doNotTrack = '1';
  expect(consent.permit()).toBeUndefined();
  consent.decide(false);
  navigator.doNotTrack = '';
  expect(consent.permit()).toBeUndefined();

  consent.stop();
});

it('fails closed when storage cannot be read or a revocation cannot be written', () => {
  const { consent, localStorage } = fixture();

  consent.decide(true);
  localStorage.getItem.mockImplementationOnce(() => {
    throw new Error('synthetic storage unavailable');
  });
  expect(consent.permit()).toBeUndefined();
  localStorage.setItem.mockImplementationOnce(() => {
    throw new Error('synthetic storage unavailable');
  });
  consent.decide(false);
  expect(consent.permit()).toBeUndefined();
  consent.stop();
});

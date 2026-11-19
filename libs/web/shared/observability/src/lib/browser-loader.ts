export { createBrowserConsent } from './consent';
export { connectConsentNotice } from './consent-notice';
export type { BrowserErrorReport } from './contract';
export { describeBrowserError, type UnhandledErrorCode } from './error-description';

export function loadBrowserReporter() {
  return import('./site-reporting');
}

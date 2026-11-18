export { createBrowserConsent } from './consent';
export type { BrowserErrorReport } from './contract';
export { describeBrowserError, type UnhandledErrorCode } from './error-description';
export { createPendingReports } from './pending-reports';

export function loadBrowserReporter() {
  return import('./site-reporting');
}

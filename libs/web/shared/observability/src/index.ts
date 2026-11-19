export * from './lib/visits';
export * from './lib/contract';
export { browserLocation, createBrowserReporter } from './lib/browser';
export {
  browserErrorKind,
  browserScreen,
  describeBrowserError,
  type UnhandledErrorCode,
} from './lib/error-description';
export { browserConsentKey, createBrowserConsent, type BrowserConsent } from './lib/consent';
export { consentConfirmationSeconds, type ConsentNoticeView } from './lib/consent-notice';
export { browserPrivacyCopy } from './lib/privacy-copy';

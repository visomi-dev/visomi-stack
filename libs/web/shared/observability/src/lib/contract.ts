export const applications = ['web-site', 'web-app'] as const;
export const browserErrorCodes = [
  'unhandled_exception',
  'unhandled_rejection',
  'request_failed',
  'startup_failed',
] as const;
export const browserErrorKinds = [
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'unknown',
] as const;
export const screens = ['home', 'ui', 'unknown'] as const;

export type BrowserApplication = (typeof applications)[number];
export type BrowserErrorCode = (typeof browserErrorCodes)[number];
export type BrowserErrorKind = (typeof browserErrorKinds)[number];
export type BrowserScreen = (typeof screens)[number];
export type BrowserLocation = { asset: string; line: number; column: number };
export type BrowserErrorReport = {
  application: BrowserApplication;
  code: BrowserErrorCode;
  kind: BrowserErrorKind;
  screen: BrowserScreen;
  location?: BrowserLocation;
  correlation?: string;
};
export type BrowserTelemetryConfig = {
  token: string;
  assets: { path: string; id: string }[];
};

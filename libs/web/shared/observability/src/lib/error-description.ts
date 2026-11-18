import { browserErrorKinds } from './contract';
import type {
  BrowserApplication,
  BrowserErrorCode,
  BrowserErrorKind,
  BrowserErrorReport,
  BrowserScreen,
} from './contract';

export type UnhandledErrorCode = Exclude<BrowserErrorCode, 'request_failed'>;

// Only known page names cross the boundary; paths and navigation history stay in the browser.
export function browserScreen(path: string): BrowserScreen {
  if (/^(?:\/app)?\/(?:en|es)\/?$/.test(path) || /^\/app\/(?:en|es)\/foundations\/?$/.test(path)) {
    return 'home';
  }

  if (/^\/app\/(?:en|es)\/home\/?$/.test(path)) {
    return 'dashboard';
  }

  return /^(?:\/app)?\/(?:en|es)\/ui\/?$/.test(path) ? 'ui' : 'unknown';
}

export function browserErrorKind(error: unknown): BrowserErrorKind {
  try {
    const name = error instanceof Error ? error.name : undefined;

    return browserErrorKinds.find((kind) => kind === name) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function describeBrowserError(
  application: BrowserApplication,
  path: string,
  code: UnhandledErrorCode,
  error: unknown,
): BrowserErrorReport {
  return { application, code, kind: browserErrorKind(error), screen: browserScreen(path) };
}

import type { ServerRoute } from '@angular/ssr';
import { RenderMode } from '@angular/ssr';

// TODO(spec: 2026-06-08-ssr-browser-refactor): prerender anonymous auth pages
// (`/sign-in`, `/sign-up`, `/forgotten-password`) once the `themis.hasSession`
// cookie marker is set by the API on sign-in / sign-up verify and cleared on
// sign-out. The spec defers this until the API contract lands.
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];

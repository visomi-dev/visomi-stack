import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: 'sign-in', renderMode: RenderMode.Prerender },
  { path: 'dashboard', renderMode: RenderMode.Client },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];

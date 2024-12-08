import { RenderMode, ServerRoute } from '@angular/ssr';

import { DASHBOARD_PATH } from './config/routes';

export const serverRoutes: ServerRoute[] = [
  { path: DASHBOARD_PATH, renderMode: RenderMode.Client },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];

import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';

import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { Session } from './auth/session/session';
import { ServerSession } from './auth/session/server-session';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    ServerSession,
    { provide: Session, useExisting: ServerSession },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);

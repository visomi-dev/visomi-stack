import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ErrorHandler, mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';

import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { Session } from './auth/session/session';
import { ServerSession } from './auth/session/server-session';
import { authInterceptor } from './auth/session/interceptor';
import { ServerErrors } from './observability/server-errors';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    ServerSession,
    { provide: Session, useExisting: ServerSession },
    ServerErrors,
    { provide: ErrorHandler, useExisting: ServerErrors },
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);

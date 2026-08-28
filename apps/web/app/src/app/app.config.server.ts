import { ApplicationConfig, REQUEST, REQUEST_CONTEXT, inject, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';

import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { Auth } from './shared/auth/auth';
import { AUTH_REQUEST_CONTEXT, type AuthRequestContext } from './shared/auth/auth-request-context.token';
import { ServerAuth } from './shared/auth/server-auth';
import { Clipboard } from './shared/clipboard/clipboard';
import { ServerClipboard } from './shared/clipboard/server-clipboard';
import { Realtime } from './shared/realtime/realtime';
import { ServerRealtime } from './shared/realtime/server-realtime';
import { ServerSettings } from './shared/server-settings';
import { Settings } from './shared/settings';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    ServerAuth,
    { provide: Auth, useExisting: ServerAuth },
    ServerSettings,
    { provide: Settings, useExisting: ServerSettings },
    ServerRealtime,
    { provide: Realtime, useExisting: ServerRealtime },
    ServerClipboard,
    { provide: Clipboard, useExisting: ServerClipboard },
    {
      provide: AUTH_REQUEST_CONTEXT,
      useFactory: (): AuthRequestContext | null => {
        const context = inject(REQUEST_CONTEXT, { optional: true }) as { user?: AuthRequestContext['user'] } | null;
        const request = inject(REQUEST, { optional: true });

        if (context?.user !== undefined) {
          return { user: context.user };
        }

        const cookieHeader = request?.headers.get('cookie') ?? '';

        if (!cookieHeader.split(';').some((cookie) => cookie.trim().startsWith('connect.sid='))) {
          return { user: null };
        }

        return null;
      },
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);

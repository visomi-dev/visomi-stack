import {
  ApplicationConfig,
  provideExperimentalZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import {
  provideClientHydration,
  withEventReplay,
  withIncrementalHydration,
} from '@angular/platform-browser';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';

import { routes } from './app.routes';
import { apiInterceptor } from './shared/api.interceptor';
import { SeoService } from './shared/seo/seo.service';
import { UIService } from './shared/ui/ui.service';
import { IconsService } from './shared/ui/icon/icon.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    provideRouter(
      routes,
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
      }),
    ),
    provideClientHydration(withIncrementalHydration(), withEventReplay()),
    provideHttpClient(withFetch(), withInterceptors([apiInterceptor])),

    SeoService,
    UIService,
    IconsService,
  ],
};

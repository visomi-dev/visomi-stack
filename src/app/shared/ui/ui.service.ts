import { Injectable, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { filter, from, map } from 'rxjs';
import type { DateTime } from 'luxon';

export type Theme = 'light' | 'dark';

@Injectable({
  providedIn: 'root',
})
export class UIService {
  DateTime: typeof DateTime | null = null;
  dateTimePromise: Promise<typeof DateTime> | null = null;

  private readonly router = inject(Router);

  readonly loading = signal<boolean>(false);
  readonly now = toSignal(
    from(this.getDateTime()).pipe(map((DateTime) => DateTime.now())),
  );
  readonly $DateTime = signal<typeof DateTime | null>(null);

  readonly sidebarMenuOpen = signal<boolean>(false);
  readonly sidebarWorkspaceOpen = signal<boolean>(false);
  readonly navigating = toSignal(
    this.router.events.pipe(
      filter(
        (event) =>
          event instanceof NavigationStart || event instanceof NavigationEnd,
      ),
      map((event) => event instanceof NavigationStart),
    ),
    {
      initialValue: false,
    },
  );
  readonly navigationEnd = toSignal(
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)),
  );

  setLoading(loading: boolean) {
    this.loading.set(loading);
  }

  toggleLoading() {
    this.loading.set(!this.loading());
  }

  async getDateTime() {
    if (this.DateTime != null) {
      return this.DateTime;
    }

    if (this.dateTimePromise != null) {
      return await this.dateTimePromise;
    }

    // file deepcode ignore PromiseNotCaughtGeneral: import is caught
    this.dateTimePromise = import('luxon').then(({ DateTime }) => {
      this.DateTime = DateTime;
      this.$DateTime.set(DateTime);

      return DateTime;
    });

    return await this.dateTimePromise;
  }

  constructor() {
    this.getDateTime();
  }
}

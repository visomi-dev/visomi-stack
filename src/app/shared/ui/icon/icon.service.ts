import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class IconsService {
  readonly paths = signal(new Map<string, string[]>());

  constructor() {
    // file deepcode ignore PromiseNotCaughtGeneral: promise is caught
    import('./paths').then(({ paths }) => {
      this.paths.set(new Map(Object.entries(paths)));
    });
  }
}

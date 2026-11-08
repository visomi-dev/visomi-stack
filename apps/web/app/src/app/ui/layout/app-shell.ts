import { Location } from '@angular/common';
import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';

import { appShell, type ShellLayout } from '@visomi-stack/web-frontend-ui';

@Component({
  selector: 'app-shell',
  template: `
    <a [href]="skipHref()" [class]="skipClasses">{{ skipLabel() }}</a>

    <div [class]="frameClasses()">
      <div [class]="sidebarClasses()"><ng-content select="app-sidebar,[data-shell-sidebar]" /></div>

      <div class="min-w-0">
        <div [class]="headerClasses"><ng-content select="[app-topbar],[data-shell-header]" /></div>

        <main [id]="contentId()" tabindex="-1" [class]="contentClasses"><ng-content /></main>

        <ng-content select="[data-shell-footer]" />
      </div>
    </div>

    <div [class]="mobileClasses">
      <ng-content select="[appUI=navbar],[data-shell-mobile]" />
    </div>
  `,
  host: { '[class]': 'classes' },
})
export class AppShell {
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);

  readonly contentId = input.required<string>({ alias: 'content-id' });
  readonly skipLabel = input.required<string>({ alias: 'skip-label' });
  readonly layout = input<ShellLayout>('sidebar');

  private readonly path = signal(this.location.path());

  protected readonly frameClasses = computed(() => appShell.frameClasses({ layout: this.layout() }));
  protected readonly sidebarClasses = computed(() => appShell.sidebarClasses({ layout: this.layout() }));
  protected readonly skipHref = computed(() => {
    // A bare fragment resolves against the localized base, not the current routed page.
    return this.location.prepareExternalUrl(this.path() + '#' + this.contentId());
  });

  protected readonly classes = appShell.classes();
  protected readonly skipClasses = appShell.skipClasses();
  protected readonly contentClasses = appShell.contentClasses();
  protected readonly headerClasses = appShell.headerClasses();
  protected readonly mobileClasses = appShell.mobileClasses();

  constructor() {
    const unsubscribe = this.location.onUrlChange(() => this.path.set(this.location.path()));

    this.destroyRef.onDestroy(unsubscribe);
  }
}

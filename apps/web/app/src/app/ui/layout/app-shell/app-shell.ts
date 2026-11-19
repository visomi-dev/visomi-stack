import { Location } from '@angular/common';
import { Component, booleanAttribute, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';

import { appShell, type ShellLayout } from '@visomi-stack/web-frontend-ui';

@Component({
  selector: 'app-shell',
  template: `
    <a [href]="skipHref()" [class]="skipClasses">{{ skipLabel() }}</a>

    <div [class]="frameClasses()">
      <div [class]="sidebarClasses()"><ng-content select="app-sidebar,[data-shell-sidebar]" /></div>

      <div [class]="panelClasses()" data-slot="shell-panel">
        <div [class]="headerClasses"><ng-content select="[app-topbar],[data-shell-header]" /></div>

        <main data-slot="page-scroll" [id]="contentId()" tabindex="-1" [class]="scrollClasses">
          <div data-slot="page-content" [class]="contentClasses"><ng-content /></div>
        </main>

        <ng-content select="[data-shell-footer]" />
      </div>
    </div>

    <div [class]="mobileClasses">
      <ng-content select="[appUI=navbar],[data-shell-mobile]" />
    </div>
  `,
  host: { '[class]': 'classes()' },
})
export class AppShell {
  private readonly location = inject(Location);

  private readonly path = toSignal(
    new Observable<string>((subscriber) => this.location.onUrlChange(() => subscriber.next(this.location.path()))),
    { initialValue: this.location.path() },
  );

  readonly inset = input(false, { transform: booleanAttribute });

  protected readonly panelClasses = computed(() => appShell.panelClasses(this.inset()));

  readonly layout = input<ShellLayout>('sidebar');

  protected readonly frameClasses = computed(() => appShell.frameClasses({ layout: this.layout() }));
  protected readonly sidebarClasses = computed(() => appShell.sidebarClasses({ layout: this.layout() }));

  readonly contentId = input.required<string>({ alias: 'content-id' });

  protected readonly skipHref = computed(() => {
    // A bare fragment resolves against the localized base, not the current routed page.
    return this.location.prepareExternalUrl(this.path() + '#' + this.contentId());
  });

  readonly sidebarCompact = input(false, { alias: 'sidebar-compact', transform: booleanAttribute });
  protected readonly classes = computed(() =>
    appShell.classes({ inset: this.inset(), compact: this.sidebarCompact() }),
  );

  protected readonly skipClasses = appShell.skipClasses();
  protected readonly scrollClasses = appShell.scrollClasses();
  protected readonly contentClasses = appShell.contentClasses();
  protected readonly headerClasses = appShell.headerClasses();
  protected readonly mobileClasses = appShell.mobileClasses();

  readonly skipLabel = input.required<string>({ alias: 'skip-label' });
}

import { DestroyRef, Directive, inject, TemplateRef, ViewContainerRef } from '@angular/core';

import { PageTitles } from './page-titles';

@Directive({ selector: '[appPageTitle]' })
export class PageTitle {
  private readonly titles = inject(PageTitles, { optional: true });
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    if (this.titles) this.destroyRef.onDestroy(this.titles.attach(this.template));
    else this.container.createEmbeddedView(this.template);
  }
}

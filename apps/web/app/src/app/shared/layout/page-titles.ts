import { Injectable, signal } from '@angular/core';
import type { TemplateRef } from '@angular/core';

/** Layout-local title custody; route templates retain their bindings and translations. */
@Injectable()
export class PageTitles {
  private readonly current = signal<TemplateRef<unknown> | null>(null);

  readonly template = this.current.asReadonly();

  attach(template: TemplateRef<unknown>): () => void {
    this.current.set(template);

    return () => {
      if (this.current() === template) this.current.set(null);
    };
  }
}

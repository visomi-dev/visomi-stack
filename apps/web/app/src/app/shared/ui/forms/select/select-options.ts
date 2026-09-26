import { Directive, inject, TemplateRef } from '@angular/core';

@Directive({ selector: 'ng-template[appSelectOptions]' })
export class SelectOptions {
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

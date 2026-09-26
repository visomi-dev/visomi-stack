import { Directive, inject, TemplateRef } from '@angular/core';

import type { RadioOption } from './radio-group';

export type RadioOptionTemplateContext = {
  $implicit: RadioOption;
  descriptionId: string;
  index: number;
  labelId: string;
  selected: boolean;
};

@Directive({ selector: 'ng-template[appRadioOption]' })
export class RadioOptionTemplate {
  readonly template = inject<TemplateRef<RadioOptionTemplateContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: RadioOptionTemplate,
    _context: unknown,
  ): _context is RadioOptionTemplateContext {
    return true;
  }
}

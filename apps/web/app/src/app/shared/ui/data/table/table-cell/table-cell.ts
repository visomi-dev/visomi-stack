import { Directive, inject, input, TemplateRef } from '@angular/core';

export type TableCellContext<T> = {
  $implicit: T;
  column: TableColumn<T>;
  row: T;
};

export type TableColumn<T> = {
  class?: string;
  key: Extract<keyof T, string>;
  label: string;
};

@Directive({
  selector: 'ng-template[appTableCell]',
})
export class TableCell<T = Record<string, unknown>> {
  readonly appTableCell = input.required<Extract<keyof T, string>>();
  readonly template = inject<TemplateRef<TableCellContext<T>>>(TemplateRef);
}

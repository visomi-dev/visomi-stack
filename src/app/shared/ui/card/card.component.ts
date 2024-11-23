import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [],
  template: `
    <div
      [id]="id"
      class="flex flex-col gap-4 rounded-md border border-white bg-white p-5 dark:border-slate-600 dark:bg-transparent"
    >
      <ng-content />
    </div>
  `,
  styles: [],
})
export class CardComponent {
  @Input() id?: string | number;
}

import { booleanAttribute, Component, computed, input } from '@angular/core';

@Component({
  host: {
    class: /* tw */ 'contents',
  },
  selector: 'app-page-loader',
  templateUrl: './page-loader.html',
  styleUrl: './page-loader.css',
})
export class PageLoader {
  readonly loading = input(false, { transform: booleanAttribute });
  readonly navigating = input(false, { transform: booleanAttribute });

  readonly visible = computed(() => this.loading() || this.navigating());
}

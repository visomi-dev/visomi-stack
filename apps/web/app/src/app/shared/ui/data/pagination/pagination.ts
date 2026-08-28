import { Component, computed, input, output } from '@angular/core';

@Component({
  host: { class: /* tw */ 'block' },
  selector: 'app-pagination',
  templateUrl: './pagination.html',
  styleUrl: './pagination.css',
})
export class Pagination {
  readonly page = input(1);
  readonly pageSize = input(10);
  readonly total = input(0);
  readonly pageChange = output<number>();

  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly canGoPrevious = computed(() => this.page() > 1);
  readonly canGoNext = computed(() => this.page() < this.pageCount());

  goToPage(page: number): void {
    if (page >= 1 && page <= this.pageCount()) {
      this.pageChange.emit(page);
    }
  }
}

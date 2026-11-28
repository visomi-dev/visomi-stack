import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, input, linkedSignal, signal } from '@angular/core';

import {
  Avatar,
  Badge,
  Button,
  Card,
  DescriptionList,
  Field,
  Fieldset,
  Heading,
  Input,
  InputGroup,
  Label,
  Pagination,
  Radio,
  RadioCard,
  Select,
  Table,
  Text,
  Toggle,
} from '../../ui';
import type { CheckBatch, CheckType } from '../sample-checks';

const pageSize = 5;

@Component({
  selector: 'app-check-batches',
  imports: [
    Avatar,
    Badge,
    Button,
    Card,
    DatePipe,
    DecimalPipe,
    DescriptionList,
    Field,
    Fieldset,
    Heading,
    Input,
    InputGroup,
    Label,
    Pagination,
    Radio,
    RadioCard,
    Select,
    Table,
    Text,
    Toggle,
  ],
  host: { class: 'block min-w-0' },
  templateUrl: './check-batches.html',
})
export class CheckBatches {
  protected readonly type = signal('all');
  protected readonly query = signal('');
  protected readonly onlyFailures = signal(false);
  protected readonly newestFirst = signal(true);

  readonly batches = input.required<readonly CheckBatch[]>();
  protected readonly filteredBatches = computed(() => {
    const type = this.type();
    const query = this.query().trim().toUpperCase();
    const onlyFailures = this.onlyFailures();
    const direction = this.newestFirst() ? -1 : 1;

    return this.batches()
      .filter(
        (batch) =>
          (type === 'all' || batch.type === type) && (!onlyFailures || batch.failed > 0) && batch.id.includes(query),
      )
      .sort((first, second) => direction * first.day.localeCompare(second.day));
  });
  protected readonly page = linkedSignal({ source: this.filteredBatches, computation: () => 1 });

  protected readonly visibleBatches = computed(() => {
    const start = (this.page() - 1) * pageSize;

    return this.filteredBatches().slice(start, start + pageSize);
  });

  protected readonly selectedBatchId = linkedSignal({
    source: this.visibleBatches,
    computation: (): string | null => null,
  });

  protected readonly pageCount = computed(() => Math.ceil(this.filteredBatches().length / pageSize));

  protected readonly typeLabels: Record<CheckType, string> = {
    availability: $localize`:@@exampleCheckAvailability:Availability`,
    'response-time': $localize`:@@exampleCheckResponseTime:Response time`,
    certificate: $localize`:@@exampleCheckCertificate:Certificate`,
  };
  protected readonly checkTypes = Object.keys(this.typeLabels) as CheckType[];

  protected changePage(offset: -1 | 1): void {
    const page = this.page() + offset;

    if (page >= 1 && page <= this.pageCount()) {
      this.page.set(page);
    }
  }
}

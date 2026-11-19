import { Component, computed, input } from '@angular/core';

import { Card } from '../../layout/card';
import { Text } from '../../typography/text';

import { lineChart } from '@visomi-stack/web-frontend-ui';

@Component({
  selector: 'app-line-chart',
  imports: [Card, Text],
  host: { class: 'block min-w-0' },
  templateUrl: './line-chart.html',
})
export class LineChart {
  readonly values = input.required<readonly number[]>();
  protected readonly points = computed(() => lineChart.points(this.values()));
  protected readonly coordinates = computed(() =>
    this.points()
      .map(({ x, y }) => x + ',' + y)
      .join(' '),
  );

  protected readonly styles = lineChart;

  readonly labelledBy = input.required<string>({ alias: 'labelled-by' });
  readonly describedBy = input.required<string>({ alias: 'described-by' });
  readonly startLabel = input<string | null>(null, { alias: 'start-label' });
  readonly endLabel = input<string | null>(null, { alias: 'end-label' });
}

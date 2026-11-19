import { describe, expect, it } from 'vitest';

import { lineChart } from './line-chart';

describe('line chart geometry', () => {
  it('scales caller-provided values across the plot, including negatives', () => {
    expect(lineChart.points([-10, 0, 10])).toEqual([
      { x: 16, y: 108 },
      { x: 240, y: 62 },
      { x: 464, y: 16 },
    ]);
  });

  it('centers one point and handles an all-zero, empty, or invalid series', () => {
    expect(lineChart.points([0])).toEqual([{ x: 240, y: 108 }]);
    expect(lineChart.points([0, 0])).toEqual([
      { x: 16, y: 108 },
      { x: 464, y: 108 },
    ]);
    expect(lineChart.points([])).toEqual([]);
    expect(lineChart.points([1, NaN])).toEqual([]);
  });
});

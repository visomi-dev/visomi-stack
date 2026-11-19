const plot = { width: 480, height: 120, left: 16, right: 464, top: 16, bottom: 108 };

export const lineChart = {
  viewBox: `0 0 ${plot.width} ${plot.height}`,
  classes(): string {
    return 'h-36 w-full sm:h-44';
  },
  gridClasses: 'stroke-zinc-200 dark:stroke-zinc-700',
  seriesClasses: 'stroke-blue-700 dark:stroke-blue-400',
  pointClasses: 'fill-blue-700 dark:fill-blue-400',
  gridPath: Array.from({ length: 4 }, (_, index) => {
    const y = plot.top + Math.round(((plot.bottom - plot.top) * index) / 3);

    return `M${plot.left} ${y}H${plot.right}`;
  }).join(''),
  points(values: readonly number[]): { x: number; y: number }[] {
    if (!values.every(Number.isFinite)) {
      return [];
    }

    const low = values.reduce((min, value) => Math.min(min, value), 0);
    const high = values.reduce((max, value) => Math.max(max, value), 0);
    const scale = Math.max(Math.abs(low), high, 1);
    const minimum = low / scale;
    const range = high / scale - minimum || 1;
    const width = plot.right - plot.left;

    return values.map((value, index) => ({
      x: plot.left + (values.length === 1 ? width / 2 : (index * width) / (values.length - 1)),
      y: plot.bottom - ((value / scale - minimum) * (plot.bottom - plot.top)) / range,
    }));
  },
} as const;

const checkTypes = ['availability', 'response-time', 'certificate'] as const;

export type CheckType = (typeof checkTypes)[number];

export type CheckBatch = {
  readonly id: string;
  readonly day: string;
  readonly type: CheckType;
  readonly passed: number;
  readonly failed: number;
};

// Fixed counts of passed and failed checks, in checkTypes order, for October 1–14.
const sampleCounts = [
  [
    [9, 2],
    [6, 1],
    [3, 0],
  ],
  [
    [13, 1],
    [9, 0],
    [3, 0],
  ],
  [
    [11, 1],
    [8, 3],
    [3, 0],
  ],
  [
    [18, 0],
    [12, 2],
    [4, 0],
  ],
  [
    [16, 2],
    [11, 1],
    [4, 0],
  ],
  [
    [8, 0],
    [5, 1],
    [3, 0],
  ],
  [
    [10, 1],
    [8, 1],
    [3, 0],
  ],
  [
    [14, 1],
    [9, 0],
    [4, 0],
  ],
  [
    [18, 2],
    [13, 0],
    [4, 0],
  ],
  [
    [15, 1],
    [10, 2],
    [4, 0],
  ],
  [
    [23, 0],
    [15, 1],
    [5, 0],
  ],
  [
    [19, 1],
    [12, 1],
    [5, 0],
  ],
  [
    [12, 0],
    [7, 1],
    [3, 0],
  ],
  [
    [17, 2],
    [11, 0],
    [4, 0],
  ],
] as const;

export const sampleDays = sampleCounts.map((counts, index) => {
  const day = '2026-10-' + String(index + 1).padStart(2, '0');
  const batches: CheckBatch[] = checkTypes.map((type, batchIndex) => {
    const [passed, failed] = counts[batchIndex];
    const batchNumber = index * checkTypes.length + batchIndex + 1;

    return { id: 'DEMO-' + String(batchNumber).padStart(3, '0'), day, type, passed, failed };
  });
  const passed = batches.reduce((sum, batch) => sum + batch.passed, 0);
  const failed = batches.reduce((sum, batch) => sum + batch.failed, 0);

  return { day, passed, failed, total: passed + failed, batches };
});

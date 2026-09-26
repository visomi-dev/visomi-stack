import { z } from 'zod';

import { processProjectSeedJob } from 'projects';

const inputSchema = z.strictObject({
  accountId: z.uuid(),
  jobId: z.uuid(),
  projectId: z.uuid(),
  userId: z.uuid(),
});

export function parseProjectJob(data: unknown) {
  const result = inputSchema.safeParse(data);

  if (!result.success) throw new Error('Invalid project seed job input.');

  return result.data;
}

export async function processObservedProjectJob(data: unknown) {
  return processProjectSeedJob({ data: parseProjectJob(data) });
}

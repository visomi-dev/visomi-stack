import { config } from 'dotenv';

import { environmentSchema } from './environment-schema';

function getEnv({ filePath }: { filePath?: string } = {}) {
  config({ path: filePath });

  return environmentSchema.parse(process.env);
}

const env = getEnv();

export { env, getEnv };

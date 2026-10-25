import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readTelemetry(directory = process.env.VISOMI_E2E_TELEMETRY_DIR) {
  if (!directory) {
    throw new Error('Missing isolated telemetry directory');
  }

  const read = async (file: string): Promise<Record<string, unknown>[]> => {
    try {
      const text = await readFile(join(directory, file), 'utf8');

      return text
        .trim()
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => JSON.parse(line));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  };
  const [logs, spans, metrics, pending] = await Promise.all([
    read('logs.jsonl'),
    read('spans.jsonl'),
    read('metrics.jsonl'),
    read('pending.jsonl'),
  ]);

  return { logs, spans, metrics, pending };
}

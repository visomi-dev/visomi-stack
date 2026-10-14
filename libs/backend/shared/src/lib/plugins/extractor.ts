import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { z } from 'zod';

const exec = promisify(execFile);
const engine = z.enum(['docker', 'podman']);

/** Operator-selected local images only; plugin metadata cannot request ambient authority. */
export const extractorManifest = z.strictObject({
  version: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  image: z.string().regex(/^(?:[a-z0-9][a-z0-9./:_-]*@)?sha256:[a-f0-9]{64}$/),
  network: z.literal('none'),
  secrets: z.array(z.never()).max(0),
});
export type ExtractorManifest = z.infer<typeof extractorManifest>;
export type ExtractorOptions<T> = {
  /** Explicit trusted caller choice, never taken from the plugin manifest. */
  engine: z.infer<typeof engine>;
  /** Optional operator-approved local Unix socket for rootless Docker. */
  dockerSocket?: string;
  parseResult: (value: unknown) => T;
  signal?: AbortSignal;
};

export function extractorArguments(manifest: ExtractorManifest, name: string): string[] {
  return [
    'run',
    '--pull=never',
    '--name',
    name,
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit=64',
    '--memory=256m',
    '--cpus=1',
    '--user=65534:65534',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
    '-i',
    manifest.image,
  ];
}

async function removeOwnedExtractor(
  selectedEngine: z.infer<typeof engine>,
  connection: string,
  name: string,
): Promise<void> {
  // Podman otherwise waits ten seconds before killing PID 1, exhausting the cleanup deadline.
  const stopArguments = selectedEngine === 'podman' ? ['--time=0', '--ignore'] : [];

  try {
    await exec(selectedEngine, [connection, 'rm', '-f', ...stopArguments, name], {
      timeout: 10_000,
      maxBuffer: 4096,
    });
  } catch {
    throw new Error('plugin_cleanup_failed');
  }
}

/**
 * Runs one selected document without host mounts or passed-through environment.
 * Container isolation is a defense in depth, not an authorization mechanism.
 * The trusted caller owns image approval, selected bytes and result validation.
 */
export async function runExtractor<T>(input: unknown, bytes: Uint8Array, options: ExtractorOptions<T>): Promise<T> {
  const parsed = extractorManifest.safeParse(input);
  const selectedEngine = engine.safeParse(options.engine);

  if (!parsed.success || !selectedEngine.success) {
    throw new Error('plugin_manifest_invalid');
  }
  const socket = z
    .string()
    .regex(/^\/[A-Za-z0-9/_.-]+$/)
    .max(1024)
    .safeParse(options.dockerSocket ?? '/var/run/docker.sock');

  if (!socket.success) {
    throw new Error('plugin_manifest_invalid');
  }
  // Explicit connection flags override ambient remote-daemon/context selection before sending document bytes.
  const connection = selectedEngine.data === 'podman' ? '--remote=false' : `--host=unix://${socket.data}`;

  if (!bytes.length || bytes.length > 1_048_576) {
    throw new Error('plugin_input_limit');
  }
  if (options.signal?.aborted) {
    throw new Error('plugin_cancelled');
  }
  try {
    await exec(selectedEngine.data, [connection, 'version', '--format', '{{.Server.Version}}'], {
      timeout: 10_000,
      maxBuffer: 4096,
    });
  } catch {
    throw new Error('plugin_unavailable');
  }
  if (options.signal?.aborted) {
    throw new Error('plugin_cancelled');
  }
  const name = `visomi-extractor-${randomUUID()}`;

  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(selectedEngine.data, [connection, ...extractorArguments(parsed.data, name)], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const chunks: Buffer[] = [];
      let outputBytes = 0;
      let errorBytes = 0;
      let failure: string | undefined;
      const fail = (code: string) => {
        failure ??= code;
        child.kill('SIGKILL');
      };
      const cancel = () => fail('plugin_cancelled');
      const timer = setTimeout(() => fail('plugin_timeout'), 30_000);
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancel);
        for (const chunk of chunks) {
          chunk.fill(0);
        }
      };

      child.once('error', () => {
        cleanup();
        reject(new Error('plugin_unavailable'));
      });
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > 64_000) {
          fail('plugin_output_limit');

          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      child.stderr.on('data', (chunk: Buffer) => {
        errorBytes += chunk.length;
        if (errorBytes > 64_000) {
          fail('plugin_output_limit');
        }
      });
      child.stdin.on('error', () => {
        // Owned process close supplies the bounded failure; never expose stderr.
      });
      child.once('close', (code) => {
        if (failure || code !== 0) {
          cleanup();
          reject(new Error(failure ?? 'plugin_failed'));

          return;
        }
        const combined = Buffer.concat(chunks);

        try {
          resolve(new TextDecoder('utf-8', { fatal: true }).decode(combined));
        } catch {
          reject(new Error('plugin_invalid_output'));
        } finally {
          combined.fill(0);
          cleanup();
        }
      });
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) {
        cancel();
      } else {
        child.stdin.end(JSON.stringify({ version: 1, document: Buffer.from(bytes).toString('base64') }));
      }
    });

    try {
      const value: unknown = JSON.parse(output);

      return options.parseResult(value);
    } catch {
      throw new Error('plugin_invalid_output');
    }
  } finally {
    // Only this invocation's generated container may be removed, including after cancellation.
    await removeOwnedExtractor(selectedEngine.data, connection, name);
  }
}

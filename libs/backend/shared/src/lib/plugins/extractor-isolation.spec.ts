import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod';

import { runExtractor } from './extractor';

const exec = promisify(execFile);
const image = process.env.EXTRACTOR_ISOLATION_IMAGE;
const isolation = image ? describe : describe.skip;
const manifest = { version: 1, id: 'isolation-fixture', image, network: 'none', secrets: [] };
const fixtureResult = z.strictObject({
  uid: z.literal(65534),
  rootWriteDenied: z.literal(true),
  tmpWritable: z.literal(true),
  interfaces: z.array(z.literal('lo')),
  capabilities: z.string().regex(/^0+$/),
  ambientSecret: z.null(),
  document: z.literal('selected-document'),
});

// Explicit local image opt-in; ordinary shared tests never start a container or pull an image.
isolation('extractor isolation with an operator-selected Podman fixture', () => {
  let existingContainers: string[] = [];
  const listContainers = async () => {
    const result = await exec(
      'podman',
      ['--remote=false', 'ps', '-a', '--filter', `ancestor=${image}`, '--format', '{{.Names}}'],
      { timeout: 10_000, maxBuffer: 4096 },
    );

    return result.stdout.split('\n').filter(Boolean).sort();
  };

  beforeAll(async () => {
    const containers = await listContainers();

    existingContainers = containers;
  });
  it('enforces real UID, capabilities, root filesystem, network and no-secret boundaries', async () => {
    const previous = process.env.EXTRACTOR_AMBIENT_SECRET;

    process.env.EXTRACTOR_AMBIENT_SECRET = 'must-not-enter-the-container';
    try {
      const result = await runExtractor(manifest, new TextEncoder().encode('selected-document'), {
        engine: 'podman',
        parseResult: (value) => fixtureResult.parse(value),
      });

      expect(result.document).toBe('selected-document');
    } finally {
      if (previous === undefined) {
        delete process.env.EXTRACTOR_AMBIENT_SECRET;
      } else {
        process.env.EXTRACTOR_AMBIENT_SECRET = previous;
      }
    }
  }, 30_000);

  it('bounds real output and cleans up the overflowing container', async () => {
    await expect(
      runExtractor(manifest, new TextEncoder().encode('overflow'), {
        engine: 'podman',
        parseResult: (value) => value,
      }),
    ).rejects.toThrow('plugin_output_limit');
  }, 30_000);

  it('cancels stalled real work and waits for its container removal', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    try {
      await expect(
        runExtractor(manifest, new TextEncoder().encode('stall'), {
          engine: 'podman',
          signal: controller.signal,
          parseResult: (value) => value,
        }),
      ).rejects.toThrow('plugin_cancelled');
    } finally {
      clearTimeout(timer);
    }
  }, 30_000);

  afterAll(async () => {
    const containers = await listContainers();

    // Existing containers are outside this fixture's ownership and must be preserved.
    expect(containers).toEqual(existingContainers);
  });
});

import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { installDistribution, inspectDistribution } from './distribution';

describe('agent distribution', () => {
  const sourceRoot = path.resolve(__dirname, '../../..');

  it('resolves the core profile from the repository facade', async () => {
    const result = await inspectDistribution(sourceRoot, 'core');

    expect(result.errors).toEqual([]);
    expect(result.profile.agents).toContain('themis-coordinator');
    expect(result.profile.skills).toBe('all');
    expect(result.profile.tools).toContain('themis');
  });

  it('resolves all skills in the full profile', async () => {
    const result = await inspectDistribution(sourceRoot, 'full');

    expect(result.errors).toEqual([]);
    expect(result.profile.skills).toBe('all');
  });

  it('installs a profile and writes a lockfile', async () => {
    const destinationRoot = await mkdtemp(path.join(os.tmpdir(), 'themis-agent-cli-'));

    try {
      const entry = await installDistribution(destinationRoot, sourceRoot, 'core', 'opencode', sourceRoot, 'local');

      await access(path.join(destinationRoot, '.opencode', 'agents', 'themis-coordinator.md'));
      await access(path.join(destinationRoot, '.opencode', 'skills', 'themis-work-item', 'SKILL.md'));
      expect(entry.runtime).toBe('opencode');

      const lockfile = JSON.parse(
        await readFile(path.join(destinationRoot, '.themis', 'agents.lock.json'), 'utf8'),
      ) as { packages: Record<string, { profile: string }> };

      expect(lockfile.packages['@visomi/visomi-stack'].profile).toBe('core');
    } finally {
      await rm(destinationRoot, { recursive: true, force: true });
    }
  });
});

import { execFile } from 'node:child_process';
import { access, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  loadManifest,
  resolveProfile,
  type DistributionManifest,
  type ResolvedProfile,
  type ResourceKind,
} from './manifest';

const execFileAsync = promisify(execFile);
const defaultRepository = 'https://github.com/visomi-dev/visomi-stack.git';

export type Runtime = 'opencode';

export type AddOptions = {
  profile: string;
  runtime: Runtime;
  ref: string;
  source?: string;
  force: boolean;
};

export type Lockfile = {
  format: 1;
  packages: Record<
    string,
    {
      alias: string;
      repository: string;
      ref: string;
      commit: string;
      profile: string;
      runtime: Runtime;
      scope: 'project';
      resources: ResolvedProfile;
    }
  >;
};

export async function locateSource(
  source?: string,
  ref = 'main',
): Promise<{ root: string; cleanup: () => Promise<void>; repository: string; ref: string }> {
  if (source) {
    const root = path.resolve(source);

    await access(path.join(root, '.opencode', 'manifest.yml'));

    return { root, cleanup: async () => undefined, repository: root, ref: 'local' };
  }

  const localRoot = await findLocalSource(process.cwd());

  if (localRoot) {
    return { root: localRoot, cleanup: async () => undefined, repository: localRoot, ref: 'local' };
  }

  const temporaryRoot = await createTemporaryClone(defaultRepository, ref);

  return {
    root: temporaryRoot,
    cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
    repository: defaultRepository,
    ref,
  };
}

export async function inspectDistribution(
  root: string,
  profileName: string,
): Promise<{
  manifest: DistributionManifest;
  profile: ResolvedProfile;
  errors: string[];
}> {
  const manifest = await loadManifest(root);
  const profile = resolveProfile(manifest, profileName);
  const errors: string[] = [];

  for (const kind of ['agents', 'commands', 'skills', 'tools'] as ResourceKind[]) {
    const names = profile[kind];

    if (names === 'all') {
      continue;
    }

    for (const name of names) {
      const extension = kind === 'skills' ? '' : kind === 'tools' ? '.ts' : '.md';
      const resourcePath = path.join(root, '.opencode', kind, `${name}${extension}`);

      try {
        const stats = await lstat(resourcePath);

        if (kind === 'skills' && !stats.isDirectory()) {
          errors.push(`skills/${name} must be a directory`);
        }

        await realpath(resourcePath);
      } catch {
        errors.push(`${kind}/${name} is missing or has a broken link`);
      }
    }
  }

  if (profile.skills === 'all') {
    const allSkills = await listDirectory(path.join(root, '.opencode', 'skills'));

    for (const skill of allSkills) {
      try {
        const skillPath = path.join(root, '.opencode', 'skills', skill);
        const stats = await lstat(skillPath);

        if (!stats.isSymbolicLink()) {
          const skillFileStats = await lstat(path.join(skillPath, 'SKILL.md'));

          if (!skillFileStats.isFile()) errors.push(`skills/${skill}/SKILL.md must be a file`);
        }
        await realpath(skillPath);
      } catch {
        errors.push(`skills/${skill} is missing or has a broken link`);
      }
    }
  }

  return { manifest, profile, errors };
}

export async function installDistribution(
  destinationRoot: string,
  sourceRoot: string,
  profileName: string,
  runtime: Runtime,
  repository: string,
  ref: string,
  force = false,
): Promise<Lockfile['packages'][string]> {
  const inspection = await inspectDistribution(sourceRoot, profileName);

  if (inspection.errors.length > 0) {
    throw new Error(`Distribution validation failed:\n${inspection.errors.join('\n')}`);
  }

  const destination = path.resolve(destinationRoot);
  const resourceNames: ResolvedProfile = {
    agents: inspection.profile.agents,
    commands: inspection.profile.commands,
    skills: inspection.profile.skills,
    tools: inspection.profile.tools,
  };

  for (const kind of ['agents', 'commands', 'tools'] as const) {
    const names = resourceNames[kind];

    for (const name of names) {
      const extension = kind === 'tools' ? '.ts' : '.md';

      await copyResource(
        path.join(sourceRoot, '.opencode', kind, `${name}${extension}`),
        path.join(destination, runtimeDirectory(runtime), kind, `${name}${extension}`),
        force,
      );
    }
  }

  const skills =
    resourceNames.skills === 'all'
      ? await listDirectory(path.join(sourceRoot, '.opencode', 'skills'))
      : resourceNames.skills;

  for (const skill of skills) {
    await copyResource(
      path.join(sourceRoot, '.opencode', 'skills', skill),
      path.join(destination, runtimeDirectory(runtime), 'skills', skill),
      force,
    );
  }

  const commit = await gitCommit(sourceRoot);
  const lockEntry = {
    alias: profileName,
    repository,
    ref,
    commit,
    profile: profileName,
    runtime,
    scope: 'project' as const,
    resources: resourceNames,
  };

  const lockfilePath = path.join(destination, '.themis', 'agents.lock.json');
  const lockfile = await readLockfile(lockfilePath);

  lockfile.packages['@visomi/visomi-stack'] = lockEntry;
  await mkdir(path.dirname(lockfilePath), { recursive: true });
  await writeFile(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`, 'utf8');

  return lockEntry;
}

export async function readLockfile(lockfilePath: string): Promise<Lockfile> {
  try {
    return JSON.parse(await readFile(lockfilePath, 'utf8')) as Lockfile;
  } catch {
    return { format: 1, packages: {} };
  }
}

async function copyResource(sourcePath: string, destinationPath: string, force: boolean): Promise<void> {
  const sourceRealPath = await realpath(sourcePath);

  try {
    const destinationRealPath = await realpath(destinationPath);

    if (sourceRealPath === destinationRealPath) {
      return;
    }
    if (!force) {
      throw new Error(`Destination exists: ${destinationPath}. Re-run with --force to replace it.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Destination exists:')) {
      throw error;
    }
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourceRealPath, destinationPath, { recursive: true, force: true });
}

function runtimeDirectory(_runtime: Runtime): string {
  return '.opencode';
}

async function findLocalSource(start: string): Promise<string | undefined> {
  let current = path.resolve(start);

  while (true) {
    try {
      await access(path.join(current, '.opencode', 'manifest.yml'));

      return current;
    } catch {
      const parent = path.dirname(current);

      if (parent === current) {
        return undefined;
      }
      current = parent;
    }
  }
}

async function createTemporaryClone(repository: string, ref: string): Promise<string> {
  const parent = await os.tmpdir();
  const temporaryRoot = path.join(parent, `themis-agent-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  await execFileAsync('git', ['clone', '--depth', '1', '--branch', ref, repository, temporaryRoot]);

  return temporaryRoot;
}

async function gitCommit(root: string): Promise<string> {
  try {
    const result = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });

    return result.stdout.trim();
  } catch {
    return 'local';
  }
}

async function listDirectory(directory: string): Promise<string[]> {
  const entries = await readdir(directory);

  return entries.filter((entry) => !entry.startsWith('.'));
}

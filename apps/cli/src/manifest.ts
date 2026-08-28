import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

export type ResourceKind = 'agents' | 'commands' | 'skills' | 'tools';

export type Profile = {
  agents?: string[];
  commands?: string[];
  skills?: string[] | 'all';
  tools?: string[];
  includes?: string[];
};

export type DistributionManifest = {
  name: string;
  version: string;
  description: string;
  source: {
    canonical: string;
  };
  profiles: Record<string, Profile>;
  targets: string[];
};

export type ResolvedProfile = {
  agents: string[];
  commands: string[];
  skills: string[] | 'all';
  tools: string[];
};

export async function loadManifest(sourceRoot: string): Promise<DistributionManifest> {
  const manifestPath = path.join(sourceRoot, '.opencode', 'manifest.yml');
  const content = await readFile(manifestPath, 'utf8');
  const manifest = parse(content) as DistributionManifest;

  if (!manifest.name || !manifest.version || !manifest.profiles) {
    throw new Error(`Invalid distribution manifest: ${manifestPath}`);
  }

  return manifest;
}

export function resolveProfile(manifest: DistributionManifest, name: string): ResolvedProfile {
  const profile = manifest.profiles[name];

  if (!profile) {
    throw new Error(`Unknown profile: ${name}`);
  }

  const resolved: ResolvedProfile = {
    agents: [],
    commands: [],
    skills: [],
    tools: [],
  };

  for (const includedProfile of profile.includes ?? []) {
    const included = resolveProfile(manifest, includedProfile);

    resolved.agents.push(...included.agents);
    resolved.commands.push(...included.commands);
    resolved.tools.push(...included.tools);
    if (included.skills === 'all') {
      resolved.skills = 'all';
    } else if (resolved.skills !== 'all') {
      resolved.skills.push(...included.skills);
    }
  }

  resolved.agents.push(...(profile.agents ?? []));
  resolved.commands.push(...(profile.commands ?? []));
  resolved.tools.push(...(profile.tools ?? []));
  if (profile.skills === 'all') {
    resolved.skills = 'all';
  } else if (profile.skills && resolved.skills !== 'all') {
    resolved.skills.push(...profile.skills);
  }

  return {
    agents: unique(resolved.agents),
    commands: unique(resolved.commands),
    skills: resolved.skills === 'all' ? 'all' : unique(resolved.skills),
    tools: unique(resolved.tools),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

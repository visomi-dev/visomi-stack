#!/usr/bin/env node

import path from 'node:path';

import { installDistribution, inspectDistribution, locateSource, type Runtime } from './distribution';

type ParsedArgs = {
  command?: string;
  value?: string;
  profile: string;
  runtime: Runtime;
  ref: string;
  source?: string;
  force: boolean;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command === 'help' || args.command === '--help') {
    printHelp();

    return;
  }

  if (args.command === 'list') {
    await listCommand(args);

    return;
  }

  if (args.command === 'verify') {
    await verifyCommand(args);

    return;
  }

  if (args.command === 'add') {
    await addCommand(args);

    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

async function addCommand(args: ParsedArgs): Promise<void> {
  const alias = args.value ?? 'core';
  const source = await locateSource(args.source, args.ref);

  try {
    const entry = await installDistribution(
      process.cwd(),
      source.root,
      args.profile === 'core' ? alias : args.profile,
      args.runtime,
      source.repository,
      args.ref === 'main' && source.ref !== 'local' ? source.ref : args.ref,
      args.force,
    );

    console.log(`Installed ${entry.profile} for ${entry.runtime}.`);
    console.log(`Lockfile: ${path.join('.themis', 'agents.lock.json')}`);
  } finally {
    await source.cleanup();
  }
}

async function listCommand(args: ParsedArgs): Promise<void> {
  const source = await locateSource(args.source, args.ref);

  try {
    const profile = args.value ?? 'core';
    const inspection = await inspectDistribution(source.root, profile);

    console.log(`${inspection.manifest.name}@${inspection.manifest.version}`);
    console.log(`profile: ${profile}`);
    console.log(`agents: ${inspection.profile.agents.join(', ') || 'none'}`);
    console.log(`commands: ${inspection.profile.commands.join(', ') || 'none'}`);
    console.log(`skills: ${inspection.profile.skills === 'all' ? 'all' : inspection.profile.skills.join(', ')}`);
    console.log(`tools: ${inspection.profile.tools.join(', ') || 'none'}`);
  } finally {
    await source.cleanup();
  }
}

async function verifyCommand(args: ParsedArgs): Promise<void> {
  const source = await locateSource(args.source, args.ref);

  try {
    const inspection = await inspectDistribution(source.root, args.value ?? 'core');

    if (inspection.errors.length > 0) {
      throw new Error(inspection.errors.join('\n'));
    }
    console.log(`Distribution is valid: ${source.root}`);
  } finally {
    await source.cleanup();
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, value, ...options] = argv;
  const parsed: ParsedArgs = {
    command,
    value,
    profile: value ?? 'core',
    runtime: 'opencode',
    ref: 'main',
    force: false,
  };

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];

    if (option === '--profile') {
      parsed.profile = options[++index] ?? 'core';
    } else if (option === '--agent') {
      const runtime = options[++index];

      if (runtime !== 'opencode') {
        throw new Error(`Unsupported agent runtime: ${runtime ?? '(missing)'}`);
      }
      parsed.runtime = runtime;
    } else if (option === '--ref') {
      parsed.ref = options[++index] ?? 'main';
    } else if (option === '--source') {
      parsed.source = options[++index];
    } else if (option === '--force') {
      parsed.force = true;
    } else if (option === '--help') {
      parsed.command = 'help';
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  return parsed;
}

function printHelp(): void {
  console.log(`Visomi Stack agent distribution example CLI

Usage:
  npx visomi-stack add core
  npx visomi-stack list [profile]
  npx visomi-stack verify [profile]

Options:
  --agent opencode
  --profile <name>
  --ref <branch|tag|commit>
  --source <local-path>
  --force
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Error: ${message}`);
  process.exitCode = 1;
});

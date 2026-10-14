import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { ThemisState } from '../libs/themis-workflow/src/lib/legacy-workflow-internal.ts';

import type {
  DomainManifest,
  PhaseFidelityRow,
  RawOutputFinding,
  RawOutputScan,
  ThemisEvent,
} from './themis-project-migration-contract.ts';
import { migrationPaths } from './themis-project-migration-paths.ts';

export const manifest = (state: ThemisState, events: ThemisEvent[]): DomainManifest => ({
  entities: Object.fromEntries(
    Object.entries(state)
      .filter(([, value]) => Array.isArray(value))
      .map(([kind, value]) => [
        kind,
        (value as Array<Record<string, unknown>>).map((entry) => JSON.stringify(entry)).sort(),
      ]),
  ),
  events: events.map(({ sequence, type, aggregateType, aggregateId, payload }) => ({
    sequence,
    type,
    aggregateType,
    aggregateId,
    payload: JSON.stringify(payload),
  })),
});

export const phaseFidelity = (status: string): PhaseFidelityRow[] =>
  [
    ['P0', ['PZS-001'], ['in_progress'], []],
    [
      'P1',
      ['PZS-002'],
      [status],
      status === 'done' ? [] : ['Independent review and verifier completion remain outstanding.'],
    ],
    ['P2', ['PZS-003'], ['ready'], ['Implementation deferred to PZS-003.']],
    ['P3', ['PZS-004'], ['ready'], ['Implementation deferred to PZS-004.']],
    ['P4', ['PZS-005'], ['ready'], ['Implementation deferred to PZS-005.']],
    ['P5', ['PZS-006'], ['ready'], ['Implementation deferred to PZS-006.']],
    ['P6', ['PZS-007'], ['ready'], ['Implementation deferred to PZS-007.']],
    ['P7', ['PZS-007', 'THM-OWV-005'], ['ready', 'rework'], ['Implementation deferred to PZS-007 and THM-OWV-005.']],
    ['P8', ['THM-OWV-006'], ['rework'], ['Implementation deferred to THM-OWV-006.']],
    ['P9', ['PZS-008', 'PZS-009'], ['ready', 'ready'], ['Implementation deferred to PZS-008 and PZS-009.']],
    ['P10', ['PZS-010'], ['ready'], ['Validation deferred to PZS-010.']],
    [
      'P11',
      ['PZS-001', 'PZS-007'],
      ['in_progress', 'ready'],
      ['Native UI, native runtime, and native-specific key storage are deferred.'],
    ],
  ].map(([phaseId, itemIds, statuses, gaps]) => ({
    phaseId: phaseId as string,
    itemIds: itemIds as string[],
    statuses: statuses as string[],
    gaps: gaps as string[],
  }));

export const scanMigrationOutputs = (root: string): RawOutputScan => {
  const migration = migrationPaths(root);
  const categoryRoots: Record<string, string> = {
    backups: migration.backup,
    quarantine: migration.quarantine,
    ledgers: migration.ledger,
    manifests: migration.projects,
    events: migration.projects,
    reports: join(migration.base, 'reports'),
    'migration-logs': migration.logs,
  };
  const files: string[] = [];
  const categories = Object.fromEntries(Object.keys(categoryRoots).map((category) => [category, 0]));
  const visit = (location: string, category: string): void => {
    if (!existsSync(location)) {
      return;
    }
    if (statSync(location).isDirectory()) {
      for (const child of readdirSync(location)) {
        visit(join(location, child), category);
      }

      return;
    }
    files.push(location);
    categories[category] = (categories[category] ?? 0) + 1;
  };

  for (const [category, location] of Object.entries(categoryRoots)) {
    visit(location, category);
  }
  const sensitivePatterns: Array<[string, RegExp]> = [
    ['local-path', new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))],
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
    ['credential', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)["']?\s*[:=]/i],
    ['protected-payload', /\b(?:project context|activity|plaintext|ciphertext payload|workspace key)["']?\s*[:=]/i],
  ];
  const findings: RawOutputFinding[] = [];

  for (const file of files) {
    const contents = readFileSync(file, 'utf8');

    for (const [pattern, expression] of sensitivePatterns) {
      if (expression.test(contents)) {
        findings.push({ file, pattern });
      }
    }
  }

  return { categories, files, filesScanned: [...new Set(files)], findings };
};

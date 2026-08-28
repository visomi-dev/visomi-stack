import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { paths, readState, type ThemisState } from '../libs/themis-workflow/src/lib/legacy-workflow-internal.ts';
import { WorkspaceRegistry } from '../libs/themis-workflow/src/index.ts';

type ThemisEvent = {
  schemaVersion: number;
  sequence: number;
  timestamp: string;
  actor: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
};

type StoreState = ThemisState & { projectId: string };
type MigrationPhase = 'planned' | 'migrating' | 'cutover' | 'rolled-back';
type MigrationLedger = {
  schemaVersion: 1;
  migrationId: string;
  sourceChecksum: string;
  phase: MigrationPhase;
  projects: Record<string, 'pending' | 'migrated' | 'failed'>;
  quarantinedEvents: number;
  backupId: string;
  generation: number;
};

type MigrationReport = {
  migrationId: string;
  dryRun: boolean;
  phase: MigrationPhase;
  sourceChecksum: string;
  projectIds: string[];
  quarantinedEvents: number;
  backupId?: string;
  storeIds: string[];
  manifests: { before: DomainManifest; after: Record<string, DomainManifest> };
  eventOrder: { before: number[]; after: number[] };
  quarantinedRecordKeys: string[];
  phaseFidelity: { before: PhaseFidelityRow[]; after: PhaseFidelityRow[] };
};

type DomainManifest = {
  entities: Record<string, string[]>;
  events: Array<{ sequence: number; type: string; aggregateType: string; aggregateId: string; payload: string }>;
};
type PhaseFidelityRow = { phaseId: string; itemIds: string[]; statuses: string[]; gaps: string[] };
type RawOutputFinding = { file: string; pattern: string };
type RawOutputScan = {
  categories: Record<string, number>;
  files: string[];
  filesScanned: string[];
  findings: RawOutputFinding[];
};

type RecordAssignment = { projectId?: string; reason?: string };

const stableJson = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';
const checksum = (value: string): string => createHash('sha256').update(value).digest('hex');
const migrationPaths = (root: string) => {
  const base = join(paths(root).directory, 'migration');
  return {
    base,
    ledger: join(base, 'ledger.json'),
    cutover: join(base, 'cutover.json'),
    backup: join(base, 'backups'),
    projects: join(paths(root).directory, 'projects'),
    quarantine: join(base, 'quarantine.json'),
    logs: join(base, 'logs'),
  };
};

const atomicWrite = (location: string, value: unknown): void => {
  mkdirSync(join(location, '..'), { recursive: true });
  const temporary = `${location}.tmp`;
  writeFileSync(temporary, typeof value === 'string' ? value : stableJson(value), 'utf8');
  renameSync(temporary, location);
};

const readEvents = (root: string): ThemisEvent[] => {
  if (!existsSync(paths(root).events)) return [];
  return readFileSync(paths(root).events, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ThemisEvent);
};

const readGlobal = (root: string): { state: ThemisState; events: ThemisEvent[]; sourceChecksum: string } => {
  // Use the compatibility upgrader before inventorying so legacy project-less records
  // receive the explicit local project instead of being silently omitted.
  readState(root);
  const stateText = readFileSync(paths(root).state, 'utf8');
  const eventsText = existsSync(paths(root).events) ? readFileSync(paths(root).events, 'utf8') : '';
  return {
    state: JSON.parse(stateText) as ThemisState,
    events: readEvents(root),
    sourceChecksum: checksum(stateText + eventsText),
  };
};

const retargetProject = (
  state: ThemisState,
  events: ThemisEvent[],
  sourceProjectId: string,
  targetProjectId: string,
): { state: ThemisState; events: ThemisEvent[] } => {
  const replace = (value: unknown): unknown => (value === sourceProjectId ? targetProjectId : value);
  const nextState = JSON.parse(
    JSON.stringify(state).replaceAll(`"${sourceProjectId}"`, `"${targetProjectId}"`),
  ) as ThemisState;
  const nextEvents = events.map((event) => ({
    ...event,
    aggregateId: event.aggregateId === sourceProjectId ? targetProjectId : event.aggregateId,
    payload: Object.fromEntries(Object.entries(event.payload).map(([key, value]) => [key, replace(value)])),
  }));
  return { state: nextState, events: nextEvents };
};

const idsForProject = (state: ThemisState, projectId: string): Set<string> => {
  const ids = new Set<string>([projectId]);
  state.epics.filter((entry) => entry.projectId === projectId).forEach((entry) => ids.add(entry.id));
  state.workItems.filter((entry) => entry.projectId === projectId).forEach((entry) => ids.add(entry.id));
  state.sprints.filter((entry) => entry.projectId === projectId).forEach((entry) => ids.add(entry.id));
  state.revisions.filter((entry) => entry.projectId === projectId).forEach((entry) => ids.add(entry.id));
  state.runs.filter((entry) => ids.has(entry.workItemId)).forEach((entry) => ids.add(entry.id));
  state.reviews
    .filter((entry) => ids.has(entry.workItemId) || ids.has(entry.runId))
    .forEach((entry) => ids.add(entry.id));
  state.evidence.filter((entry) => ids.has(entry.runId)).forEach((entry) => ids.add(entry.id));
  state.sprintItems
    .filter((entry) => ids.has(entry.sprintId) || ids.has(entry.workItemId))
    .forEach((entry) => {
      ids.add(entry.sprintId);
      ids.add(entry.workItemId);
    });
  state.sprintEvidence.filter((entry) => ids.has(entry.sprintId)).forEach((entry) => ids.add(entry.id));
  return ids;
};

const projectState = (state: ThemisState, projectId: string): StoreState => {
  const ids = idsForProject(state, projectId);
  return {
    schemaVersion: state.schemaVersion,
    projectId,
    projects: state.projects.filter((entry) => entry.id === projectId),
    epics: state.epics.filter((entry) => entry.projectId === projectId),
    workItems: state.workItems.filter((entry) => entry.projectId === projectId),
    dependencies: state.dependencies.filter((entry) => ids.has(entry.from) && ids.has(entry.to)),
    sprints: state.sprints.filter((entry) => entry.projectId === projectId),
    sprintItems: state.sprintItems.filter((entry) => ids.has(entry.sprintId) && ids.has(entry.workItemId)),
    revisions: state.revisions.filter((entry) => entry.projectId === projectId),
    runs: state.runs.filter((entry) => ids.has(entry.workItemId)),
    evidence: state.evidence.filter((entry) => ids.has(entry.runId)),
    sprintEvidence: state.sprintEvidence.filter((entry) => ids.has(entry.sprintId)),
    reviews: state.reviews.filter((entry) => ids.has(entry.workItemId) || ids.has(entry.runId)),
  };
};

const recordAssignment = (state: ThemisState): Map<string, RecordAssignment> => {
  const assignments = new Map<string, RecordAssignment>();
  const projectIds = new Set(state.projects.map((project) => project.id));
  const assign = (kind: string, id: string, projectId: string | undefined, reason?: string): void => {
    assignments.set(`${kind}:${id}`, projectId ? { projectId } : { reason });
  };
  for (const record of state.projects) assign('project', record.id, record.id);
  for (const record of state.epics)
    assign('epic', record.id, projectIds.has(record.projectId) ? record.projectId : undefined, 'missing-project');
  for (const record of state.workItems)
    assign('work-item', record.id, projectIds.has(record.projectId) ? record.projectId : undefined, 'missing-project');
  for (const record of state.sprints)
    assign('sprint', record.id, projectIds.has(record.projectId) ? record.projectId : undefined, 'missing-project');
  for (const record of state.revisions)
    assign('revision', record.id, projectIds.has(record.projectId) ? record.projectId : undefined, 'missing-project');
  const projectOf = (kind: string, id: string): string | undefined => assignments.get(`${kind}:${id}`)?.projectId;
  for (const record of state.runs)
    assign(
      'run',
      record.id,
      projectOf('work-item', record.workItemId),
      projectOf('work-item', record.workItemId) ? undefined : 'missing-work-item',
    );
  for (const record of state.evidence)
    assign(
      'evidence',
      record.id,
      projectOf('run', record.runId),
      projectOf('run', record.runId) ? undefined : 'missing-run',
    );
  for (const record of state.sprintEvidence)
    assign(
      'sprint-evidence',
      record.id,
      projectOf('sprint', record.sprintId),
      projectOf('sprint', record.sprintId) ? undefined : 'missing-sprint',
    );
  for (const record of state.sprintItems) {
    const sprintProject = projectOf('sprint', record.sprintId);
    const itemProject = projectOf('work-item', record.workItemId);
    assign(
      'sprint-membership',
      `${record.sprintId}:${record.workItemId}`,
      sprintProject && sprintProject === itemProject ? sprintProject : undefined,
      sprintProject && itemProject ? 'cross-project-reference' : 'missing-reference',
    );
  }
  for (const record of state.reviews) {
    const workItemProject = projectOf('work-item', record.workItemId);
    const runProject = projectOf('run', record.runId);
    assign(
      'review',
      record.id,
      workItemProject && workItemProject === runProject ? workItemProject : undefined,
      workItemProject && runProject ? 'cross-project-reference' : 'missing-reference',
    );
  }
  for (const record of state.dependencies) {
    const fromProject = projectOf('work-item', record.from);
    const toProject = projectOf('work-item', record.to);
    assign(
      'dependency',
      `${record.from}->${record.to}`,
      fromProject && fromProject === toProject ? fromProject : undefined,
      fromProject && toProject ? 'cross-project-reference' : 'missing-reference',
    );
  }
  return assignments;
};

const eventProject = (event: ThemisEvent, projectIds: Map<string, string>): string | undefined => {
  const candidates = [event.aggregateId, ...Object.values(event.payload)].filter(
    (value): value is string => typeof value === 'string',
  );
  const projects = new Set(candidates.map((id) => projectIds.get(id)).filter((id): id is string => id !== undefined));
  return projects.size === 1 ? [...projects][0] : undefined;
};

const readLedger = (root: string): MigrationLedger | undefined => {
  const location = migrationPaths(root).ledger;
  return existsSync(location) ? (JSON.parse(readFileSync(location, 'utf8')) as MigrationLedger) : undefined;
};

const storeLocation = (root: string, projectId: string): string => join(migrationPaths(root).projects, projectId);
const backupLocation = (root: string, backupId: string): string => join(migrationPaths(root).backup, backupId);

const manifest = (state: ThemisState, events: ThemisEvent[]): DomainManifest => ({
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

const phaseFidelity = (status: string): PhaseFidelityRow[] =>
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

const scanMigrationOutputs = (root: string): RawOutputScan => {
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
    if (!existsSync(location)) return;
    if (statSync(location).isDirectory()) {
      for (const child of readdirSync(location)) visit(join(location, child), category);
      return;
    }
    files.push(location);
    categories[category] = (categories[category] ?? 0) + 1;
  };
  for (const [category, location] of Object.entries(categoryRoots)) visit(location, category);
  const sensitivePatterns: Array<[string, RegExp]> = [
    ['local-path', new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))],
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
    ['credential', /(?:password|passwd|secret|api[_-]?key|access[_-]?token)\\s*[:=]/i],
    ['protected-payload', /(?:project context|activity|plaintext|ciphertext payload|workspace key)\\s*[:=]/i],
  ];
  const findings: RawOutputFinding[] = [];
  for (const file of files) {
    const contents = readFileSync(file, 'utf8');
    for (const [pattern, expression] of sensitivePatterns)
      if (expression.test(contents)) findings.push({ file, pattern });
  }
  return { categories, files, filesScanned: [...new Set(files)], findings };
};

const writeStore = (
  root: string,
  projectId: string,
  state: StoreState,
  events: ThemisEvent[],
  generation: number,
): void => {
  const location = storeLocation(root, projectId);
  mkdirSync(location, { recursive: true });
  atomicWrite(join(location, 'state.json'), state);
  atomicWrite(
    join(location, 'events.ndjson'),
    events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''),
  );
  atomicWrite(join(location, 'manifest.json'), {
    schemaVersion: 1,
    projectId,
    generation,
    stateChecksum: checksum(stableJson(state)),
    eventsChecksum: checksum(events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '')),
    entityCounts: Object.fromEntries(
      Object.entries(state)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, value.length]),
    ),
  });
};

const loadProjectStore = (root: string, projectId: string): { state: StoreState; events: ThemisEvent[] } => {
  const location = storeLocation(root, projectId);
  const stateText = readFileSync(join(location, 'state.json'), 'utf8');
  const eventsText = readFileSync(join(location, 'events.ndjson'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(location, 'manifest.json'), 'utf8')) as {
    stateChecksum: string;
    eventsChecksum: string;
  };
  if (checksum(stateText) !== manifest.stateChecksum || checksum(eventsText) !== manifest.eventsChecksum)
    throw new Error(`Project store checksum mismatch: ${projectId}`);
  const state = JSON.parse(stateText) as StoreState;
  if (state.projectId !== projectId) throw new Error(`Project store identity mismatch: ${projectId}`);
  return {
    state,
    events: eventsText
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ThemisEvent),
  };
};

const validateProjectStore = (root: string, projectId: string): DomainManifest => {
  const loaded = loadProjectStore(root, projectId);
  if (loaded.state.projects.length !== 1 || loaded.state.projects[0]?.id !== projectId)
    throw new Error(`Project store validation failed: ${projectId}`);
  const ids = new Set<string>([
    projectId,
    ...Object.values(loaded.state).flatMap((value) =>
      Array.isArray(value)
        ? value.flatMap((entry) => {
            const candidate = entry as Record<string, unknown>;
            return typeof candidate.id === 'string' ? [candidate.id] : [];
          })
        : [],
    ),
  ]);
  for (const event of loaded.events) {
    const references = Object.entries(event.payload)
      .filter(([key]) => key === 'id' || key.endsWith('Id') || key === 'from' || key === 'to')
      .map(([, value]) => value);
    if (![event.aggregateId, ...references].every((value) => typeof value !== 'string' || ids.has(value)))
      throw new Error(`Project store validation failed: dangling event ${event.sequence}`);
  }
  return manifest(loaded.state, loaded.events);
};

const synchronizeProjectStore = (root: string, projectId: string): DomainManifest => {
  const cutover = migrationPaths(root).cutover;
  if (existsSync(cutover)) return validateProjectStore(root, projectId);
  const { state, events, sourceChecksum } = readGlobal(root);
  const recorded = readLedger(root);
  const existing = recorded?.phase === 'rolled-back' ? undefined : recorded;
  if (existing?.phase === 'cutover' && existing.sourceChecksum !== sourceChecksum)
    throw new Error('Stale global state replay rejected after project-store cutover');
  const project = state.projects.find((entry) => entry.id === projectId);
  if (!project) throw new Error(`Unknown project: ${projectId}`);
  const ids = new Map<string, string>();
  for (const id of idsForProject(state, projectId)) ids.set(id, projectId);
  const selectedEvents = events.filter((event) => eventProject(event, ids) === projectId);
  writeStore(root, projectId, projectState(state, projectId), selectedEvents, 1);
  return validateProjectStore(root, projectId);
};

const backupProjectStore = (root: string, projectId: string): string => {
  const loaded = loadProjectStore(root, projectId);
  const backupId = `project-${projectId}`;
  const location = backupLocation(root, backupId);
  mkdirSync(location, { recursive: true });
  atomicWrite(join(location, 'state.json'), stableJson(loaded.state));
  atomicWrite(
    join(location, 'events.ndjson'),
    loaded.events.map((event) => JSON.stringify(event)).join('\n') + (loaded.events.length ? '\n' : ''),
  );
  atomicWrite(join(location, 'manifest.json'), {
    stateChecksum: checksum(stableJson(loaded.state)),
    eventsChecksum: checksum(
      loaded.events.map((event) => JSON.stringify(event)).join('\n') + (loaded.events.length ? '\n' : ''),
    ),
  });
  return backupId;
};

const restoreProjectStore = (root: string, projectId: string, backupId = `project-${projectId}`): DomainManifest => {
  const location = backupLocation(root, backupId);
  const stateText = readFileSync(join(location, 'state.json'), 'utf8');
  const eventsText = readFileSync(join(location, 'events.ndjson'), 'utf8');
  const recorded = JSON.parse(readFileSync(join(location, 'manifest.json'), 'utf8')) as {
    stateChecksum: string;
    eventsChecksum: string;
  };
  if (checksum(stateText) !== recorded.stateChecksum || checksum(eventsText) !== recorded.eventsChecksum)
    throw new Error('Backup checksum mismatch');
  const state = JSON.parse(stateText) as StoreState;
  if (state.projectId !== projectId) throw new Error(`Backup project identity mismatch: ${projectId}`);
  atomicWrite(join(storeLocation(root, projectId), 'state.json'), stateText);
  atomicWrite(join(storeLocation(root, projectId), 'events.ndjson'), eventsText);
  atomicWrite(join(storeLocation(root, projectId), 'manifest.json'), {
    schemaVersion: 1,
    projectId,
    generation: 1,
    stateChecksum: checksum(stateText),
    eventsChecksum: checksum(eventsText),
    entityCounts: Object.fromEntries(
      Object.entries(state)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, value.length]),
    ),
  });
  return validateProjectStore(root, projectId);
};

const migrateProjectStores = (
  root: string,
  options: {
    dryRun?: boolean;
    resume?: boolean;
    cutover?: boolean;
    migrationId?: string;
    targetProjectId?: string;
    failAfterProject?: string;
  } = {},
): MigrationReport => {
  const global = readGlobal(root);
  const sourceProjectId = global.state.projects[0]?.id;
  const targeted =
    options.targetProjectId && sourceProjectId && options.targetProjectId !== sourceProjectId
      ? retargetProject(global.state, global.events, sourceProjectId, options.targetProjectId)
      : { state: global.state, events: global.events };
  const { state, events } = targeted;
  const sourceChecksum = global.sourceChecksum;
  const projectIds = state.projects.map((project) => project.id);
  const assignments = recordAssignment(state);
  const ids = new Map<string, string>();
  for (const [key, assignment] of assignments) {
    const separator = key.indexOf(':');
    if (separator > -1 && assignment.projectId) ids.set(key.slice(separator + 1), assignment.projectId);
  }
  const eventGroups = new Map<string, ThemisEvent[]>();
  const quarantined = events.filter((event) => {
    const projectId = eventProject(event, ids);
    if (!projectId) return true;
    const group = eventGroups.get(projectId) ?? [];
    group.push(event);
    eventGroups.set(projectId, group);
    return false;
  });
  for (const [projectId, group] of eventGroups) {
    const projectStateValue = projectState(state, projectId);
    const ids = new Set<string>([
      projectId,
      ...Object.values(projectStateValue).flatMap((value) =>
        Array.isArray(value)
          ? value.flatMap((entry) => {
              const candidate = entry as Record<string, unknown>;
              return typeof candidate.id === 'string' ? [candidate.id] : [];
            })
          : [],
      ),
    ]);
    const valid = group.filter((event) => {
      const references = Object.entries(event.payload)
        .filter(([key]) => key === 'id' || key.endsWith('Id') || key === 'from' || key === 'to')
        .map(([, value]) => value);
      return [event.aggregateId, ...references].every((value) => typeof value !== 'string' || ids.has(value));
    });
    eventGroups.set(projectId, valid);
    quarantined.push(...group.filter((event) => !valid.includes(event)));
  }
  const quarantinedRecords: Array<{ kind: string; id: string; record: unknown }> = [];
  const quarantineKeys = new Set<string>();
  const quarantine = (kind: string, id: string, record: unknown): void => {
    const key = `${kind}:${id}`;
    if (!quarantineKeys.has(key)) {
      quarantineKeys.add(key);
      quarantinedRecords.push({ kind, id, record });
    }
  };
  const inventory: Array<[string, string, unknown]> = [
    ...state.projects.map((record) => ['project', record.id, record] as [string, string, unknown]),
    ...state.epics.map((record) => ['epic', record.id, record] as [string, string, unknown]),
    ...state.workItems.map((record) => ['work-item', record.id, record] as [string, string, unknown]),
    ...state.sprints.map((record) => ['sprint', record.id, record] as [string, string, unknown]),
    ...state.revisions.map((record) => ['revision', record.id, record] as [string, string, unknown]),
    ...state.dependencies.map(
      (record) => ['dependency', `${record.from}->${record.to}`, record] as [string, string, unknown],
    ),
    ...state.sprintItems.map(
      (record) => ['sprint-membership', `${record.sprintId}:${record.workItemId}`, record] as [string, string, unknown],
    ),
    ...state.runs.map((record) => ['run', record.id, record] as [string, string, unknown]),
    ...state.evidence.map((record) => ['evidence', record.id, record] as [string, string, unknown]),
    ...state.sprintEvidence.map((record) => ['sprint-evidence', record.id, record] as [string, string, unknown]),
    ...state.reviews.map((record) => ['review', record.id, record] as [string, string, unknown]),
  ];
  for (const [kind, id, record] of inventory)
    if (!assignments.get(`${kind}:${id}`)?.projectId) quarantine(kind, id, record);
  const migrationRecord = readLedger(root);
  const existing = migrationRecord?.phase === 'rolled-back' ? undefined : migrationRecord;
  if (existing && existing.sourceChecksum !== sourceChecksum && existing.phase === 'cutover') {
    throw new Error('Stale global state replay rejected after project-store cutover');
  }
  const migrationId = existing?.migrationId ?? options.migrationId ?? `migration-${sourceChecksum.slice(0, 12)}`;
  const ledger: MigrationLedger = existing ?? {
    schemaVersion: 1,
    migrationId,
    sourceChecksum,
    phase: options.dryRun ? 'planned' : 'migrating',
    projects: Object.fromEntries(projectIds.map((id) => [id, 'pending'])),
    quarantinedEvents: quarantined.length,
    backupId: `migration-${migrationId}`,
    generation: 1,
  };
  if (options.dryRun) {
    return {
      migrationId,
      dryRun: true,
      phase: 'planned',
      sourceChecksum,
      projectIds,
      quarantinedEvents: quarantined.length,
      storeIds: projectIds.map((id) => `project-${id}`),
      manifests: { before: manifest(state, events), after: {} },
      eventOrder: { before: events.map((event) => event.sequence), after: [] },
      quarantinedRecordKeys: [],
      phaseFidelity: { before: phaseFidelity('ready'), after: phaseFidelity('ready') },
    };
  }
  const locations = migrationPaths(root);
  const backupPath = backupLocation(root, ledger.backupId);
  mkdirSync(backupPath, { recursive: true });
  copyFileSync(paths(root).state, join(backupPath, 'state.json'));
  if (existsSync(paths(root).events)) copyFileSync(paths(root).events, join(backupPath, 'events.ndjson'));
  atomicWrite(join(backupPath, 'manifest.json'), {
    sourceChecksum,
    stateChecksum: checksum(readFileSync(paths(root).state, 'utf8')),
    eventsChecksum: checksum(existsSync(paths(root).events) ? readFileSync(paths(root).events, 'utf8') : ''),
  });
  atomicWrite(locations.quarantine, { migrationId, events: quarantined, records: quarantinedRecords });
  atomicWrite(locations.ledger, ledger);
  for (const projectId of projectIds) {
    if (ledger.projects[projectId] === 'migrated') continue;
    writeStore(root, projectId, projectState(state, projectId), eventGroups.get(projectId) ?? [], ledger.generation);
    ledger.projects[projectId] = 'migrated';
    atomicWrite(locations.ledger, ledger);
    if (options.failAfterProject === projectId) throw new Error(`Migration interrupted after project ${projectId}`);
  }
  ledger.phase = options.cutover === false ? 'migrating' : 'cutover';
  atomicWrite(locations.ledger, ledger);
  if (ledger.phase === 'cutover')
    atomicWrite(locations.cutover, {
      authority: 'project-stores',
      generation: ledger.generation,
      sourceChecksum,
      writesFenced: true,
    });
  const registry = new WorkspaceRegistry(root);
  for (const projectId of projectIds) {
    const project = state.projects.find((entry) => entry.id === projectId);
    if (project) registry.register(projectId, project.name, root);
  }
  if (options.targetProjectId && sourceProjectId && options.targetProjectId !== sourceProjectId)
    if (registry.list(true).some((entry) => entry.projectId === sourceProjectId)) registry.remove(sourceProjectId);
  atomicWrite(join(locations.logs, `${migrationId}.json`), {
    schemaVersion: 1,
    migrationId,
    phase: ledger.phase,
    projectCount: projectIds.length,
    quarantinedEventCount: quarantined.length,
    writesFenced: ledger.phase === 'cutover',
  });
  const after = Object.fromEntries(
    projectIds.map((id) => [id, manifest(projectState(state, id), eventGroups.get(id) ?? [])]),
  ) as Record<string, DomainManifest>;
  const quarantineEntities: Record<string, string[]> = {};
  const manifestKind = (kind: string): string =>
    ({
      'work-item': 'workItems',
      dependency: 'dependencies',
      'sprint-membership': 'sprintItems',
      'sprint-evidence': 'sprintEvidence',
    })[kind] ?? `${kind}s`;
  for (const record of quarantinedRecords) {
    const kind = manifestKind(record.kind);
    quarantineEntities[kind] = [...(quarantineEntities[kind] ?? []), JSON.stringify(record.record)].sort();
  }
  after.quarantine = {
    entities: quarantineEntities,
    events: quarantined.map(({ sequence, type, aggregateType, aggregateId, payload }) => ({
      sequence,
      type,
      aggregateType,
      aggregateId,
      payload: JSON.stringify(payload),
    })),
  };
  const afterEventOrder = [...eventGroups.values()]
    .flat()
    .concat(quarantined)
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => event.sequence);
  return {
    migrationId,
    dryRun: false,
    phase: ledger.phase,
    sourceChecksum,
    projectIds,
    quarantinedEvents: quarantined.length,
    backupId: ledger.backupId,
    storeIds: projectIds.map((id) => `project-${id}`),
    manifests: { before: manifest(state, events), after },
    eventOrder: { before: events.map((event) => event.sequence), after: afterEventOrder },
    quarantinedRecordKeys: quarantinedRecords.map((record) => `${record.kind}:${record.id}`),
    phaseFidelity: { before: phaseFidelity('ready'), after: phaseFidelity('rework') },
  };
};

const rollbackProjectStores = (root: string): void => {
  const ledger = readLedger(root);
  if (!ledger || ledger.phase !== 'cutover') throw new Error('Rollback requires a completed project-store cutover');
  const cutover = JSON.parse(readFileSync(migrationPaths(root).cutover, 'utf8')) as { writesFenced: boolean };
  if (!cutover.writesFenced) throw new Error('Rollback refused while project writes are not fenced');
  const backupPath = backupLocation(root, ledger.backupId);
  const stateText = readFileSync(join(backupPath, 'state.json'), 'utf8');
  const eventsText = existsSync(join(backupPath, 'events.ndjson'))
    ? readFileSync(join(backupPath, 'events.ndjson'), 'utf8')
    : '';
  const recorded = JSON.parse(readFileSync(join(backupPath, 'manifest.json'), 'utf8')) as {
    stateChecksum: string;
    eventsChecksum: string;
  };
  if (checksum(stateText) !== recorded.stateChecksum || checksum(eventsText) !== recorded.eventsChecksum)
    throw new Error('Backup checksum mismatch');
  atomicWrite(paths(root).state, stateText);
  atomicWrite(paths(root).events, eventsText);
  rmSync(migrationPaths(root).projects, { recursive: true, force: true });
  rmSync(migrationPaths(root).cutover, { force: true });
  ledger.phase = 'rolled-back';
  atomicWrite(migrationPaths(root).ledger, ledger);
};

const readProjectState = (root: string, projectId: string): StoreState => {
  const cutover = migrationPaths(root).cutover;
  if (existsSync(cutover)) return loadProjectStore(root, projectId).state;
  const { state } = readGlobal(root);
  return projectState(state, projectId);
};

export {
  backupProjectStore,
  loadProjectStore,
  migrateProjectStores,
  readProjectState,
  restoreProjectStore,
  rollbackProjectStores,
  synchronizeProjectStore,
  validateProjectStore,
  scanMigrationOutputs,
};
export type { MigrationReport, RawOutputScan, StoreState };

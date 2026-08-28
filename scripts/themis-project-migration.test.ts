import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  addDependency,
  addEvidence,
  createEpic,
  createProject,
  createWorkItem,
  finishRun,
  claimWorkItem,
  startRun,
  transitionWorkItem,
} from '../libs/themis-workflow/src/lib/legacy-workflow-internal.ts';
import {
  loadProjectStore,
  backupProjectStore,
  migrateProjectStores,
  readProjectState,
  restoreProjectStore,
  rollbackProjectStores,
  synchronizeProjectStore,
  scanMigrationOutputs,
  validateProjectStore,
} from './themis-project-migration.ts';

const roots: string[] = [];
const clock = (() => {
  let tick = 0;
  return () => `2026-08-24T00:00:${String(tick++).padStart(2, '0')}.000Z`;
})();

const fixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'themis-project-migration-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    // The fixture root is unique and is removed by the test runner's temporary directory cleanup.
    void root;
  }
});

const makeProject = (root: string, id: string) => {
  createProject(root, { id, name: id, summary: `${id} summary` }, 'fixture', clock);
  createEpic(root, { id: `${id}-EPIC`, projectId: id, title: 'Epic', summary: 'Epic', goal: 'Goal' }, 'fixture', clock);
  const item = createWorkItem(
    root,
    {
      id: `${id}-ITEM`,
      projectId: id,
      epicId: `${id}-EPIC`,
      title: 'Item',
      summary: 'Item summary',
      acceptanceCriteria: ['Item is preserved'],
      scopeIn: ['fixture/**'],
      scopeOut: [],
      verificationStrategy: ['pnpm themis:test'],
    },
    'fixture',
    clock,
  );
  transitionWorkItem(root, item.id, 'ready', 'fixture', clock);
  return item;
};

describe('project-scoped Themis migration', () => {
  it('preserves the complete domain, event order, backup, and quarantines unresolved history', () => {
    const root = fixture();
    const first = makeProject(root, 'PRJ-A');
    const second = makeProject(root, 'PRJ-B');
    addDependency(root, first.id, second.id, 'fixture', clock); // Deliberately cross-project: it must not enter either authority.

    // Populate every state collection so the manifest proves complete-domain coverage,
    // rather than proving only the project/epic/work-item happy path.
    claimWorkItem(root, first.id, 'fixture', 'fixture', clock);
    const run = startRun(root, first.id, 'fixture', 'fixture', clock);
    addEvidence(root, run.id, 'verification', 'fixture evidence', 'fixture', 'fixture', clock);
    finishRun(root, run.id, 'completed', 'fixture complete', 'fixture', clock);
    const statePath = join(root, '.themis', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown[]>;
    state.sprints.push({ id: 'SPR-A', projectId: 'PRJ-A', goal: 'fixture', status: 'active', createdAt: clock() });
    state.revisions.push({
      id: 'REV-A',
      sprintId: 'SPR-A',
      projectId: 'PRJ-A',
      version: 1,
      epicIds: ['PRJ-A-EPIC'],
      workItemIds: [first.id],
      goal: 'fixture',
      why: 'fixture',
      what: 'fixture',
      how: 'fixture',
      nonGoals: [],
      definitionOfDone: [],
      verificationStrategy: [],
      status: 'approved',
      createdAt: clock(),
    });
    state.sprintItems.push({ sprintId: 'SPR-A', workItemId: first.id, addedAt: clock() });
    state.sprintEvidence.push({
      id: 'SEVD-A',
      sprintId: 'SPR-A',
      kind: 'verification',
      summary: 'fixture',
      value: 'fixture',
      createdAt: clock(),
    });
    state.reviews.push({
      id: 'REVW-A',
      workItemId: first.id,
      runId: run.id,
      reviewer: 'fixture',
      verdict: 'accepted',
      feedback: 'fixture',
      createdAt: clock(),
    });
    state.sprintEvidence.push({
      id: 'SEVD-ORPHAN',
      sprintId: 'MISSING-SPRINT',
      kind: 'verification',
      summary: 'orphan',
      value: 'orphan',
      createdAt: clock(),
    });
    writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');

    const dryRun = migrateProjectStores(root, { dryRun: true });
    assert.equal(dryRun.phase, 'planned');
    assert.equal(existsSync(join(root, '.themis', 'projects')), false);

    const report = migrateProjectStores(root);
    assert.equal(report.phase, 'cutover');
    assert.equal(report.quarantinedEvents > 0, true);
    assert.equal(report.backupId, `migration-${report.migrationId}`);
    assert.deepEqual(report.storeIds, ['project-PRJ-A', 'project-PRJ-B']);
    assert.equal(JSON.stringify(report).includes(root), false);
    assert.deepEqual(
      report.phaseFidelity.before.map((row) => row.phaseId),
      Array.from({ length: 12 }, (_, index) => `P${index}`),
    );
    assert.deepEqual(
      report.phaseFidelity.after.map((row) => row.phaseId),
      report.phaseFidelity.before.map((row) => row.phaseId),
    );
    assert.deepEqual(report.phaseFidelity.after.find((row) => row.phaseId === 'P1')?.itemIds, ['PZS-002']);
    assert.ok(report.phaseFidelity.before.every((row) => row.itemIds.length === row.statuses.length));
    const expectedRows = [
      ['P0', ['PZS-001'], ['in_progress'], []],
      ['P1', ['PZS-002'], ['ready'], ['Independent review and verifier completion remain outstanding.']],
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
    ];
    assert.deepEqual(
      report.phaseFidelity.before.map(({ phaseId, itemIds, statuses, gaps }) => [phaseId, itemIds, statuses, gaps]),
      expectedRows,
    );
    assert.deepEqual(
      report.phaseFidelity.after.map(({ phaseId, itemIds, statuses, gaps }) => [phaseId, itemIds, statuses, gaps]),
      expectedRows.map(([phaseId, itemIds, statuses, gaps]) =>
        phaseId === 'P1'
          ? [phaseId, itemIds, ['rework'], ['Independent review and verifier completion remain outstanding.']]
          : [phaseId, itemIds, statuses, gaps],
      ),
    );

    const store = loadProjectStore(root, 'PRJ-A');
    assert.equal(store.state.projects[0]?.id, 'PRJ-A');
    assert.equal(store.state.workItems[0]?.id, first.id);
    assert.equal(store.state.dependencies.length, 0);
    const afterEntities = Object.fromEntries(
      Object.keys(report.manifests.before.entities).map((kind) => [
        kind,
        [
          ...report.projectIds.flatMap((projectId) => report.manifests.after[projectId]?.entities[kind] ?? []),
          ...(report.manifests.after.quarantine?.entities[kind] ?? []),
        ].sort(),
      ]),
    );
    assert.ok(report.quarantinedRecordKeys.includes('dependency:PRJ-A-ITEM->PRJ-B-ITEM'));
    assert.ok(report.quarantinedRecordKeys.includes('sprint-evidence:SEVD-ORPHAN'));
    assert.deepEqual(afterEntities, report.manifests.before.entities);
    assert.deepEqual(report.eventOrder.after, report.eventOrder.before);
    assert.deepEqual(
      report.manifests.before.events,
      report.projectIds
        .flatMap((projectId) => report.manifests.after[projectId]?.events ?? [])
        .concat(report.manifests.after.quarantine?.events ?? [])
        .sort((left, right) => left.sequence - right.sequence),
    );
    assert.deepEqual(
      report.manifests.after['PRJ-A']?.events.map((event) => event.sequence),
      store.events.map((event) => event.sequence),
    );
    assert.equal(readProjectState(root, 'PRJ-B').workItems[0]?.id, second.id);
    assert.equal(
      JSON.parse(readFileSync(join(root, '.themis', 'migration', 'quarantine.json'), 'utf8')).events.length,
      report.quarantinedEvents,
    );
    const rawOutputScan = scanMigrationOutputs(root);
    assert.ok(rawOutputScan.categories.backups > 0);
    assert.ok(rawOutputScan.categories.quarantine > 0);
    assert.ok(rawOutputScan.categories.ledgers > 0);
    assert.ok(rawOutputScan.categories.manifests > 0);
    assert.ok(rawOutputScan.categories.events > 0);
    assert.equal(rawOutputScan.categories.reports, 0);
    assert.equal(rawOutputScan.categories['migration-logs'] > 0, true);
    assert.ok(rawOutputScan.filesScanned.some((file) => file.endsWith('.json')));
    assert.deepEqual(
      rawOutputScan.findings,
      [],
      `raw migration output findings: ${JSON.stringify(rawOutputScan.findings)}`,
    );
    console.log(
      `migration raw-output scan: filesScanned=${JSON.stringify(rawOutputScan.filesScanned)}, findings=${JSON.stringify(rawOutputScan.findings)}`,
    );
  });

  it('resumes after a project failure and reruns idempotently', () => {
    const root = fixture();
    makeProject(root, 'PRJ-A');
    makeProject(root, 'PRJ-B');
    assert.throws(() => migrateProjectStores(root, { failAfterProject: 'PRJ-A' }), /interrupted/);
    const resumed = migrateProjectStores(root, { resume: true });
    assert.equal(resumed.phase, 'cutover');
    const rerun = migrateProjectStores(root, { resume: true });
    assert.equal(rerun.migrationId, resumed.migrationId);
    assert.deepEqual(loadProjectStore(root, 'PRJ-A').state, readProjectState(root, 'PRJ-A'));
  });

  it('retargets a single-project store while preserving domain identities', () => {
    const root = fixture();
    const item = makeProject(root, 'agent-tracking');

    const report = migrateProjectStores(root, { targetProjectId: 'core' });

    assert.deepEqual(report.projectIds, ['core']);
    const store = loadProjectStore(root, 'core');
    assert.equal(store.state.projects[0]?.id, 'core');
    assert.equal(store.state.workItems[0]?.id, item.id);
    assert.equal(store.state.workItems[0]?.projectId, 'core');
    assert.equal(store.events[0]?.aggregateId, 'core');
    assert.equal(store.events[0]?.payload.projectId, 'core');
    assert.throws(() => loadProjectStore(root, 'agent-tracking'));
  });

  it('isolates a corrupt project store and rejects stale global replay', () => {
    const root = fixture();
    const item = makeProject(root, 'PRJ-HEALTHY');
    makeProject(root, 'PRJ-CORRUPT');
    const report = migrateProjectStores(root);
    writeFileSync(join(root, '.themis', 'projects', 'PRJ-CORRUPT', 'state.json'), 'corrupt\n', 'utf8');
    assert.equal(readProjectState(root, 'PRJ-HEALTHY').workItems[0]?.id, item.id);
    assert.throws(() => readProjectState(root, 'PRJ-CORRUPT'), /checksum mismatch/);
    assert.equal(report.phase, 'cutover');
    createWorkItem(
      root,
      {
        projectId: 'PRJ-HEALTHY',
        title: 'Stale',
        summary: 'Stale',
        acceptanceCriteria: [],
        scopeIn: [],
        scopeOut: [],
        verificationStrategy: [],
      },
      'fixture',
      clock,
    );
    assert.throws(() => migrateProjectStores(root, { resume: true }), /Stale global state replay rejected/);
  });

  it('rolls back only while writes are fenced', () => {
    const root = fixture();
    makeProject(root, 'PRJ-A');
    migrateProjectStores(root);
    rollbackProjectStores(root);
    assert.equal(existsSync(join(root, '.themis', 'projects')), false);
    assert.equal(readProjectState(root, 'PRJ-A').workItems.length, 1);
  });

  it('validates, backs up, restores, and synchronizes a store independently', () => {
    const root = fixture();
    const item = makeProject(root, 'PRJ-A');
    makeProject(root, 'PRJ-B');
    migrateProjectStores(root);
    const original = validateProjectStore(root, 'PRJ-A');
    const backupId = backupProjectStore(root, 'PRJ-A');
    writeFileSync(join(root, '.themis', 'projects', 'PRJ-A', 'state.json'), '{}\n', 'utf8');
    assert.throws(() => validateProjectStore(root, 'PRJ-A'), /checksum mismatch/);
    assert.deepEqual(restoreProjectStore(root, 'PRJ-A', backupId), original);
    assert.deepEqual(synchronizeProjectStore(root, 'PRJ-A'), original);
    assert.equal(readProjectState(root, 'PRJ-A').workItems[0]?.id, item.id);
  });

  it('quarantines every orphan and ambiguous record exactly once', () => {
    const root = fixture();
    makeProject(root, 'PRJ-A');
    makeProject(root, 'PRJ-B');
    const statePath = join(root, '.themis', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown[]>;
    state.epics.push({
      id: 'ORPHAN-EPIC',
      projectId: 'MISSING',
      title: 'Orphan',
      summary: '',
      goal: '',
      status: 'draft',
      createdAt: clock(),
    });
    state.workItems.push({
      id: 'ORPHAN-ITEM',
      projectId: 'MISSING',
      title: 'Orphan',
      summary: '',
      status: 'draft',
      acceptanceCriteria: [],
      scopeIn: [],
      scopeOut: [],
      verificationStrategy: [],
    });
    state.reviews.push({
      id: 'AMBIGUOUS-REVIEW',
      workItemId: 'PRJ-A-ITEM',
      runId: 'MISSING-RUN',
      reviewer: 'fixture',
      createdAt: clock(),
    });
    state.sprintEvidence.push({
      id: 'SEVD-ORPHAN',
      sprintId: 'MISSING-SPRINT',
      kind: 'verification',
      summary: 'orphan',
      value: 'orphan',
      createdAt: clock(),
    });
    writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    migrateProjectStores(root);
    const quarantine = JSON.parse(readFileSync(join(root, '.themis', 'migration', 'quarantine.json'), 'utf8')) as {
      records: Array<{ kind: string; id: string }>;
    };
    const keys = quarantine.records.map((record) => `${record.kind}:${record.id}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(
      keys.filter((key) => key.includes('ORPHAN') || key.includes('AMBIGUOUS')),
      ['epic:ORPHAN-EPIC', 'work-item:ORPHAN-ITEM', 'sprint-evidence:SEVD-ORPHAN', 'review:AMBIGUOUS-REVIEW'],
    );
    assert.ok(
      keys.some((key) => key.includes('SEVD-ORPHAN')),
      keys.join(', '),
    );
  });
});

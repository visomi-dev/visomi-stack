import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  activateSprint,
  addDependency,
  addEvidence,
  addSprintEvidence,
  approveSprint,
  claimWorkItem,
  closeSprint,
  createEpic,
  createProject,
  createWorkItem,
  finishRun,
  flowReadyQueue,
  proposeSprint,
  readState,
  readyQueue,
  removeSprints,
  requestReview,
  startRun,
  submitReview,
  timeline,
  transitionWorkItem,
  updateWorkItem,
  validateState,
  workspaceStatus,
} from '../libs/themis-workflow/src/lib/legacy-workflow-internal.ts';

const roots: string[] = [];
const clock = (() => {
  let sequence = 0;
  return () => `2026-08-15T00:00:${String(sequence++).padStart(2, '0')}.000Z`;
})();

const createFixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'themis-opencode-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const itemInput = (title: string) => ({
  title,
  summary: `${title} summary`,
  acceptanceCriteria: [`${title} works`],
  scopeIn: ['fixture/**'],
  scopeOut: ['production/**'],
  verificationStrategy: ['node --test fixture'],
});

describe('local Themis workflow', () => {
  it('detects first-run workspaces and scopes the audit timeline by project', () => {
    const root = createFixture();
    assert.deepEqual(workspaceStatus(root), {
      initialized: false,
      stateFileExists: false,
      eventsFileExists: false,
      counts: { projects: 0, epics: 0, workItems: 0, sprints: 0 },
    });

    createProject(root, { id: 'PRJ-ONE', name: 'One', summary: 'First project' }, 'human:test', clock);
    createProject(root, { id: 'PRJ-TWO', name: 'Two', summary: 'Second project' }, 'human:test', clock);

    assert.equal(workspaceStatus(root).initialized, true);
    assert.deepEqual(
      timeline(root, 'PRJ-ONE').map((event) => event.aggregateId),
      ['PRJ-ONE'],
    );
  });

  it('executes the complete proposal to accepted review flow', () => {
    const root = createFixture();
    const first = createWorkItem(root, itemInput('Create adapter'), 'agent:planner', clock);
    const second = createWorkItem(root, itemInput('Test adapter'), 'agent:planner', clock);
    transitionWorkItem(root, first.id, 'ready', 'agent:planner', clock);
    transitionWorkItem(root, second.id, 'ready', 'agent:planner', clock);
    addDependency(root, first.id, second.id, 'agent:planner', clock);

    const revision = proposeSprint(
      root,
      {
        goal: 'Validate local agent coordination',
        why: 'The workflow must be deterministic before product integration',
        what: 'A tested local adapter workflow',
        how: 'Run planner, executor, verifier, and reviewer gates',
        workItemIds: [first.id, second.id],
        nonGoals: ['SQLite', 'Themis UI'],
        definitionOfDone: ['Review accepted'],
        verificationStrategy: ['node --experimental-strip-types --test scripts/themis-core.test.ts'],
      },
      'agent:planner',
      clock,
    );
    approveSprint(root, revision.sprintId, revision.id, 'human:owner', clock);
    activateSprint(root, revision.sprintId, revision.id, 'human:owner', clock);

    assert.deepEqual(
      readyQueue(root, revision.sprintId).map((item) => item.id),
      [first.id],
    );
    claimWorkItem(root, first.id, 'themis-executor', 'agent:executor', clock);
    const run = startRun(root, first.id, 'themis-executor', 'agent:executor', clock);
    addEvidence(
      root,
      run.id,
      'implementation-diff',
      'Adapter implementation',
      'commit fixture-001',
      'agent:executor',
      clock,
    );
    addEvidence(
      root,
      run.id,
      'verification',
      'Fixture tests passed',
      'node --test fixture: PASS',
      'agent:verifier',
      clock,
    );
    finishRun(root, run.id, 'completed', 'Verification passed', 'agent:verifier', clock);
    const review = requestReview(root, first.id, 'themis-reviewer', 'agent:executor', clock);
    submitReview(root, review.id, 'accepted', 'Acceptance criteria satisfied', 'agent:reviewer', clock);

    assert.deepEqual(
      readyQueue(root, revision.sprintId).map((item) => item.id),
      [second.id],
    );
    assert.equal(validateState(root).valid, true);
    const events = readFileSync(join(root, '.themis/events.ndjson'), 'utf8').trim().split('\n');
    assert.equal(events.length, 15);
  });

  it('updates a completed item, reopens it for rework, and preserves its history', () => {
    const root = createFixture();
    const item = createWorkItem(root, itemInput('Update validation'), 'agent:planner', clock);
    transitionWorkItem(root, item.id, 'ready', 'agent:planner', clock);
    claimWorkItem(root, item.id, 'themis-executor', 'agent:executor', clock);
    const run = startRun(root, item.id, 'themis-executor', 'agent:executor', clock);
    addEvidence(root, run.id, 'implementation-diff', 'Diff', 'fixture', 'agent:executor', clock);
    addEvidence(root, run.id, 'verification', 'Checks', 'PASS', 'agent:verifier', clock);
    finishRun(root, run.id, 'completed', 'Checks passed', 'agent:verifier', clock);
    const review = requestReview(root, item.id, 'themis-reviewer', 'agent:executor', clock);
    submitReview(root, review.id, 'accepted', 'Accepted', 'agent:reviewer', clock);

    const updated = updateWorkItem(
      root,
      item.id,
      { verificationStrategy: ['[app-e2e][required] pnpm exec nx run app-e2e:e2e'] },
      'agent:planner',
      clock,
    );

    assert.equal(updated.status, 'rework');
    assert.deepEqual(updated.verificationStrategy, ['[app-e2e][required] pnpm exec nx run app-e2e:e2e']);
    assert.equal(readState(root).runs.length, 1);
    assert.equal(readState(root).reviews[0]?.verdict, 'accepted');
    assert.equal(timeline(root).at(-1)?.type, 'workitem.updated');

    transitionWorkItem(root, item.id, 'claimed', 'agent:coordinator', clock);
    assert.equal(readState(root).workItems[0]?.status, 'claimed');
  });

  it('requires final sprint evidence before closing and releases the project slot', () => {
    const root = createFixture();
    const item = createWorkItem(root, itemInput('Close sprint'), 'agent:planner', clock);
    transitionWorkItem(root, item.id, 'ready', 'agent:planner', clock);
    const revision = proposeSprint(
      root,
      {
        goal: 'Close a verified sprint',
        why: 'A completed sprint must release its project slot',
        what: 'A formally closed sprint',
        how: 'Complete the item, verify it, then close the sprint',
        workItemIds: [item.id],
        nonGoals: [],
        definitionOfDone: ['Final sprint verification recorded'],
        verificationStrategy: ['node --test scripts/themis-core.test.ts'],
      },
      'agent:planner',
      clock,
    );
    approveSprint(root, revision.sprintId, revision.id, 'human:owner', clock);
    activateSprint(root, revision.sprintId, revision.id, 'human:owner', clock);
    assert.throws(() => closeSprint(root, revision.sprintId, 'PRJ-LOCAL', 'human:owner', clock), /unfinished work/);

    claimWorkItem(root, item.id, 'themis-executor', 'agent:executor', clock);
    const run = startRun(root, item.id, 'themis-executor', 'agent:executor', clock);
    addEvidence(
      root,
      run.id,
      'implementation-diff',
      'Implementation exists',
      'commit close-001',
      'agent:executor',
      clock,
    );
    addEvidence(root, run.id, 'verification', 'Item tests passed', 'node --test: PASS', 'agent:verifier', clock);
    finishRun(root, run.id, 'completed', 'Verification passed', 'agent:verifier', clock);
    const review = requestReview(root, item.id, 'themis-reviewer', 'agent:executor', clock);
    submitReview(root, review.id, 'accepted', 'Acceptance criteria satisfied', 'agent:reviewer', clock);
    assert.throws(
      () => closeSprint(root, revision.sprintId, 'PRJ-LOCAL', 'human:owner', clock),
      /missing final verification evidence/,
    );

    addSprintEvidence(
      root,
      revision.sprintId,
      'verification',
      'Sprint checks passed',
      'node --test: PASS',
      'agent:verifier',
      clock,
    );
    const closed = closeSprint(root, revision.sprintId, 'PRJ-LOCAL', 'human:owner', clock);
    assert.equal(closed.status, 'closed');
    assert.equal(closed.closedBy, 'human:owner');

    const nextItem = createWorkItem(root, itemInput('Start next sprint'), 'agent:planner', clock);
    transitionWorkItem(root, nextItem.id, 'ready', 'agent:planner', clock);
    const nextRevision = proposeSprint(
      root,
      {
        goal: 'Start the next sprint',
        why: 'The previous sprint is formally closed',
        what: 'A new executable baseline',
        how: 'Activate the next approved revision',
        workItemIds: [nextItem.id],
        nonGoals: [],
        definitionOfDone: ['Next item is executable'],
        verificationStrategy: ['node --test scripts/themis-core.test.ts'],
      },
      'agent:planner',
      clock,
    );
    approveSprint(root, nextRevision.sprintId, nextRevision.id, 'human:owner', clock);
    const nextSprint = activateSprint(root, nextRevision.sprintId, nextRevision.id, 'human:owner', clock);
    assert.equal(nextSprint.status, 'active');
    assert.equal(validateState(root).valid, true);
  });

  it('executes ready work through project flow without an active sprint', () => {
    const root = createFixture();
    const item = createWorkItem(root, itemInput('Flow item'), 'agent:planner', clock);
    transitionWorkItem(root, item.id, 'ready', 'agent:planner', clock);

    assert.deepEqual(
      flowReadyQueue(root, 'PRJ-LOCAL').map((entry) => entry.id),
      [item.id],
    );
    claimWorkItem(root, item.id, 'themis-executor', 'agent:executor', clock);
    assert.equal(readFileSync(join(root, '.themis/state.json'), 'utf8').includes('"status": "claimed"'), true);
  });

  it('removes sprint planning state and returns planned work to project flow', () => {
    const root = createFixture();
    const item = createWorkItem(root, itemInput('Remove sprint state'), 'agent:planner', clock);
    transitionWorkItem(root, item.id, 'ready', 'agent:planner', clock);
    const revision = proposeSprint(
      root,
      {
        goal: 'Temporary planning boundary',
        why: 'Validate sprint removal',
        what: 'A flow item without sprint state',
        how: 'Activate and remove the planning boundary',
        workItemIds: [item.id],
        nonGoals: [],
        definitionOfDone: ['Flow queue contains the item'],
        verificationStrategy: ['node --test'],
      },
      'agent:planner',
      clock,
    );
    approveSprint(root, revision.sprintId, revision.id, 'human:owner', clock);
    activateSprint(root, revision.sprintId, revision.id, 'human:owner', clock);

    const removed = removeSprints(root, undefined, 'human:owner', clock);
    assert.deepEqual(removed.removedSprintIds, [revision.sprintId]);
    assert.deepEqual(
      flowReadyQueue(root, 'PRJ-LOCAL').map((entry) => entry.id),
      [item.id],
    );
    assert.equal(readState(root).sprints.length, 0);
    assert.equal(validateState(root).valid, true);
  });

  it('rejects blocked work and missing review evidence', () => {
    const root = createFixture();
    const blocker = createWorkItem(root, itemInput('Blocker'), 'agent:planner', clock);
    const blocked = createWorkItem(root, itemInput('Blocked item'), 'agent:planner', clock);
    transitionWorkItem(root, blocker.id, 'ready', 'agent:planner', clock);
    transitionWorkItem(root, blocked.id, 'ready', 'agent:planner', clock);
    addDependency(root, blocker.id, blocked.id, 'agent:planner', clock);
    const revision = proposeSprint(
      root,
      {
        goal: 'Exercise rejection paths',
        why: 'Invalid execution must be rejected',
        what: 'A blocked queue',
        how: 'Leave the blocker incomplete',
        workItemIds: [blocker.id, blocked.id],
        nonGoals: [],
        definitionOfDone: ['Rejected transitions are explicit'],
        verificationStrategy: ['node --test'],
      },
      'agent:planner',
      clock,
    );
    approveSprint(root, revision.sprintId, revision.id, 'human:owner', clock);
    activateSprint(root, revision.sprintId, revision.id, 'human:owner', clock);
    assert.deepEqual(
      readyQueue(root, revision.sprintId).map((item) => item.id),
      [blocker.id],
    );
    assert.throws(() => claimWorkItem(root, blocked.id, 'themis-executor', 'agent:executor', clock), /blocked by/);
    claimWorkItem(root, blocker.id, 'themis-executor', 'agent:executor', clock);
    const run = startRun(root, blocker.id, 'themis-executor', 'agent:executor', clock);
    finishRun(root, run.id, 'completed', 'No evidence was recorded', 'agent:verifier', clock);
    assert.throws(
      () => requestReview(root, blocker.id, 'themis-reviewer', 'agent:executor', clock),
      /missing verification evidence/,
    );
  });

  it('moves rejected reviews to rework', () => {
    const root = createFixture();
    const item = createWorkItem(root, itemInput('Reviewable item'), 'agent:planner', clock);
    transitionWorkItem(root, item.id, 'ready', 'agent:planner', clock);
    const revision = proposeSprint(
      root,
      {
        goal: 'Exercise review rework',
        why: 'Rejected work must be actionable',
        what: 'A review decision',
        how: 'Reject the implementation',
        workItemIds: [item.id],
        nonGoals: [],
        definitionOfDone: ['Rework is visible'],
        verificationStrategy: ['node --test'],
      },
      'agent:planner',
      clock,
    );
    approveSprint(root, revision.sprintId, revision.id, 'human:owner', clock);
    activateSprint(root, revision.sprintId, revision.id, 'human:owner', clock);
    claimWorkItem(root, item.id, 'themis-executor', 'agent:executor', clock);
    const run = startRun(root, item.id, 'themis-executor', 'agent:executor', clock);
    addEvidence(root, run.id, 'implementation-diff', 'Diff exists', 'commit fixture-002', 'agent:executor', clock);
    addEvidence(root, run.id, 'verification', 'Tests passed', 'node --test: PASS', 'agent:verifier', clock);
    finishRun(root, run.id, 'completed', 'Checks passed', 'agent:verifier', clock);
    const review = requestReview(root, item.id, 'themis-reviewer', 'agent:executor', clock);
    submitReview(root, review.id, 'rejected', 'Add a regression test', 'agent:reviewer', clock);
    assert.equal(readyQueue(root, revision.sprintId).length, 0);
    assert.equal(validateState(root).valid, true);
  });

  it('requires the latest completed run after rework', () => {
    const root = createFixture();
    const item = createWorkItem(root, itemInput('Reworkable item'), 'agent:planner', clock);
    transitionWorkItem(root, item.id, 'ready', 'agent:planner', clock);
    const revision = proposeSprint(
      root,
      {
        goal: 'Exercise current run review binding',
        why: 'Reviews must use evidence from the latest implementation attempt',
        what: 'A review bound to the current run',
        how: 'Reject the first run and complete a second run',
        workItemIds: [item.id],
        nonGoals: [],
        definitionOfDone: ['Stale evidence is rejected'],
        verificationStrategy: ['node --test'],
      },
      'agent:planner',
      clock,
    );
    approveSprint(root, revision.sprintId, revision.id, 'human:owner', clock);
    activateSprint(root, revision.sprintId, revision.id, 'human:owner', clock);
    claimWorkItem(root, item.id, 'themis-executor', 'agent:executor', clock);

    const firstRun = startRun(root, item.id, 'themis-executor', 'agent:executor', clock);
    addEvidence(
      root,
      firstRun.id,
      'implementation-diff',
      'First diff exists',
      'commit fixture-first',
      'agent:executor',
      clock,
    );
    addEvidence(root, firstRun.id, 'verification', 'First checks passed', 'node --test: PASS', 'agent:verifier', clock);
    finishRun(root, firstRun.id, 'completed', 'First checks passed', 'agent:verifier', clock);
    const firstReview = requestReview(root, item.id, 'themis-reviewer', 'agent:executor', clock);
    submitReview(root, firstReview.id, 'rejected', 'Rework required', 'agent:reviewer', clock);

    transitionWorkItem(root, item.id, 'claimed', 'agent:executor', clock);
    const secondRun = startRun(root, item.id, 'themis-executor', 'agent:executor', clock);
    finishRun(root, secondRun.id, 'completed', 'Second run failed to record evidence', 'agent:verifier', clock);
    assert.throws(
      () => requestReview(root, item.id, 'themis-reviewer', 'agent:executor', clock),
      /missing verification evidence/,
    );
  });

  it('rejects transitions outside the state machine', () => {
    const root = createFixture();
    const item = createWorkItem(root, itemInput('Invalid transition'), 'agent:planner', clock);
    assert.throws(
      () => transitionWorkItem(root, item.id, 'done', 'agent:planner', clock),
      /cannot move from draft to done/,
    );
  });

  it('scopes active sprints by project and keeps epic ownership explicit', () => {
    const root = createFixture();
    createProject(root, { id: 'PRJ-A', name: 'Project A', summary: 'First project' }, 'human:test', clock);
    createProject(root, { id: 'PRJ-B', name: 'Project B', summary: 'Second project' }, 'human:test', clock);
    createEpic(
      root,
      { id: 'EPIC-A', projectId: 'PRJ-A', title: 'Epic A', summary: 'A', goal: 'Deliver A' },
      'agent:planner',
      clock,
    );
    createEpic(
      root,
      { id: 'EPIC-B', projectId: 'PRJ-B', title: 'Epic B', summary: 'B', goal: 'Deliver B' },
      'agent:planner',
      clock,
    );
    const itemA = createWorkItem(
      root,
      { ...itemInput('Project A item'), projectId: 'PRJ-A', epicId: 'EPIC-A' },
      'agent:planner',
      clock,
    );
    const itemB = createWorkItem(
      root,
      { ...itemInput('Project B item'), projectId: 'PRJ-B', epicId: 'EPIC-B' },
      'agent:planner',
      clock,
    );
    transitionWorkItem(root, itemA.id, 'ready', 'agent:planner', clock);
    transitionWorkItem(root, itemB.id, 'ready', 'agent:planner', clock);

    const revisionA = proposeSprint(
      root,
      {
        projectId: 'PRJ-A',
        epicIds: ['EPIC-A'],
        goal: 'Ship project A increment',
        why: 'A has independent delivery',
        what: 'A increment',
        how: 'Implement and verify A',
        workItemIds: [itemA.id],
        nonGoals: [],
        definitionOfDone: ['Review accepted'],
        verificationStrategy: ['node --test'],
      },
      'agent:planner',
      clock,
    );
    const revisionB = proposeSprint(
      root,
      {
        projectId: 'PRJ-B',
        epicIds: ['EPIC-B'],
        goal: 'Ship project B increment',
        why: 'B has independent delivery',
        what: 'B increment',
        how: 'Implement and verify B',
        workItemIds: [itemB.id],
        nonGoals: [],
        definitionOfDone: ['Review accepted'],
        verificationStrategy: ['node --test'],
      },
      'agent:planner',
      clock,
    );
    approveSprint(root, revisionA.sprintId, revisionA.id, 'human:owner', clock);
    approveSprint(root, revisionB.sprintId, revisionB.id, 'human:owner', clock);
    activateSprint(root, revisionA.sprintId, revisionA.id, 'human:owner', clock);
    activateSprint(root, revisionB.sprintId, revisionB.id, 'human:owner', clock);

    assert.deepEqual(
      readyQueue(root, revisionA.sprintId, 'PRJ-A').map((item) => item.id),
      [itemA.id],
    );
    assert.deepEqual(
      readyQueue(root, revisionB.sprintId, 'PRJ-B').map((item) => item.id),
      [itemB.id],
    );
    assert.equal(validateState(root).valid, true);
  });
});

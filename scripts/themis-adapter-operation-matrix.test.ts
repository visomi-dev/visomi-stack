import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ProjectWorkflowStore, WorkspaceRegistry } from '../libs/themis-workflow/src/index.ts';
import {
  dependency_add,
  epic_list,
  evidence_add,
  flow_ready_queue,
  project_create,
  ready_queue,
  review_request,
  review_submit,
  run_finish,
  run_start,
  sprint_activate,
  sprint_approve,
  sprint_close,
  sprint_evidence_add,
  sprint_list,
  sprint_propose,
  sprints_remove,
  timeline_list,
  work_claim,
  workitem_create,
  workitem_get,
  workitem_list,
  workitem_transition,
  workitem_update,
} from '../.opencode/tools/themis.ts';

import { cliCases, operationFamilies } from './themis-adapter-cli-cases.ts';
import { callTool, toolCases } from './themis-adapter-tool-cases.ts';
import type { ToolDefinition } from './themis-adapter-tool-cases.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const family of operationFamilies) {
  for (const operation of family.operations) {
    assert.ok(cliCases[operation], `${family.name}: missing ${operation}`);
  }
}

const runCli = (root: string, args: string[]): { status: number | null; output: string } => {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      fileURLToPath(new URL('./themis-cli.ts', import.meta.url)),
      ...args,
      '--root',
      root,
      '--json',
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );

  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
};

const withProject = (args: string[], project: string): string[] => [...args, '--project', project];

const assertCliRejected = (root: string, args: string[], label: string): void => {
  const result = runCli(root, args);

  assert.notEqual(result.status, 0, `${label} unexpectedly accepted unauthorized project authority`);
  assert.match(
    result.output,
    /project|registered|disabled|moved|unknown/i,
    `${label} did not expose a bounded project error`,
  );
};

const assertCliOutputDoesNotContain = (root: string, args: string[], forbidden: string[], label: string): void => {
  const result = runCli(root, args);

  assert.equal(result.status, 0, `${label} failed: ${result.output}`);
  for (const value of forbidden) {
    assert.equal(result.output.includes(value), false, `${label} disclosed ${value}`);
  }
};

const prepareRoot = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));

  roots.push(root);
  assert.equal(runCli(root, ['project-create', '--project', 'one', '--name', 'One']).status, 0);
  assert.equal(runCli(root, ['project-create', '--project', 'two', '--name', 'Two']).status, 0);

  return root;
};

describe('adapter operation-to-test authorization matrix', () => {
  for (const family of operationFamilies) {
    for (const operation of family.operations) {
      it(`CLI rejects missing project scope: ${operation}`, () => {
        const root = mkdtempSync(join(tmpdir(), 'themis-adapter-missing-'));

        roots.push(root);
        assertCliRejected(root, cliCases[operation], `${family.name}/${operation}`);
      });
    }
  }

  for (const family of operationFamilies) {
    for (const operation of family.operations) {
      it(`CLI rejects unregistered project: ${operation}`, () => {
        const root = mkdtempSync(join(tmpdir(), 'themis-adapter-unregistered-'));

        roots.push(root);
        assertCliRejected(root, withProject(cliCases[operation], 'missing'), `${family.name}/${operation}`);
      });
      it(`CLI rejects disabled project: ${operation}`, () => {
        const root = prepareRoot('themis-adapter-disabled-');

        new WorkspaceRegistry(root).disable('one');
        assertCliRejected(root, withProject(cliCases[operation], 'one'), `${family.name}/${operation}`);
      });
      it(`CLI rejects moved project root: ${operation}`, () => {
        const root = prepareRoot('themis-adapter-moved-');

        new WorkspaceRegistry(root).update('one', { rootPath: join(root, 'moved-root') });
        assertCliRejected(root, withProject(cliCases[operation], 'one'), `${family.name}/${operation}`);
      });
    }
  }

  it('CLI rejects foreign entity identifiers across project-bound families', () => {
    const root = prepareRoot('themis-adapter-foreign-');
    const domain = new ProjectWorkflowStore(new WorkspaceRegistry(root), 'one').domain();
    const epic = domain.createEpic({ id: 'EPIC-ONE', projectId: 'one', title: 'One epic', summary: '', goal: '' });
    const item = domain.createWorkItem({
      id: 'ITEM-ONE',
      projectId: 'one',
      epicId: epic.id,
      title: 'Item',
      summary: '',
      acceptanceCriteria: ['done'],
      scopeIn: ['src/**'],
      scopeOut: [],
      verificationStrategy: ['node --test'],
    });

    domain.transitionWorkItem(item.id, 'ready');
    const revision = domain.proposeSprint({
      projectId: 'one',
      goal: 'Goal',
      why: 'Why',
      what: 'What',
      how: 'How',
      workItemIds: [item.id],
      epicIds: [epic.id],
      nonGoals: [],
      definitionOfDone: ['done'],
      verificationStrategy: ['node --test'],
    });

    domain.claimWorkItem(item.id, 'agent:one');
    const run = domain.startRun(item.id, 'agent:one');

    domain.finishRun(run.id, 'completed', 'done');
    domain.addEvidence(run.id, 'verification', 'done', 'done');
    domain.addEvidence(run.id, 'implementation-diff', 'done', 'done');
    const review = domain.requestReview(item.id, 'reviewer:one');

    for (const args of [
      ['ready', '--sprint', revision.sprintId],
      ['work-list', '--epic', epic.id],
      ['work-transition', '--id', item.id, '--to', 'ready'],
      ['work-update', '--id', item.id],
      ['dependency-add', '--from', item.id, '--to', item.id],
      ['sprint-approve', '--sprint', revision.sprintId, '--revision', revision.id],
      ['sprint-activate', '--sprint', revision.sprintId, '--revision', revision.id],
      [
        'sprint-evidence-add',
        '--sprint',
        revision.sprintId,
        '--kind',
        'verification',
        '--summary',
        'x',
        '--value',
        'x',
      ],
      ['sprint-close', '--sprint', revision.sprintId],
      ['claim', '--id', item.id],
      ['run-start', '--work-item', item.id],
      ['run-finish', '--run', run.id, '--status', 'completed', '--reason', 'foreign'],
      ['evidence-add', '--run', run.id, '--kind', 'verification', '--summary', 'x', '--value', 'x'],
      ['review-request', '--work-item', item.id, '--reviewer', 'reviewer'],
      ['review-submit', '--review', review.id, '--verdict', 'accepted', '--feedback', 'foreign'],
    ]) {
      assertCliRejected(root, withProject(args, 'two'), `foreign/${args[0]}`);
    }

    assertCliOutputDoesNotContain(root, ['timeline', '--project', 'two'], ['ITEM-ONE', 'EPIC-ONE'], 'foreign/timeline');
    assertCliOutputDoesNotContain(
      root,
      ['project-list', '--project', 'two'],
      ['One', 'EPIC-ONE', 'ITEM-ONE'],
      'foreign/project-list',
    );
    assertCliOutputDoesNotContain(
      root,
      ['project-list', '--project', 'two'],
      ['One'],
      'foreign/project-list-identifier',
    );
    assert.match(runCli(root, ['project-list', '--project', 'two']).output, /Two/);
    assertCliOutputDoesNotContain(root, ['epic-list', '--project', 'two'], ['EPIC-ONE'], 'foreign/epic-list');
    assertCliOutputDoesNotContain(
      root,
      ['sprint-list', '--project', 'two'],
      [revision.sprintId],
      'foreign/sprint-list',
    );
  });

  it('CLI and OpenCode adapters redact registry locators from records, envelopes, and metadata', async () => {
    const root = prepareRoot('themis-adapter-redaction-');
    const localPath = join(root, 'private', 'workspace');
    const protectedValues = [
      localPath,
      'private-key-material',
      'secret-token',
      'protected-locator-hash',
      'nested-workspace-root',
      'nested-private-key',
      'nested-token',
      'nested-password',
    ];
    const store = new ProjectWorkflowStore(new WorkspaceRegistry(root), 'one');

    store.append('protected.metadata', 'matrix', {
      rootPath: localPath,
      path: localPath,
      key: protectedValues[1],
      secret: protectedValues[2],
      locatorHash: protectedValues[3],
      workspaceRoot: protectedValues[4],
      privateKey: protectedValues[5],
      token: protectedValues[6],
      password: protectedValues[7],
      envelope: {
        rootPath: localPath,
        workspaceRoot: protectedValues[4],
        key: protectedValues[1],
        privateKey: protectedValues[5],
        secret: protectedValues[2],
        token: protectedValues[6],
        password: protectedValues[7],
        path: localPath,
      },
    });

    assertCliOutputDoesNotContain(root, ['timeline', '--project', 'one'], protectedValues, 'cli/timeline-redaction');
    assertCliOutputDoesNotContain(
      root,
      ['project-list', '--project', 'one'],
      [localPath, protectedValues[3]],
      'cli/registry-metadata',
    );

    const context = { worktree: root, agent: 'matrix', directory: root } as never;
    const result = await (timeline_list as ToolDefinition).execute({ projectId: 'one' } as never, context);
    const output = JSON.parse(result as string);
    const serialized = JSON.stringify(output);

    for (const value of protectedValues) {
      assert.equal(serialized.includes(value), false, `opencode disclosed ${value}`);
    }
  });

  it('proves OpenCode tools require a registered project and reject a foreign read', async () => {
    const root = mkdtempSync(join(tmpdir(), 'themis-adapter-opencode-'));

    roots.push(root);
    const context = { worktree: root, agent: 'matrix', directory: root } as never;
    const invoke = async (definition: { execute: (args: never, context: never) => Promise<string> }, args: unknown) => {
      const result = await definition.execute(args as never, context);

      return JSON.parse(result);
    };

    await invoke(project_create, { projectId: 'one', name: 'One', summary: '' });
    await invoke(project_create, { projectId: 'two', name: 'Two', summary: '' });
    const item = await invoke(workitem_create, {
      projectId: 'one',
      title: 'Item',
      summary: '',
      acceptanceCriteria: [],
      scopeIn: ['test'],
      scopeOut: [],
      verificationStrategy: [],
    });
    const foreign = await invoke(workitem_get, { projectId: 'two', id: item.id });

    assert.equal(foreign.error, `Work item not found: ${item.id}`);
  });
});

describe('OpenCode adapter authorization matrix', () => {
  for (const toolCase of toolCases) {
    for (const state of ['missing', 'unregistered', 'disabled', 'moved-root'] as const) {
      it(`OpenCode ${toolCase.name} rejects ${state} project authority`, async () => {
        const root =
          state === 'missing'
            ? mkdtempSync(join(tmpdir(), 'themis-opencode-missing-'))
            : prepareRoot(`themis-opencode-${state}-`);

        roots.push(root);
        if (state === 'disabled') {
          new WorkspaceRegistry(root).disable('one');
        }
        if (state === 'moved-root') {
          new WorkspaceRegistry(root).update('one', { rootPath: join(root, 'moved-root') });
        }
        const args =
          state === 'missing'
            ? { ...toolCase.args }
            : { ...toolCase.args, projectId: state === 'unregistered' ? 'missing' : 'one' };
        const result = await callTool(toolCase.definition, args, root);

        assert.equal(result.ok, false, `${toolCase.family}/${toolCase.name} accepted ${state}`);
        assert.match(result.output, /project|registered|disabled|moved|unknown/i);
      });
    }
  }

  it('OpenCode rejects foreign work-item and workflow identifiers', async () => {
    const root = prepareRoot('themis-opencode-foreign-');
    const foreign = toolCases.filter(({ name }) =>
      ['workitem_get', 'workitem_transition', 'dependency_add', 'run_start', 'review_request'].includes(name),
    );

    for (const toolCase of foreign) {
      const result = await callTool(toolCase.definition, { ...toolCase.args, projectId: 'two' }, root);

      assert.equal(result.ok, false, `foreign/${toolCase.name} unexpectedly succeeded`);
      assert.match(result.output, /unknown|not found|project|scope/i);
    }
  });

  it('OpenCode rejects foreign identifiers across every applicable operation family', async () => {
    const root = prepareRoot('themis-opencode-foreign-families-');
    const domain = new ProjectWorkflowStore(new WorkspaceRegistry(root), 'one').domain();
    const epic = domain.createEpic({ id: 'EPIC-ONE', projectId: 'one', title: 'One epic', summary: '', goal: '' });
    const item = domain.createWorkItem({
      id: 'ITEM-ONE',
      projectId: 'one',
      epicId: epic.id,
      title: 'Item',
      summary: '',
      acceptanceCriteria: ['done'],
      scopeIn: ['test'],
      scopeOut: [],
      verificationStrategy: ['test'],
    });

    domain.transitionWorkItem(item.id, 'ready');
    const revision = domain.proposeSprint({
      projectId: 'one',
      goal: 'Goal',
      why: 'Why',
      what: 'What',
      how: 'How',
      workItemIds: [item.id],
      epicIds: [epic.id],
      nonGoals: [],
      definitionOfDone: ['done'],
      verificationStrategy: ['test'],
    });

    domain.claimWorkItem(item.id, 'agent:one');
    const run = domain.startRun(item.id, 'agent:one');

    domain.finishRun(run.id, 'completed', 'done');
    domain.addEvidence(run.id, 'verification', 'done', 'done');
    domain.addEvidence(run.id, 'implementation-diff', 'done', 'done');
    const review = domain.requestReview(item.id, 'reviewer:one');
    const foreignCases: Array<{ name: string; definition: ToolDefinition; args: Record<string, unknown> }> = [
      { name: 'ready_queue', definition: ready_queue as ToolDefinition, args: { sprintId: revision.sprintId } },
      { name: 'workitem_list', definition: workitem_list as ToolDefinition, args: { epicId: epic.id } },
      { name: 'workitem_get', definition: workitem_get as ToolDefinition, args: { id: item.id } },
      {
        name: 'workitem_transition',
        definition: workitem_transition as ToolDefinition,
        args: { id: item.id, to: 'ready' },
      },
      {
        name: 'workitem_update',
        definition: workitem_update as ToolDefinition,
        args: { id: item.id, title: 'foreign' },
      },
      { name: 'dependency_add', definition: dependency_add as ToolDefinition, args: { from: item.id, to: item.id } },
      { name: 'sprint_propose', definition: sprint_propose as ToolDefinition, args: { workItemIds: [item.id] } },
      {
        name: 'sprint_approve',
        definition: sprint_approve as ToolDefinition,
        args: { sprintId: revision.sprintId, revisionId: revision.id },
      },
      {
        name: 'sprint_activate',
        definition: sprint_activate as ToolDefinition,
        args: { sprintId: revision.sprintId, revisionId: revision.id },
      },
      {
        name: 'sprint_evidence_add',
        definition: sprint_evidence_add as ToolDefinition,
        args: { sprintId: revision.sprintId, kind: 'verification', summary: 'x', value: 'x' },
      },
      { name: 'sprint_close', definition: sprint_close as ToolDefinition, args: { sprintId: revision.sprintId } },
      { name: 'work_claim', definition: work_claim as ToolDefinition, args: { id: item.id, agent: 'agent:foreign' } },
      {
        name: 'run_start',
        definition: run_start as ToolDefinition,
        args: { workItemId: item.id, agent: 'agent:foreign' },
      },
      {
        name: 'run_finish',
        definition: run_finish as ToolDefinition,
        args: { runId: run.id, status: 'completed', terminationReason: 'foreign' },
      },
      {
        name: 'evidence_add',
        definition: evidence_add as ToolDefinition,
        args: { runId: run.id, kind: 'verification', summary: 'x', value: 'x' },
      },
      {
        name: 'review_request',
        definition: review_request as ToolDefinition,
        args: { workItemId: item.id, reviewer: 'reviewer:foreign' },
      },
      {
        name: 'review_submit',
        definition: review_submit as ToolDefinition,
        args: { reviewId: review.id, verdict: 'accepted', feedback: 'foreign' },
      },
    ];
    const results = await Promise.all(
      foreignCases.map(async ({ name, definition, args }) => {
        const result = await callTool(definition, { ...args, projectId: 'two' }, root);

        return { name, result };
      }),
    );

    for (const { name, result } of results) {
      assert.equal(result.ok, false, `foreign/${name} unexpectedly succeeded`);
      assert.match(result.output, /unknown|not found|project|scope/i, `foreign/${name} lacked a bounded error`);
    }

    // sprints_remove is project-scoped and intentionally has no sprintId input.
    // A call authorized for project two cannot target project one's sprint.
    const removeForeign = await callTool(sprints_remove as ToolDefinition, { projectId: 'two' }, root);

    assert.equal(removeForeign.ok, true, 'foreign/sprints_remove should remain scoped to project two');
    assert.equal(
      removeForeign.output.includes(revision.sprintId),
      false,
      'foreign/sprints_remove disclosed or reported removal of project one sprint',
    );

    for (const [name, definition, args] of [
      ['flow_ready_queue', flow_ready_queue, {}],
      ['timeline_list', timeline_list, {}],
      ['epic_list', epic_list, {}],
      ['sprint_list', sprint_list, {}],
      ['sprints_remove', sprints_remove, {}],
    ] as const) {
      const result = await callTool(definition as ToolDefinition, { ...args, projectId: 'two' }, root);

      assert.equal(result.ok, true, `foreign/${name} failed a scoped isolation read`);
      assert.equal(result.output.includes('ITEM-ONE'), false, `foreign/${name} disclosed foreign item`);
      assert.equal(result.output.includes('EPIC-ONE'), false, `foreign/${name} disclosed foreign epic`);
    }
  });
});

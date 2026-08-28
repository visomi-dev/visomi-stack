import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  flow_ready_queue,
  project_create,
  timeline_list,
  workitem_create,
  workitem_get,
} from '../.opencode/tools/themis.ts';

const roots: string[] = [];
const context = (root: string) => ({
  agent: 'themis-e2e',
  directory: root,
  worktree: root,
  sessionID: 'e2e',
  messageID: 'message',
  abort: new AbortController().signal,
  metadata() {},
  async ask() {},
});
type InvokableTool = { execute: (args: never, context: never) => Promise<string | { output: string }> };
const call = async <T>(definition: InvokableTool, args: T, root: string): Promise<Record<string, unknown>> => {
  const result = await definition.execute(args as never, context(root) as never);
  return JSON.parse(typeof result === 'string' ? result : result.output) as Record<string, unknown>;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('OpenCode project-authorized tools', () => {
  it('uses registered project APIs and rejects a foreign project read', async () => {
    const root = mkdtempSync(join(tmpdir(), 'themis-tools-scoped-'));
    roots.push(root);
    await call(project_create, { projectId: 'PRJ-ONE', name: 'One', summary: '' }, root);
    await call(project_create, { projectId: 'PRJ-TWO', name: 'Two', summary: '' }, root);
    const item = await call(
      workitem_create,
      {
        projectId: 'PRJ-ONE',
        title: 'Scoped item',
        summary: '',
        acceptanceCriteria: [],
        scopeIn: [],
        scopeOut: [],
        verificationStrategy: [],
      },
      root,
    );
    const queue = await call(flow_ready_queue, { projectId: 'PRJ-ONE' }, root);
    assert.deepEqual(
      (queue as unknown as Array<{ id: string }>).map((entry) => entry.id),
      [],
    );
    const timeline = await call(timeline_list, { projectId: 'PRJ-ONE' }, root);
    assert.equal(JSON.stringify(timeline).includes(String(item.id)), true);
    const foreign = await call(workitem_get, { projectId: 'PRJ-TWO', id: String(item.id) }, root);
    assert.equal(foreign.error, `Work item not found: ${String(item.id)}`);
  });
});

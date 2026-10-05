import {
  dependency_add,
  epic_create,
  epic_list,
  evidence_add,
  flow_ready_queue,
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

export type ToolDefinition = { execute: (args: never, context: never) => Promise<unknown> };
type ToolCase = { name: string; family: string; definition: ToolDefinition; args: Record<string, unknown> };

export const toolCases: ToolCase[] = [
  {
    name: 'ready_queue',
    family: 'ready/timeline',
    definition: ready_queue as ToolDefinition,
    args: { sprintId: 'sprint' },
  },
  { name: 'flow_ready_queue', family: 'ready/timeline', definition: flow_ready_queue as ToolDefinition, args: {} },
  { name: 'timeline_list', family: 'ready/timeline', definition: timeline_list as ToolDefinition, args: {} },
  { name: 'epic_list', family: 'epics', definition: epic_list as ToolDefinition, args: {} },
  {
    name: 'epic_create',
    family: 'epics',
    definition: epic_create as ToolDefinition,
    args: { id: 'epic', title: 'Epic', summary: '', goal: '' },
  },
  { name: 'workitem_list', family: 'work items', definition: workitem_list as ToolDefinition, args: {} },
  { name: 'workitem_get', family: 'work items', definition: workitem_get as ToolDefinition, args: { id: 'ITEM-ONE' } },
  {
    name: 'workitem_create',
    family: 'work items',
    definition: workitem_create as ToolDefinition,
    args: { title: 'Item', summary: '', acceptanceCriteria: [], scopeIn: [], scopeOut: [], verificationStrategy: [] },
  },
  {
    name: 'workitem_transition',
    family: 'work items',
    definition: workitem_transition as ToolDefinition,
    args: { id: 'ITEM-ONE', to: 'ready' },
  },
  {
    name: 'workitem_update',
    family: 'work items',
    definition: workitem_update as ToolDefinition,
    args: { id: 'ITEM-ONE' },
  },
  {
    name: 'dependency_add',
    family: 'dependencies',
    definition: dependency_add as ToolDefinition,
    args: { from: 'ITEM-ONE', to: 'ITEM-TWO' },
  },
  { name: 'sprint_list', family: 'sprints/revisions', definition: sprint_list as ToolDefinition, args: {} },
  {
    name: 'sprint_propose',
    family: 'sprints/revisions',
    definition: sprint_propose as ToolDefinition,
    args: {
      goal: '',
      why: '',
      what: '',
      how: '',
      workItemIds: [],
      nonGoals: [],
      definitionOfDone: [],
      verificationStrategy: [],
    },
  },
  {
    name: 'sprint_approve',
    family: 'sprints/revisions',
    definition: sprint_approve as ToolDefinition,
    args: { sprintId: 'sprint', revisionId: 'revision' },
  },
  {
    name: 'sprint_activate',
    family: 'sprints/revisions',
    definition: sprint_activate as ToolDefinition,
    args: { sprintId: 'sprint', revisionId: 'revision' },
  },
  {
    name: 'sprint_evidence_add',
    family: 'sprints/revisions',
    definition: sprint_evidence_add as ToolDefinition,
    args: { sprintId: 'sprint', kind: 'verification', summary: '', value: '' },
  },
  {
    name: 'sprint_close',
    family: 'sprints/revisions',
    definition: sprint_close as ToolDefinition,
    args: { sprintId: 'sprint' },
  },
  { name: 'sprints_remove', family: 'sprints/revisions', definition: sprints_remove as ToolDefinition, args: {} },
  {
    name: 'run_start',
    family: 'runs/evidence',
    definition: run_start as ToolDefinition,
    args: { workItemId: 'ITEM-ONE', agent: 'matrix' },
  },
  {
    name: 'run_finish',
    family: 'runs/evidence',
    definition: run_finish as ToolDefinition,
    args: { runId: 'run', status: 'completed', terminationReason: '' },
  },
  {
    name: 'evidence_add',
    family: 'runs/evidence',
    definition: evidence_add as ToolDefinition,
    args: { runId: 'run', kind: 'verification', summary: '', value: '' },
  },
  {
    name: 'work_claim',
    family: 'runs/evidence',
    definition: work_claim as ToolDefinition,
    args: { id: 'ITEM-ONE', agent: 'matrix' },
  },
  {
    name: 'review_request',
    family: 'reviews',
    definition: review_request as ToolDefinition,
    args: { workItemId: 'ITEM-ONE', reviewer: 'reviewer' },
  },
  {
    name: 'review_submit',
    family: 'reviews',
    definition: review_submit as ToolDefinition,
    args: { reviewId: 'review', verdict: 'accepted', feedback: '' },
  },
];

export const callTool = async (
  definition: ToolDefinition,
  args: Record<string, unknown>,
  root: string,
): Promise<{ ok: boolean; output: string }> => {
  try {
    const result = await definition.execute(
      args as never,
      { worktree: root, directory: root, agent: 'matrix' } as never,
    );
    const output = typeof result === 'string' ? result : JSON.stringify(result);
    const parsed = JSON.parse(output) as { error?: unknown };

    return { ok: typeof parsed.error !== 'string', output };
  } catch (error: unknown) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
};

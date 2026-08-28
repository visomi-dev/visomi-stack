import { tool } from '@opencode-ai/plugin';
import { ProjectWorkflowStore, WorkspaceRegistry, redactPortable } from '../../libs/themis-workflow/src/index.ts';

const output = (value: unknown): string => JSON.stringify(redactPortable(value), null, 2);
const projectDomain = (root: string, projectId: string): ReturnType<ProjectWorkflowStore['domain']> =>
  new ProjectWorkflowStore(new WorkspaceRegistry(root), projectId).domain();

const registerProject = (root: string, projectId: string, name: string, summary: string) => {
  const registry = new WorkspaceRegistry(root);

  registry.register(projectId, name, root);

  return new ProjectWorkflowStore(registry, projectId).domain().createProject({ id: projectId, name, summary }, 'agent:opencode');
};

export const workitem_create = tool({
  description: 'Create a local Themis work item in draft state.',
  args: {
    projectId: tool.schema.string().describe('Owning project identifier'),
    epicId: tool.schema.string().optional().describe('Optional epic identifier'),
    title: tool.schema.string().describe('Short work item title'),
    summary: tool.schema.string().describe('Problem and expected outcome'),
    acceptanceCriteria: tool.schema.array(tool.schema.string()).describe('Observable acceptance criteria'),
    scopeIn: tool.schema.array(tool.schema.string()).describe('Allowed implementation scope'),
    scopeOut: tool.schema.array(tool.schema.string()).describe('Explicitly excluded scope'),
    verificationStrategy: tool.schema.array(tool.schema.string()).describe('Commands or checks required before review'),
    id: tool.schema.string().optional().describe('Optional stable identifier, for example THM-001'),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).createWorkItem(args, `agent:${context.agent}`));
  },
});

export const workitem_get = tool({
  description: 'Read a local Themis work item and its related runs, evidence, and reviews.',
  args: { id: tool.schema.string().describe('Work item identifier'), projectId: tool.schema.string().describe('Registered project identifier') },
  async execute(args, context) {
    const state = projectDomain(context.worktree, args.projectId).readState();
    const item = state.workItems.find((candidate) => candidate.id === args.id);

    if (!item) return output({ error: `Work item not found: ${args.id}` });

    return output({ item, dependencies: state.dependencies.filter((d) => d.from === args.id || d.to === args.id), runs: state.runs.filter((r) => r.workItemId === args.id), reviews: state.reviews.filter((r) => r.workItemId === args.id) });
  },
});

export const workitem_transition = tool({
  description: 'Apply a validated state transition to a Themis work item.',
  args: {
    id: tool.schema.string().describe('Work item identifier'),
    projectId: tool.schema.string().describe('Registered project identifier'),
    to: tool.schema.enum([
      'draft',
      'ready',
      'planned',
      'claimed',
      'in_progress',
      'review',
      'rework',
      'done',
      'blocked',
      'rejected',
      'cancelled',
    ]),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).transitionWorkItem(args.id, args.to, `agent:${context.agent}`));
  },
});

export const workitem_update = tool({
  description: 'Update an existing work item and reopen reviewed work for rework when its contract changes.',
  args: {
    id: tool.schema.string().describe('Work item identifier'),
    projectId: tool.schema.string().describe('Registered project identifier'),
    title: tool.schema.string().optional().describe('Updated work item title'),
    summary: tool.schema.string().optional().describe('Updated problem and expected outcome'),
    acceptanceCriteria: tool.schema.array(tool.schema.string()).optional().describe('Updated acceptance criteria'),
    scopeIn: tool.schema.array(tool.schema.string()).optional().describe('Updated allowed implementation scope'),
    scopeOut: tool.schema.array(tool.schema.string()).optional().describe('Updated excluded scope'),
    verificationStrategy: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe('Updated commands or checks required before review'),
  },
  async execute(args, context) {
    const { id, ...patch } = args;

    return output(projectDomain(context.worktree, args.projectId).updateWorkItem(id, patch, `agent:${context.agent}`));
  },
});

export const dependency_add = tool({
  description: 'Declare that one work item blocks another.',
  args: {
    from: tool.schema.string().describe('Blocking work item identifier'),
    to: tool.schema.string().describe('Blocked work item identifier'),
    projectId: tool.schema.string().describe('Registered project identifier'),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).addDependency(args.from, args.to, `agent:${context.agent}`));
  },
});

export const sprint_propose = tool({
  description: 'Create a versioned local sprint proposal from existing work items.',
  args: {
    projectId: tool.schema.string().describe('Project identifier'),
    epicIds: tool.schema.array(tool.schema.string()).optional().describe('Epics included in this sprint'),
    goal: tool.schema.string().describe('Sprint Goal'),
    why: tool.schema.string().describe('Why the sprint matters'),
    what: tool.schema.string().describe('What outcome the sprint delivers'),
    how: tool.schema.string().describe('How the selected work will be delivered'),
    workItemIds: tool.schema.array(tool.schema.string()).describe('Selected work item identifiers'),
    nonGoals: tool.schema.array(tool.schema.string()).describe('Explicit non-goals'),
    definitionOfDone: tool.schema.array(tool.schema.string()).describe('Sprint completion conditions'),
    verificationStrategy: tool.schema.array(tool.schema.string()).describe('Sprint-level verification'),
    sprintId: tool.schema.string().optional().describe('Existing sprint identifier for a new revision'),
  },
  async execute(args, context) {
    const revision = projectDomain(context.worktree, args.projectId).proposeSprint(args, `agent:${context.agent}`);

    return output({ ...revision, revisionId: revision.id });
  },
});

export const sprint_approve = tool({
  description: 'Approve a sprint revision. This is a human gate and does not activate the sprint.',
  args: {
    sprintId: tool.schema.string().describe('Sprint identifier'),
    revisionId: tool.schema.string().describe('Revision identifier'),
    projectId: tool.schema.string().describe('Registered project identifier'),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).approveSprint(args.sprintId, args.revisionId, `agent:${context.agent}`));
  },
});

export const sprint_activate = tool({
  description: 'Activate an approved sprint revision and calculate its executable baseline.',
  args: {
    sprintId: tool.schema.string().describe('Sprint identifier'),
    revisionId: tool.schema.string().describe('Approved revision identifier'),
    projectId: tool.schema.string().describe('Registered project identifier'),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).activateSprint(args.sprintId, args.revisionId, `agent:${context.agent}`));
  },
});

export const sprint_evidence_add = tool({
  description: 'Attach final verification evidence to an active sprint.',
  args: {
    sprintId: tool.schema.string().describe('Active sprint identifier'),
    kind: tool.schema.enum(['verification', 'command', 'observation']),
    summary: tool.schema.string().describe('Evidence summary'),
    value: tool.schema.string().describe('Observed command output or result'),
    projectId: tool.schema.string().describe('Registered project identifier'),
  },
  async execute(args, context) {
    return output(
      projectDomain(context.worktree, args.projectId).addSprintEvidence(args.sprintId, args.kind, args.summary, args.value, `agent:${context.agent}`),
    );
  },
});

export const sprint_close = tool({
  description: 'Close an active sprint after all work and final verification are complete.',
  args: {
    projectId: tool.schema.string().describe('Project identifier'),
    sprintId: tool.schema.string().describe('Active sprint identifier'),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).closeSprint(args.sprintId, `agent:${context.agent}`));
  },
});

export const sprints_remove = tool({
  description: 'Remove sprint planning state while preserving projects, work items, runs, evidence, and reviews.',
  args: {
    projectId: tool.schema.string().describe('Registered project identifier'),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).removeSprints(`agent:${context.agent}`));
  },
});

export const ready_queue = tool({
  description: 'Return sprint work items with all blocking dependencies completed.',
  args: {
    projectId: tool.schema.string().describe('Project identifier'),
    sprintId: tool.schema.string().describe('Active sprint identifier'),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).readyQueue(args.sprintId));
  },
});

export const flow_ready_queue = tool({
  description: 'Return project work items ready for pull-based execution without requiring an active sprint.',
  args: {
    projectId: tool.schema.string().describe('Project identifier'),
    wipLimit: tool.schema.number().int().positive().optional().describe('Optional maximum active work in the project'),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).flowReadyQueue(args.wipLimit));
  },
});

export const project_create = tool({
  description: 'Create a local Themis project portfolio entry.',
  args: {
    projectId: tool.schema.string().describe('Project identifier'),
    name: tool.schema.string().describe('Project name'),
    summary: tool.schema.string().describe('Project summary'),
  },
  async execute(args, context) {
    return output(registerProject(context.worktree, args.projectId, args.name, args.summary));
  },
});

export const timeline_list = tool({
  description: 'Show the append-only timeline for one registered project.',
  args: { projectId: tool.schema.string().describe('Registered project identifier') },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).timeline());
  },
});

export const workitem_list = tool({
  description: 'List work items scoped by project, epic, or sprint.',
  args: {
    projectId: tool.schema.string().describe('Registered project identifier'),
    epicId: tool.schema.string().optional().describe('Optional epic identifier'),
    sprintId: tool.schema.string().optional().describe('Optional sprint identifier'),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).listWorkItems(args));
  },
});

export const epic_create = tool({
  description: 'Create an epic within a project.',
  args: {
    id: tool.schema.string().describe('Epic identifier'),
    projectId: tool.schema.string().describe('Owning project identifier'),
    title: tool.schema.string().describe('Epic title'),
    summary: tool.schema.string().describe('Epic summary'),
    goal: tool.schema.string().describe('Epic goal'),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).createEpic(args, `agent:${context.agent}`));
  },
});

export const epic_list = tool({
  description: 'List epics, optionally scoped to a project.',
  args: { projectId: tool.schema.string().describe('Registered project identifier') },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).listEpics());
  },
});

export const sprint_list = tool({
  description: 'List sprints, optionally scoped to a project.',
  args: { projectId: tool.schema.string().describe('Registered project identifier') },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).listSprints());
  },
});

export const work_claim = tool({
  description: 'Claim one ready work item for the current execution agent.',
  args: {
    id: tool.schema.string().describe('Work item identifier'),
    agent: tool.schema.string().describe('Logical executor identifier'),
    projectId: tool.schema.string().describe('Registered project identifier'),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).claimWorkItem(args.id, args.agent, `agent:${context.agent}`));
  },
});

export const run_start = tool({
  description: 'Start an execution run for a claimed work item.',
  args: {
    workItemId: tool.schema.string().describe('Claimed work item identifier'),
    agent: tool.schema.string().describe('Executor identifier'),
    projectId: tool.schema.string().describe('Registered project identifier'),
  },
  async execute(args, context) {
    const run = projectDomain(context.worktree, args.projectId).startRun(args.workItemId, args.agent, `agent:${context.agent}`);

    return output({ ...run, runId: run.id });
  },
});

export const run_finish = tool({
  description: 'Finish an execution run before requesting review.',
  args: {
    runId: tool.schema.string().describe('Run identifier'),
    status: tool.schema.enum(['completed', 'failed']),
    terminationReason: tool.schema.string().describe('Observed result of the run'),
    projectId: tool.schema.string().describe('Registered project identifier'),
  },
  async execute(args, context) {
    return output(
      projectDomain(context.worktree, args.projectId).finishRun(args.runId, args.status, args.terminationReason, `agent:${context.agent}`),
    );
  },
});

export const evidence_add = tool({
  description: 'Attach auditable evidence to an execution run.',
  args: {
    runId: tool.schema.string().describe('Run identifier'),
    kind: tool.schema.enum(['verification', 'implementation-diff', 'command', 'observation']),
    summary: tool.schema.string().describe('Human-readable evidence summary'),
    value: tool.schema.string().describe('Command output, commit, diff reference, or observation'),
    projectId: tool.schema.string().describe('Registered project identifier'),
  },
  async execute(args, context) {
    return output(
      projectDomain(context.worktree, args.projectId).addEvidence(args.runId, args.kind, args.summary, args.value, `agent:${context.agent}`),
    );
  },
});

export const review_request = tool({
  description: 'Request independent review after verification and implementation evidence exist.',
  args: {
    workItemId: tool.schema.string().describe('Work item identifier'),
    reviewer: tool.schema.string().describe('Reviewer agent identifier'),
    projectId: tool.schema.string().describe('Registered project identifier'),
  },
  async execute(args, context) {
    const review = projectDomain(context.worktree, args.projectId).requestReview(args.workItemId, args.reviewer, `agent:${context.agent}`);

    return output({ ...review, reviewId: review.id });
  },
});

export const review_submit = tool({
  description: 'Submit an independent review decision and move work to done or rework.',
  args: {
    reviewId: tool.schema.string().describe('Review identifier'),
    verdict: tool.schema.enum(['accepted', 'rejected']),
    feedback: tool.schema.string().describe('Review decision and actionable feedback'),
    projectId: tool.schema.string().describe('Registered project identifier'),
  },
  async execute(args, context) {
    return output(projectDomain(context.worktree, args.projectId).submitReview(args.reviewId, args.verdict, args.feedback, `agent:${context.agent}`));
  },
});

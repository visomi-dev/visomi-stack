import { fileURLToPath } from 'node:url';

import { boolean, command, run, string, type Command } from '@drizzle-team/brocli';

import {
  backupProjectStore,
  migrateProjectStores,
  readProjectState,
  restoreProjectStore,
  rollbackProjectStores,
  synchronizeProjectStore,
  validateProjectStore,
} from './themis-project-migration.ts';

import { ProjectWorkflowStore, WorkspaceRegistry, redactPortable } from '../libs/themis-workflow/src/index.ts';
import { workspaceStatus } from '../libs/themis-workflow/src/lib/legacy-workflow-internal.ts';

const split = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const print = (value: unknown, asJson: boolean): void => {
  const portable = redactPortable(value);
  if (asJson) {
    console.log(JSON.stringify(portable, null, 2));

    return;
  }
  console.log(typeof portable === 'string' ? portable : JSON.stringify(portable, null, 2));
};

const projectDomain = (root: string, projectId: string): ReturnType<ProjectWorkflowStore['domain']> =>
  new ProjectWorkflowStore(new WorkspaceRegistry(root), projectId).domain();

const registeredProject = (root: string, projectId: string): void => {
  new WorkspaceRegistry(root).resolve(projectId);
};

const registerProject = (root: string, projectId: string, name: string, summary: string) => {
  const registry = new WorkspaceRegistry(root);

  registry.register(projectId, name, root);

  return new ProjectWorkflowStore(registry, projectId)
    .domain()
    .createProject({ id: projectId, name, summary }, 'human:cli');
};

const baseOptions = () => ({
  root: string().desc('Project root containing .themis').default('.'),
  json: boolean().desc('Print machine-readable JSON').default(false),
});

const workspaceStatusCommand = command({
  name: 'workspace-status',
  desc: 'Show read-only workspace initialization status and entity counts',
  options: { ...baseOptions() },
  handler: (options) => print(workspaceStatus(options.root), options.json),
});

const ready = command({
  name: 'ready',
  desc: 'Show work items ready for sprint or project-flow execution',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    sprint: string().desc('Optional active sprint identifier').default(''),
    wip: string().desc('Optional project WIP limit when no sprint is selected').default(''),
  },
  handler: (options) => {
    const domain = projectDomain(options.root, options.project);
    const result = options.sprint
      ? domain.readyQueue(options.sprint)
      : domain.flowReadyQueue(options.wip ? Number(options.wip) : undefined);

    print(
      options.json
        ? result
        : result.length > 0
          ? result.map((item) => `${item.id}\t${item.title}`).join('\n')
          : 'No ready work.',
      options.json,
    );
  },
});

const migrate = command({
  name: 'project-migrate',
  desc: 'Partition global local state into independently loadable project stores',
  options: {
    ...baseOptions(),
    dryRun: boolean('dry-run').desc('Plan without writing stores').default(false),
    resume: boolean().desc('Resume an interrupted migration').default(false),
    cutover: boolean().desc('Activate project stores as the write authority').default(true),
    targetProject: string().desc('Retarget a single local project during migration').default(''),
  },
  handler: (options) =>
    print(
      migrateProjectStores(options.root, {
        dryRun: options.dryRun,
        resume: options.resume,
        cutover: options.cutover,
        targetProjectId: options.targetProject || undefined,
      }),
      options.json,
    ),
});

const migrateRollback = command({
  name: 'project-migrate-rollback',
  desc: 'Rollback a fenced project-store cutover',
  options: { ...baseOptions() },
  handler: (options) => {
    rollbackProjectStores(options.root);
    print({ rolledBack: true }, options.json);
  },
});

const projectState = command({
  name: 'project-state',
  desc: 'Read one project without loading unrelated project domain state',
  options: { ...baseOptions(), project: string().desc('Project identifier').required() },
  handler: (options) => {
    registeredProject(options.root, options.project);
    print(readProjectState(options.root, options.project), options.json);
  },
});

const projectValidate = command({
  name: 'project-validate',
  desc: 'Validate one project store independently',
  options: { ...baseOptions(), project: string().desc('Project identifier').required() },
  handler: (options) => {
    registeredProject(options.root, options.project);
    print(validateProjectStore(options.root, options.project), options.json);
  },
});

const projectBackup = command({
  name: 'project-backup',
  desc: 'Back up one project store independently',
  options: { ...baseOptions(), project: string().desc('Project identifier').required() },
  handler: (options) => {
    registeredProject(options.root, options.project);
    print({ backupId: backupProjectStore(options.root, options.project) }, options.json);
  },
});

const projectRestore = command({
  name: 'project-restore',
  desc: 'Restore one project store and validate it',
  options: {
    ...baseOptions(),
    project: string().desc('Project identifier').required(),
    backup: string().desc('Safe backup identifier').default(''),
  },
  handler: (options) => {
    registeredProject(options.root, options.project);
    print(restoreProjectStore(options.root, options.project, options.backup || undefined), options.json);
  },
});

const projectSync = command({
  name: 'project-sync',
  desc: 'Synchronize and independently validate one project store',
  options: { ...baseOptions(), project: string().desc('Project identifier').required() },
  handler: (options) => {
    registeredProject(options.root, options.project);
    print(synchronizeProjectStore(options.root, options.project), options.json);
  },
});

const timelineCommand = command({
  name: 'timeline',
  desc: 'Show the append-only project timeline',
  options: { ...baseOptions(), project: string().desc('Registered project identifier').required() },
  handler: (options) => print(projectDomain(options.root, options.project).timeline(), options.json),
});

const projectCreate = command({
  name: 'project-create',
  desc: 'Create a project in the local portfolio',
  options: {
    ...baseOptions(),
    project: string().desc('Project identifier').required(),
    name: string().desc('Project name').required(),
    summary: string().desc('Project summary').default(''),
  },
  handler: (options) =>
    print(registerProject(options.root, options.project, options.name, options.summary), options.json),
});

const projectList = command({
  name: 'project-list',
  desc: 'List projects in the local portfolio',
  options: { ...baseOptions(), project: string().desc('Registered project identifier').required() },
  handler: (options) => print(projectDomain(options.root, options.project).listProjects(), options.json),
});

const epicCreate = command({
  name: 'epic-create',
  desc: 'Create an epic inside a project',
  options: {
    ...baseOptions(),
    id: string().desc('Epic identifier').required(),
    project: string().desc('Owning project identifier').required(),
    title: string().desc('Epic title').required(),
    summary: string().desc('Epic summary').default(''),
    goal: string().desc('Epic goal').required(),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).createEpic(
        {
          id: options.id,
          projectId: options.project,
          title: options.title,
          summary: options.summary,
          goal: options.goal,
        },
        'human:cli',
      ),
      options.json,
    ),
});

const epicList = command({
  name: 'epic-list',
  desc: 'List epics, optionally scoped to a project',
  options: { ...baseOptions(), project: string().desc('Registered project identifier').required() },
  handler: (options) => print(projectDomain(options.root, options.project).listEpics(), options.json),
});

const workList = command({
  name: 'work-list',
  desc: 'List work items scoped by project, epic, or sprint',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    epic: string().desc('Optional epic identifier').default(''),
    sprint: string().desc('Optional sprint identifier').default(''),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).listWorkItems({
        projectId: options.project,
        epicId: options.epic || undefined,
        sprintId: options.sprint || undefined,
      }),
      options.json,
    ),
});

const sprintList = command({
  name: 'sprint-list',
  desc: 'List sprints, optionally scoped to a project',
  options: { ...baseOptions(), project: string().desc('Registered project identifier').required() },
  handler: (options) => print(projectDomain(options.root, options.project).listSprints(), options.json),
});

const workCreate = command({
  name: 'work-create',
  desc: 'Create a draft work item',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    epic: string().desc('Optional epic identifier').default(''),
    title: string().desc('Work item title').required(),
    summary: string().desc('Work item summary').required(),
    acceptance: string().desc('Comma-separated acceptance criteria').required(),
    scopeIn: string('scope-in').desc('Comma-separated allowed paths').required(),
    scopeOut: string('scope-out').desc('Comma-separated excluded paths').default(''),
    verify: string().desc('Comma-separated verification commands').required(),
    id: string().desc('Optional work item identifier').default(''),
  },
  handler: (options) => {
    const result = projectDomain(options.root, options.project).createWorkItem(
      {
        id: options.id || undefined,
        projectId: options.project,
        epicId: options.epic || undefined,
        title: options.title,
        summary: options.summary,
        acceptanceCriteria: split(options.acceptance),
        scopeIn: split(options.scopeIn),
        scopeOut: split(options.scopeOut),
        verificationStrategy: split(options.verify),
      },
      'human:cli',
    );

    print(result, options.json);
  },
});

const workTransition = command({
  name: 'work-transition',
  desc: 'Apply a validated work item state transition',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    id: string().desc('Work item identifier').required(),
    to: string()
      .desc('Destination state')
      .enum(
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
      )
      .required(),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).transitionWorkItem(options.id, options.to, 'human:cli'),
      options.json,
    ),
});

const workUpdate = command({
  name: 'work-update',
  desc: 'Update an existing work item and reopen reviewed work for rework',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    id: string().desc('Work item identifier').required(),
    title: string().desc('Updated work item title').default(''),
    summary: string().desc('Updated work item summary').default(''),
    acceptance: string().desc('Updated comma-separated acceptance criteria').default(''),
    scopeIn: string('scope-in').desc('Updated comma-separated allowed paths').default(''),
    scopeOut: string('scope-out').desc('Updated comma-separated excluded paths').default(''),
    verify: string().desc('Updated comma-separated verification commands').default(''),
  },
  handler: (options) => {
    const patch = {
      ...(options.title ? { title: options.title } : {}),
      ...(options.summary ? { summary: options.summary } : {}),
      ...(options.acceptance ? { acceptanceCriteria: split(options.acceptance) } : {}),
      ...(options.scopeIn ? { scopeIn: split(options.scopeIn) } : {}),
      ...(options.scopeOut ? { scopeOut: split(options.scopeOut) } : {}),
      ...(options.verify ? { verificationStrategy: split(options.verify) } : {}),
    };

    print(projectDomain(options.root, options.project).updateWorkItem(options.id, patch, 'human:cli'), options.json);
  },
});

const dependencyAdd = command({
  name: 'dependency-add',
  desc: 'Add a blocking dependency',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    from: string().desc('Blocking work item').required(),
    to: string().desc('Blocked work item').required(),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).addDependency(options.from, options.to, 'human:cli'),
      options.json,
    ),
});

const sprintPropose = command({
  name: 'sprint-propose',
  desc: 'Create a versioned sprint proposal',
  options: {
    ...baseOptions(),
    goal: string().desc('Sprint Goal').required(),
    why: string().desc('Why this sprint matters').required(),
    what: string().desc('What the sprint delivers').required(),
    how: string().desc('How it will be delivered').required(),
    project: string().desc('Project identifier').default(''),
    epics: string('epics').desc('Comma-separated epic identifiers').default(''),
    workItems: string('work-items').desc('Comma-separated work item identifiers').required(),
    nonGoals: string('non-goals').desc('Comma-separated non-goals').default(''),
    done: string().desc('Comma-separated Definition of Done').required(),
    verify: string().desc('Comma-separated verification commands').required(),
    sprint: string().desc('Existing sprint identifier for a revision').default(''),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).proposeSprint(
        {
          goal: options.goal,
          why: options.why,
          what: options.what,
          how: options.how,
          projectId: options.project,
          epicIds: split(options.epics),
          workItemIds: split(options.workItems),
          nonGoals: split(options.nonGoals),
          definitionOfDone: split(options.done),
          verificationStrategy: split(options.verify),
          sprintId: options.sprint || undefined,
        },
        'human:cli',
      ),
      options.json,
    ),
});

const sprintApprove = command({
  name: 'sprint-approve',
  desc: 'Approve a sprint revision',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    sprint: string().desc('Sprint identifier').required(),
    revision: string().desc('Revision identifier').required(),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).approveSprint(options.sprint, options.revision, 'human:cli'),
      options.json,
    ),
});

const sprintActivate = command({
  name: 'sprint-activate',
  desc: 'Activate an approved sprint revision',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    sprint: string().desc('Sprint identifier').required(),
    revision: string().desc('Revision identifier').required(),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).activateSprint(options.sprint, options.revision, 'human:cli'),
      options.json,
    ),
});

const sprintEvidenceAdd = command({
  name: 'sprint-evidence-add',
  desc: 'Attach final verification evidence to an active sprint',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    sprint: string().desc('Sprint identifier').required(),
    kind: string().desc('Evidence kind').enum('verification', 'command', 'observation').required(),
    summary: string().desc('Evidence summary').required(),
    value: string().desc('Evidence value').required(),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).addSprintEvidence(
        options.sprint,
        options.kind,
        options.summary,
        options.value,
        'human:cli',
      ),
      options.json,
    ),
});

const sprintClose = command({
  name: 'sprint-close',
  desc: 'Close an active sprint after final verification',
  options: {
    ...baseOptions(),
    project: string().desc('Project identifier').required(),
    sprint: string().desc('Sprint identifier').required(),
  },
  handler: (options) =>
    print(projectDomain(options.root, options.project).closeSprint(options.sprint, 'human:cli'), options.json),
});

const sprintRemoveAll = command({
  name: 'sprint-remove-all',
  desc: 'Remove sprint planning state while preserving project flow state',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
  },
  handler: (options) => print(projectDomain(options.root, options.project).removeSprints('human:cli'), options.json),
});

const claim = command({
  name: 'claim',
  desc: 'Claim a ready work item',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    id: string().desc('Work item identifier').required(),
    agent: string().desc('Agent identifier').default('human-cli'),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).claimWorkItem(options.id, options.agent, 'human:cli'),
      options.json,
    ),
});

const runStart = command({
  name: 'run-start',
  desc: 'Start a run for a claimed work item',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    workItem: string('work-item').desc('Work item identifier').required(),
    agent: string().desc('Agent identifier').default('human-cli'),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).startRun(options.workItem, options.agent, 'human:cli'),
      options.json,
    ),
});

const runFinish = command({
  name: 'run-finish',
  desc: 'Finish an execution run',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    run: string().desc('Run identifier').required(),
    status: string().desc('Run result').enum('completed', 'failed').required(),
    reason: string().desc('Termination reason').required(),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).finishRun(options.run, options.status, options.reason, 'human:cli'),
      options.json,
    ),
});

const evidenceAdd = command({
  name: 'evidence-add',
  desc: 'Attach evidence to a run',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    run: string().desc('Run identifier').required(),
    kind: string()
      .desc('Evidence kind')
      .enum('verification', 'implementation-diff', 'command', 'observation')
      .required(),
    summary: string().desc('Evidence summary').required(),
    value: string().desc('Evidence value').required(),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).addEvidence(
        options.run,
        options.kind,
        options.summary,
        options.value,
        'human:cli',
      ),
      options.json,
    ),
});

const reviewRequest = command({
  name: 'review-request',
  desc: 'Request an independent review',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    workItem: string('work-item').desc('Work item identifier').required(),
    reviewer: string().desc('Reviewer identifier').required(),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).requestReview(options.workItem, options.reviewer, 'human:cli'),
      options.json,
    ),
});

const reviewSubmit = command({
  name: 'review-submit',
  desc: 'Submit an accepted or rejected review',
  options: {
    ...baseOptions(),
    project: string().desc('Registered project identifier').required(),
    review: string().desc('Review identifier').required(),
    verdict: string().desc('Review verdict').enum('accepted', 'rejected').required(),
    feedback: string().desc('Review feedback').required(),
  },
  handler: (options) =>
    print(
      projectDomain(options.root, options.project).submitReview(
        options.review,
        options.verdict,
        options.feedback,
        'human:cli',
      ),
      options.json,
    ),
});

const commands: Command[] = [
  workspaceStatusCommand,
  ready,
  migrate,
  migrateRollback,
  projectState,
  projectValidate,
  projectBackup,
  projectRestore,
  projectSync,
  timelineCommand,
  projectCreate,
  projectList,
  epicCreate,
  epicList,
  workList,
  sprintList,
  workCreate,
  workTransition,
  workUpdate,
  dependencyAdd,
  sprintPropose,
  sprintApprove,
  sprintActivate,
  sprintEvidenceAdd,
  sprintClose,
  sprintRemoveAll,
  claim,
  runStart,
  runFinish,
  evidenceAdd,
  reviewRequest,
  reviewSubmit,
];

const cliPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === cliPath;

if (isMain) {
  run(commands, { name: 'themis', description: 'Local operational control plane for OpenCode work', version: '0.1.0' });
}

export { commands };

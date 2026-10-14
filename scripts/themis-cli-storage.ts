import { boolean, command, string } from '@drizzle-team/brocli';

import { baseOptions, print, registeredProject } from './themis-cli-context.ts';
import {
  backupProjectStore,
  migrateProjectStores,
  readProjectState,
  restoreProjectStore,
  rollbackProjectStores,
  synchronizeProjectStore,
  validateProjectStore,
} from './themis-project-migration.ts';

export const migrate = command({
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

export const migrateRollback = command({
  name: 'project-migrate-rollback',
  desc: 'Rollback a fenced project-store cutover',
  options: { ...baseOptions() },
  handler: (options) => {
    rollbackProjectStores(options.root);
    print({ rolledBack: true }, options.json);
  },
});

export const projectState = command({
  name: 'project-state',
  desc: 'Read one project without loading unrelated project domain state',
  options: { ...baseOptions(), project: string().desc('Project identifier').required() },
  handler: (options) => {
    registeredProject(options.root, options.project);
    print(readProjectState(options.root, options.project), options.json);
  },
});

export const projectValidate = command({
  name: 'project-validate',
  desc: 'Validate one project store independently',
  options: { ...baseOptions(), project: string().desc('Project identifier').required() },
  handler: (options) => {
    registeredProject(options.root, options.project);
    print(validateProjectStore(options.root, options.project), options.json);
  },
});

export const projectBackup = command({
  name: 'project-backup',
  desc: 'Back up one project store independently',
  options: { ...baseOptions(), project: string().desc('Project identifier').required() },
  handler: (options) => {
    registeredProject(options.root, options.project);
    print({ backupId: backupProjectStore(options.root, options.project) }, options.json);
  },
});

export const projectRestore = command({
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

export const projectSync = command({
  name: 'project-sync',
  desc: 'Synchronize and independently validate one project store',
  options: { ...baseOptions(), project: string().desc('Project identifier').required() },
  handler: (options) => {
    registeredProject(options.root, options.project);
    print(synchronizeProjectStore(options.root, options.project), options.json);
  },
});

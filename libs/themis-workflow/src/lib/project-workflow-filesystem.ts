import { createHash, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { WorkflowError } from './project-workflow-contract.ts';

export const validProjectId = (projectId: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(projectId);
export const projectDirectory = (root: string, projectId: string): string => {
  if (!validProjectId(projectId)) {
    throw new WorkflowError(`Invalid project id: ${projectId}`, 'INVALID_PROJECT_ID');
  }
  const projectsRoot = resolve(root, '.themis', 'projects');
  const directory = resolve(projectsRoot, projectId);

  if (directory !== join(projectsRoot, projectId) || !directory.startsWith(`${projectsRoot}/`)) {
    throw new WorkflowError(`Invalid project store path for ${projectId}`, 'INVALID_PROJECT_ID');
  }

  return directory;
};
export const stableHash = (value: string): string => createHash('sha256').update(value).digest('hex');
export const now = (): string => new Date().toISOString();
export const atomicWrite = (file: string, value: unknown): void => {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;

  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
};

const sleep = (milliseconds: number): void => {
  const buffer = new SharedArrayBuffer(4);

  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
};

export const withFilesystemLock = <T>(file: string, operation: () => T): T => {
  mkdirSync(dirname(file), { recursive: true });
  const deadline = Date.now() + 2_000;
  let descriptor: number | undefined;

  while (descriptor === undefined) {
    try {
      descriptor = openSync(file, 'wx');
      writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      try {
        if (Date.now() - statSync(file).mtimeMs > 30_000) {
          unlinkSync(file);
        }
      } catch {
        // The owner may be rotating the lock file.
      }
      if (Date.now() >= deadline) {
        throw new WorkflowError(`Project lock contention: ${file}`, 'LOCKED');
      }
      sleep(5);
    }
  }
  try {
    return operation();
  } finally {
    closeSync(descriptor);
    unlinkSync(file);
  }
};

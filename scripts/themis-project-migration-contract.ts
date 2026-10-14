import type { ThemisState } from '../libs/themis-workflow/src/lib/legacy-workflow-internal.ts';

export type ThemisEvent = {
  schemaVersion: number;
  sequence: number;
  timestamp: string;
  actor: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
};

export type StoreState = ThemisState & { projectId: string };
export type MigrationPhase = 'planned' | 'migrating' | 'cutover' | 'rolled-back';
export type MigrationLedger = {
  schemaVersion: 1;
  migrationId: string;
  sourceChecksum: string;
  phase: MigrationPhase;
  projects: Record<string, 'pending' | 'migrated' | 'failed'>;
  quarantinedEvents: number;
  backupId: string;
  generation: number;
};

export type MigrationReport = {
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

export type DomainManifest = {
  entities: Record<string, string[]>;
  events: Array<{ sequence: number; type: string; aggregateType: string; aggregateId: string; payload: string }>;
};
export type PhaseFidelityRow = { phaseId: string; itemIds: string[]; statuses: string[]; gaps: string[] };
export type RawOutputFinding = { file: string; pattern: string };
export type RawOutputScan = {
  categories: Record<string, number>;
  files: string[];
  filesScanned: string[];
  findings: RawOutputFinding[];
};

export type RecordAssignment = { projectId?: string; reason?: string };

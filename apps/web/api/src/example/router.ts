import type { BackupObjects } from '@visomi-stack/backend-db';
import { syntheticHybridPolicy } from '@visomi-stack/shared-db';
import { Router } from 'express';

import type { AuthRuntime } from '../auth/runtime';
import { cloudExamplePolicy } from '../db/cloud-example';
import { persistenceContracts, persistenceRecordContracts } from '../db/contracts';
import { createPersistenceRouter } from '../db/router';
import { vaultContracts } from '../db/vault-contracts';

import { cloudSharingContracts } from './cloud-sharing-contracts';

export const examplePath = '/example';

export function createExampleRouter(auth: AuthRuntime, harness?: boolean, objects?: BackupObjects) {
  const router = Router();
  const shared = Object.values(persistenceContracts);
  const records = Object.values(persistenceRecordContracts);
  const subdomains = [
    {
      path: '/vault',
      router: createPersistenceRouter(auth, syntheticHybridPolicy, { harness, objects }),
      contracts: [...shared, ...Object.values(vaultContracts), ...(harness ? records : [])],
    },
    {
      path: '/cloud',
      router: createPersistenceRouter(auth, cloudExamplePolicy),
      contracts: [
        ...[...shared, ...records].map((contract) => ({
          ...contract,
          operationId: `cloud_example_${contract.operationId}`,
        })),
        ...Object.values(cloudSharingContracts),
      ],
    },
  ];

  for (const subdomain of subdomains) {
    router.use(subdomain.path, subdomain.router);
  }

  const contracts = subdomains.flatMap(({ path, contracts }) =>
    contracts.map((contract) => ({ ...contract, path: `${examplePath}${path}${contract.path}` })),
  );

  return { router, contracts };
}

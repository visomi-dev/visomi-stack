import { AuthHttp } from '../auth/shared/http';
import { DatabaseHttp } from '../shared/db/http';

import { VaultExampleNavigation } from './example/vault/vault-example-navigation';
import { ExamplePrivateResource } from './example-private-resource';
import { ExampleVaultWorkspaces } from './example-vault-workspaces';
import { ExampleWorkspace } from './example-workspace';

export const exampleWorkspaceProviders = [
  ExampleWorkspace,
  DatabaseHttp,
  AuthHttp,
  ExamplePrivateResource,
  ExampleVaultWorkspaces,
  VaultExampleNavigation,
];

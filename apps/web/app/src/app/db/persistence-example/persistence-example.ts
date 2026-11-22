import { Component } from '@angular/core';

import { DatabaseExample } from '../example/example';
import { exampleWorkspaceProviders } from '../example-workspace-providers';

@Component({
  selector: 'app-persistence-example',
  imports: [DatabaseExample],
  providers: exampleWorkspaceProviders,
  template: '<app-database-example />',
})
export class PersistenceExample {}

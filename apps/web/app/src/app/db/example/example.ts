import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Field, Link, PinInput, Heading, Text, Textarea } from '../../ui';
import { DatabaseHttp } from '../../shared/db/http';
import { ExampleWorkspace } from '../example-workspace';
import { ExamplePrivateResource } from '../example-private-resource';
import { ExampleVaultWorkspaces } from '../example-vault-workspaces';

@Component({
  selector: 'app-database-example',
  imports: [PinInput, Button, Field, Link, Heading, Text, Textarea, NavigationHeading, RouterLink, DatePipe],
  providers: [ExampleWorkspace, DatabaseHttp, ExamplePrivateResource, ExampleVaultWorkspaces],
  templateUrl: './example.html',
})
export class DatabaseExample {
  readonly workspace = inject(ExampleWorkspace);
}

import { Component, inject } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Card, Field, Link, PinInput, Heading, Text, Textarea } from '../../ui';
import { DatabaseHttp } from '../../shared/db/http';
import { AuthHttp } from '../../auth/shared/http';
import { ExampleWorkspace } from '../example-workspace';
import { ExamplePrivateResource } from '../example-private-resource';
import { ExampleVaultWorkspaces } from '../example-vault-workspaces';

@Component({
  selector: 'app-database-example',
  imports: [
    PinInput,
    Button,
    Card,
    Field,
    Link,
    Heading,
    Text,
    Textarea,
    NavigationHeading,
    RouterLink,
    DatePipe,
    NgTemplateOutlet,
  ],
  providers: [ExampleWorkspace, DatabaseHttp, AuthHttp, ExamplePrivateResource, ExampleVaultWorkspaces],
  templateUrl: './example.html',
})
export class DatabaseExample {
  readonly workspace = inject(ExampleWorkspace);
}

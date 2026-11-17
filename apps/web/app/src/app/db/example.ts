import { Component, inject } from '@angular/core';

import { NavigationHeading } from '../shared/navigation-heading';
import { Button, Field, Heading, Text, Textarea, Input } from '../ui';

import { ExampleWorkspace } from './example-workspace';
import { ExamplePrivateResource } from './example-private-resource';
import { DatabaseHttp } from './http';

@Component({
  selector: 'app-database-example',
  imports: [Button, Field, Heading, Text, Textarea, Input, NavigationHeading],
  providers: [ExampleWorkspace, DatabaseHttp, ExamplePrivateResource],
  templateUrl: './example.html',
})
export class DatabaseExample {
  readonly workspace = inject(ExampleWorkspace);
}

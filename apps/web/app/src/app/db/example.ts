import { Component, inject } from '@angular/core';

import { NavigationHeading } from '../shared/navigation-heading';
import { Button, Field, Heading, Text, Textarea } from '../ui';
import { PinInput } from '../shared/db/pin-input';
import { DatabaseHttp } from '../shared/db/http';

import { ExampleWorkspace } from './example-workspace';
import { ExamplePrivateResource } from './example-private-resource';

@Component({
  selector: 'app-database-example',
  imports: [PinInput, Button, Field, Heading, Text, Textarea, NavigationHeading],
  providers: [ExampleWorkspace, DatabaseHttp, ExamplePrivateResource],
  templateUrl: './example.html',
})
export class DatabaseExample {
  readonly workspace = inject(ExampleWorkspace);
}

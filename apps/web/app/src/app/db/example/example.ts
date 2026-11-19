import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Field, Link, PinInput, Heading, Text, Textarea } from '../../ui';
import { DatabaseHttp } from '../../shared/db/http';
import { ExampleWorkspace } from '../example-workspace';
import { ExamplePrivateResource } from '../example-private-resource';

@Component({
  selector: 'app-database-example',
  imports: [PinInput, Button, Field, Link, Heading, Text, Textarea, NavigationHeading, RouterLink],
  providers: [ExampleWorkspace, DatabaseHttp, ExamplePrivateResource],
  templateUrl: './example.html',
})
export class DatabaseExample {
  readonly workspace = inject(ExampleWorkspace);
}

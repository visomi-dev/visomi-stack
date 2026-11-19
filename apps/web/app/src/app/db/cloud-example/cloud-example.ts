import { Component, inject } from '@angular/core';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Card, Field, Heading, Text } from '../../ui';

import { CloudWorkspace } from './cloud-workspace';

@Component({
  selector: 'app-cloud-example',
  imports: [Button, Card, Field, Heading, NavigationHeading, Text],
  providers: [CloudWorkspace],
  templateUrl: './cloud-example.html',
})
export class CloudExample {
  protected readonly workspace = inject(CloudWorkspace);
}

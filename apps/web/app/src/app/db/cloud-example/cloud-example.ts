import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Card, Field, Heading, Link, Text } from '../../ui';

import { CloudWorkspace } from './cloud-workspace';

@Component({
  selector: 'app-cloud-example',
  imports: [Button, Card, Field, Heading, Link, NavigationHeading, Text, RouterLink, DatePipe],
  providers: [CloudWorkspace],
  templateUrl: './cloud-example.html',
})
export class CloudExample {
  protected readonly workspace = inject(CloudWorkspace);
}

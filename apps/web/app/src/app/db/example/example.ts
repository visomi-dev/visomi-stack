import { Component, inject } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Card, Field, Link, PinInput, Heading, Text, Textarea } from '../../ui';
import { ExampleWorkspace } from '../example-workspace';

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
  templateUrl: './example.html',
})
export class DatabaseExample {
  readonly workspace = inject(ExampleWorkspace);
}

import { afterRenderEffect, Component, computed, inject, viewChild } from '@angular/core';
import { DatePipe, DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Field, Link, PinInput, Heading, Text, Textarea } from '../../ui';
import { ExampleWorkspace } from '../example-workspace';
import { exampleWorkspaceProviders } from '../example-workspace-providers';

@Component({
  selector: 'app-database-example',
  imports: [
    PinInput,
    Button,
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
  private readonly document = inject(DOCUMENT);

  private readonly localPinControl = viewChild<PinInput>('localPinControl');

  readonly workspace = inject(ExampleWorkspace);
  protected readonly autoUnlockPin = computed(() => !this.workspace.backedSample && this.workspace.hasBinding());

  private readonly refocusAfterUnlockError = afterRenderEffect({
    write: () => {
      const pin = this.localPinControl();

      if (
        pin &&
        this.autoUnlockPin() &&
        !this.workspace.busy() &&
        this.workspace.notice() &&
        this.document.activeElement === this.document.body
      ) {
        pin.focus();
      }
    },
  });
}

@Component({
  selector: 'app-database-example-route',
  imports: [DatabaseExample],
  providers: exampleWorkspaceProviders,
  template: '<app-database-example />',
})
export class DatabaseExampleRoute {}

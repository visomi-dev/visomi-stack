import { afterRenderEffect, Component, computed, ElementRef, inject, viewChild } from '@angular/core';
import { DatePipe, DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import {
  Alert,
  Badge,
  Button,
  Card,
  Disclosure,
  Field,
  Heading,
  Link,
  LinkButton,
  PinInput,
  Text,
  Textarea,
} from '../../ui';
import { ExampleWorkspace } from '../example-workspace';
import { exampleWorkspaceProviders } from '../example-workspace-providers';

@Component({
  selector: 'app-database-example',
  imports: [
    Alert,
    Badge,
    Card,
    Disclosure,
    PinInput,
    Button,
    Field,
    Link,
    LinkButton,
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

  private readonly recoveryHeading = viewChild<ElementRef<HTMLHeadingElement>>('recoveryHeading');
  private readonly noteHeading = viewChild<ElementRef<HTMLHeadingElement>>('noteHeading');

  private focusRecoveryResult = false;

  readonly workspace = inject(ExampleWorkspace);
  protected readonly autoUnlockPin = computed(() => !this.workspace.backedSample && this.workspace.hasBinding());

  protected confirmRecovery(): void {
    this.focusRecoveryResult = this.workspace.backedSample;
    this.workspace.privateResource.recovery.confirmRecovery();
  }

  private readonly focusVaultStep = afterRenderEffect({
    write: () => {
      const recovery = this.recoveryHeading();
      const note = this.noteHeading();
      const pin = this.localPinControl();
      const busy = this.workspace.busy();
      const enteringPin = this.workspace.backedSample && this.workspace.pinSetupSelected();
      const recoveryFinished = this.focusRecoveryResult && !busy && !recovery;

      if (recoveryFinished) {
        this.focusRecoveryResult = false;
      }

      if (this.document.activeElement !== this.document.body) {
        return;
      }

      if (recovery) {
        recovery.nativeElement.focus();
      } else if (recoveryFinished && this.workspace.vaultReady()) {
        note?.nativeElement.focus();
      } else if (enteringPin && !busy) {
        pin?.focus();
      }
    },
  });

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

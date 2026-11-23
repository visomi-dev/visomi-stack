import { DOCUMENT } from '@angular/common';
import { afterRenderEffect, Component, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ExampleWorkspace } from '../../db/example-workspace';
import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Card, Field, Heading, Link, PinInput, Text } from '../../ui';

@Component({
  selector: 'app-vault-unlock',
  imports: [Button, Card, Field, Heading, Link, NavigationHeading, PinInput, RouterLink, Text],
  templateUrl: './vault-unlock.html',
})
export class VaultUnlock {
  private readonly document = inject(DOCUMENT);

  private readonly pin = viewChild(PinInput);

  readonly workspace = inject(ExampleWorkspace);

  private readonly refocusAfterUnlockError = afterRenderEffect({
    write: () => {
      const pin = this.pin();

      if (
        pin &&
        !this.workspace.busy() &&
        this.workspace.notice() &&
        this.document.activeElement === this.document.body
      ) {
        pin.focus();
      }
    },
  });
}

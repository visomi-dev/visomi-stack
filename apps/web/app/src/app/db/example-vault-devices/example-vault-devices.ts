import { Component, afterNextRender, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Button, Card, Field, Heading, Input, Link, PinInput, Text, Textarea } from '../../ui';
import { type ExampleTarget } from '../example-contracts';
import { ExampleVaultPairing } from '../example-vault-pairing';

@Component({
  selector: 'app-example-vault-devices',
  imports: [Button, Card, Field, Heading, Input, Link, PinInput, Text, Textarea, RouterLink],
  providers: [ExampleVaultPairing],
  templateUrl: './example-vault-devices.html',
})
export class ExampleVaultDevices {
  protected readonly pairing = inject(ExampleVaultPairing);

  readonly target = input.required<ExampleTarget>();
  readonly backed = input(false);
  protected readonly resourceLink = computed(() => {
    const { tenantId, scopeId, objectId } = this.target();

    return this.backed() ? ['/db-example/vault'] : ['/db-example', tenantId, scopeId, objectId];
  });
  protected readonly resourceParams = computed(() => (this.backed() ? this.target() : null));

  readonly rpId = input.required<string>();

  private readonly initialize = afterNextRender(() => void this.pairing.initialize(this.target(), this.rpId()));
}

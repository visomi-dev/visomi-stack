import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import { ExampleVaultDevices } from '../../db/example-vault-devices';
import { exampleTargetSchema } from '../../db/example-contracts';
import { DatabaseHttp } from '../../shared/db/http';
import { ExampleVaultProfile } from '../../db/example-vault-profile';
import { NavigationHeading } from '../../shared/navigation-heading';
import { Heading, Text, Link, Card } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';

import { Methods, type MethodsView } from './methods';
import { Session } from './session';

@Component({
  selector: 'app-security',
  imports: [NavigationHeading, Heading, Text, Link, Card, RouterLink, AuthFeedback, ExampleVaultDevices],
  providers: [Action, AuthHttp, Methods, DatabaseHttp, ExampleVaultProfile],
  templateUrl: './security.html',
})
export class Security {
  private readonly api = inject(Methods);
  private readonly profile = inject(ExampleVaultProfile);
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  protected readonly pairingRelyingParty = signal('');

  protected readonly pairingTargets = computed(() => {
    const params = this.params();
    const target = exampleTargetSchema.safeParse({
      tenantId: params.get('tenantId'),
      scopeId: params.get('scopeId'),
      objectId: params.get('objectId'),
    });

    return target.success ? [target.data] : [];
  });

  readonly session = inject(Session);
  readonly action = inject(Action);

  readonly methods = signal<MethodsView | null>(null);

  readonly enabled = $localize`:@@authEnabled:Enabled`;
  readonly disabled = $localize`:@@authNotEnabled:Not enabled`;

  private readonly verifyPairingProfile = afterNextRender(async () => {
    if (!this.pairingTargets().length) {
      return;
    }

    const rpId = await this.profile.relyingParty();

    this.pairingRelyingParty.set(rpId);
  });

  private readonly initialize = afterNextRender(
    () =>
      void this.action.run(async () => {
        const methods = await this.api.list();

        this.methods.set(methods);

        await this.session.loadProviders();
      }),
  );
}

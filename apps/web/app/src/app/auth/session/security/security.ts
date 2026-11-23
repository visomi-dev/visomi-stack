import { Component, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { exampleVaultPairingLinkSchema } from '@visomi-stack/shared-db';

import { ExampleVaultDevices } from '../../../db/example-vault-devices/example-vault-devices';
import { exampleTargetSchema } from '../../../db/example-contracts';
import { DatabaseHttp } from '../../../shared/db/http';
import { ExampleVaultProfile } from '../../../db/example-vault-profile';
import { ExampleAvailability } from '../../../db/example-availability';
import { NavigationHeading } from '../../../shared/navigation-heading';
import { Heading, Text, Link, Card } from '../../../ui';
import { AuthHttp } from '../../shared/http';
import { Action } from '../../shared/action';
import { AuthFeedback } from '../../shared/feedback/feedback';
import { Methods, type MethodsView } from '../methods';
import { Session } from '../session';

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
  private readonly examples = inject(ExampleAvailability, { optional: true });

  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly rendered = signal(false);

  protected readonly pairingRelyingParty = signal('');

  protected readonly pairingBackedSample = computed(
    () => this.examples?.enabled() === true && this.params().get('sample') === 'vault-backup',
  );
  protected readonly pairingTargets = computed(() => {
    const params = this.params();
    const target = exampleTargetSchema.safeParse({
      tenantId: params.get('tenantId'),
      scopeId: params.get('scopeId'),
      objectId: params.get('objectId'),
    });

    return target.success ? [target.data] : [];
  });
  protected readonly pairingRequestId = computed(() => {
    const target = this.pairingTargets()[0];
    const parsed = exampleVaultPairingLinkSchema.safeParse({ ...target, requestId: this.params().get('requestId') });

    return parsed.success && this.pairingBackedSample() ? parsed.data.requestId : undefined;
  });

  readonly session = inject(Session);
  readonly action = inject(Action);

  readonly methods = signal<MethodsView | null>(null);

  readonly enabled = $localize`:@@authEnabled:Enabled`;
  readonly disabled = $localize`:@@authNotEnabled:Not enabled`;

  private readonly activatePairing = afterNextRender(() => this.rendered.set(true));

  private readonly verifyPairingProfile = effect((cleanup) => {
    if (!this.rendered() || !this.pairingTargets().length || this.pairingRelyingParty()) {
      return;
    }

    const controller = new AbortController();

    cleanup(() => controller.abort());
    void this.profile.relyingParty().then((rpId) => {
      if (!controller.signal.aborted) {
        this.pairingRelyingParty.set(rpId);
      }
    });
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

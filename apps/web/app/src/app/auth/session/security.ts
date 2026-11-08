import { Component, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Heading, Text, Link, Card } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';

import { Methods, type MethodsView } from './methods';
import { Session } from './session';

@Component({
  selector: 'app-security',
  imports: [NavigationHeading, Heading, Text, Link, Card, RouterLink, AuthFeedback],
  providers: [Action, AuthHttp, Methods],
  templateUrl: './security.html',
})
export class Security {
  readonly session = inject(Session);
  private readonly api = inject(Methods);
  readonly action = inject(Action);

  readonly methods = signal<MethodsView | null>(null);

  readonly enabled = $localize`:@@authEnabled:Enabled`;
  readonly disabled = $localize`:@@authNotEnabled:Not enabled`;

  private readonly initialize = afterNextRender(
    () =>
      void this.action.run(async () => {
        const methods = await this.api.list();

        this.methods.set(methods);

        await this.session.loadProviders();
      }),
  );
}

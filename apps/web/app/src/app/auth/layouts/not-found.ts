import { Component, inject, RESPONSE_INIT } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Session } from '../session/session';
import { destination } from '../session/navigation';
import { Link } from '../../ui';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, Link],
  template: `<main class="mx-auto max-w-md space-y-5 px-5 py-24">
    <h1 class="font-heading text-3xl font-bold" i18n="@@authNotFound">Page not found</h1>
    <p i18n="@@authNotFoundDescription">This page is not available. You can return to your account or sign in.</p>
    <a appUI [routerLink]="target" i18n="@@authContinue">Continue</a>
  </main>`,
})
export class NotFound {
  private readonly response = inject(RESPONSE_INIT, { optional: true });

  readonly target = destination(inject(Session).snapshot());

  constructor() {
    if (this.response) {
      this.response.status = 404;
    }
  }
}

import { Component, computed, inject, RESPONSE_INIT } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../shared/navigation-heading';
import { Session } from '../auth/session/session';
import { destination } from '../auth/session/navigation';
import { Heading, Text, LinkButton } from '../ui';
import { NotFoundLayout } from '../layouts/not-found-layout';

@Component({
  selector: 'app-not-found',
  imports: [NavigationHeading, RouterLink, Heading, Text, LinkButton, NotFoundLayout],
  templateUrl: './not-found.html',
})
export class NotFound {
  private readonly response = inject(RESPONSE_INIT, { optional: true });
  private readonly session = inject(Session);

  readonly target = computed(() => destination(this.session.snapshot()));

  constructor() {
    if (this.response) {
      this.response.status = 404;
    }
  }
}

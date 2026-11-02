import { Component, computed, inject, RESPONSE_INIT } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Session } from '../session/session';
import { destination } from '../session/navigation';
import { Link } from '../../ui';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, Link],
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

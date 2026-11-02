import { Component, inject, RESPONSE_INIT } from '@angular/core';
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

  readonly target = destination(inject(Session).snapshot());

  constructor() {
    if (this.response) {
      this.response.status = 404;
    }
  }
}

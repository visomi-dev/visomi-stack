import { Component, input } from '@angular/core';

import { Alert, Loader } from '../../ui';

import type { Action } from './action';

@Component({
  selector: 'app-auth-feedback',
  imports: [Alert, Loader],
  template: `
    @if (action().error()) {
      <div appUI="alert" tone="danger" role="alert" tabindex="-1" data-action-error>{{ action().error() }}</div>
    }
    @if (action().notice()) {
      <div appUI="alert" role="status">{{ action().notice() }}</div>
    }
    @if (action().busy()) {
      <span appUI="loader" role="status" aria-label="Working…" i18n-aria-label="@@authWorking"></span>
    }
  `,
})
export class AuthFeedback {
  readonly action = input.required<Action>();
}

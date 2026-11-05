import { Component, ElementRef, afterRenderEffect, input, viewChild } from '@angular/core';

import { Alert, Loader } from '../../ui';

import type { Action } from './action';

@Component({
  selector: 'app-auth-feedback',
  imports: [Alert, Loader],
  templateUrl: './feedback.html',
  host: {
    class: 'block min-w-0 space-y-3',
    '[hidden]': '!action().error() && !action().notice() && !action().busy()',
  },
})
export class AuthFeedback {
  readonly action = input.required<Action>();

  private readonly alert = viewChild<ElementRef<HTMLElement>>('error');

  private focusedAction: Action | null = null;
  private focusedVersion = 0;

  constructor() {
    afterRenderEffect({
      write: () => {
        const action = this.action();
        const version = action.errorFocus();
        const alert = this.alert();

        if (version && alert && (action !== this.focusedAction || version !== this.focusedVersion)) {
          this.focusedAction = action;
          this.focusedVersion = version;
          alert.nativeElement.focus();
        }
      },
    });
  }
}

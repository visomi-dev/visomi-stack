import { Component, input } from '@angular/core';

import { Alert, Loader } from '../../ui';

import type { Action } from './action';

@Component({
  selector: 'app-auth-feedback',
  imports: [Alert, Loader],
  templateUrl: './feedback.html',
})
export class AuthFeedback {
  readonly action = input.required<Action>();
}

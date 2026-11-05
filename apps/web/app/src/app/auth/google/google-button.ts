import { Component, ElementRef, afterNextRender, inject, input, output, viewChild } from '@angular/core';

import { Button } from '../../ui';
import type { Pending, SessionView } from '../session/models';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthHttp } from '../shared/http';

import { Google } from './google';

@Component({
  selector: 'app-google-button',
  imports: [Button, AuthFeedback],
  providers: [AuthHttp, Google],
  host: { class: 'flex min-w-0 flex-col gap-3' },
  templateUrl: './google-button.html',
})
export class GoogleButton {
  private readonly google = inject(Google);

  readonly intent = input<'login' | 'link' | 'reauth'>('login');
  readonly disabled = input(false);
  readonly completed = output<SessionView | (Pending & { factor: 'email' })>();
  readonly processing = output<boolean>();

  readonly action = new Action();

  private readonly button = viewChild.required<ElementRef<HTMLElement>>('button');

  constructor() {
    afterNextRender(() => this.render());
  }

  render(): void {
    void this.action.run(() =>
      this.google.button(
        this.button().nativeElement,
        this.intent(),
        (result) => {
          this.completed.emit(result);

          if (this.intent() === 'link' && 'access' in result) {
            this.render();
          }
        },
        (error) => {
          void this.action.run(async () => {
            throw error;
          });
        },
        () => !this.disabled(),
        (active) => this.processing.emit(active),
      ),
    );
  }
}

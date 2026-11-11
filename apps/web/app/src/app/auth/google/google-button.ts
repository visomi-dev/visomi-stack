import { Component, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';

import { Button } from '../../ui';
import type { Pending, SessionView } from '../session/models';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthHttp } from '../shared/http';

import { Google } from './google';

@Component({
  selector: 'app-google-button',
  imports: [Button, AuthFeedback],
  providers: [Action, AuthHttp, Google],
  host: { class: 'flex w-full max-w-[400px] min-w-0 flex-col gap-3 self-center' },
  templateUrl: './google-button.html',
})
export class GoogleButton {
  private readonly google = inject(Google);
  readonly action = inject(Action);

  readonly intent = input<'login' | 'link' | 'reauth'>('login');
  readonly disabled = input(false);
  readonly completed = output<SessionView | (Pending & { factor: 'email' })>();
  readonly processing = output<boolean>();

  readonly pending = signal(false);

  private readonly button = viewChild.required<ElementRef<HTMLElement>>('button');

  render(retry = false): void {
    void this.action.run(
      () =>
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
          (active) => {
            this.pending.set(active);
            this.processing.emit(active);
          },
        ),
      { name: retry ? 'retry' : undefined },
    );
  }

  private readonly initialize = afterNextRender(() => this.render());
}

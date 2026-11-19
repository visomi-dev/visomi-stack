import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { Button } from '../../../ui';
import type { Pending, SessionView } from '../../session/models';
import { Action } from '../../shared/action';
import { AuthFeedback } from '../../shared/feedback/feedback';
import { AuthHttp } from '../../shared/http';
import { Google } from '../google';

import { skeleton } from '@visomi-stack/web-frontend-ui';

@Component({
  selector: 'app-google-button',
  imports: [Button, AuthFeedback],
  providers: [Action, AuthHttp, Google],
  host: { class: 'flex w-full max-w-[400px] min-w-0 flex-col gap-3 self-center' },
  templateUrl: './google-button.html',
})
export class GoogleButton {
  private readonly google = inject(Google);

  private readonly initializing = signal(true);

  private readonly button = viewChild.required<ElementRef<HTMLElement>>('button');

  readonly action = inject(Action);

  readonly intent = input<'login' | 'link' | 'reauth'>('login');
  readonly checking = input(false);
  protected readonly loading = computed(
    () =>
      this.intent() === 'login' &&
      !this.action.error() &&
      (this.checking() ||
        this.initializing() ||
        this.action.pending() === 'load' ||
        this.action.pending() === 'retry' ||
        this.google.rendering()),
  );

  protected readonly skeleton = skeleton.classes();

  readonly disabled = input(false);
  readonly completed = output<SessionView | (Pending & { factor: 'email' })>();
  readonly processing = output<boolean>();

  readonly pending = signal(false);

  render(retry = false): void {
    this.initializing.set(false);

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
      { name: retry ? 'retry' : 'load' },
    );
  }

  private readonly initialize = afterRenderEffect(() => {
    if (!this.checking()) {
      untracked(() => this.render());
    }
  });
}

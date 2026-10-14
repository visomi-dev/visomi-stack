import {
  afterNextRender,
  booleanAttribute,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';

import { Icon } from '../../media/icon/icon';
import { uiClass } from '../../classes';

@Component({
  host: {
    class: /* tw */ 'block',
    '[attr.data-empty]': 'hasMessage() ? null : ""',
  },
  imports: [Icon],
  selector: 'app-error-message',
  templateUrl: './error-message.html',
  styleUrl: './error-message.css',
})
export class ErrorMessage {
  private readonly destroyRef = inject(DestroyRef);

  readonly controlId = input<string | null>(null);
  readonly withIcon = input(true, { transform: booleanAttribute });

  protected readonly hasMessage = signal(true);

  readonly classes = computed(() =>
    uiClass(
      'text-red-600 dark:text-red-400 inline-flex items-center gap-1.5 text-sm font-medium',
      this.withIcon() && 'pl-0',
    ),
  );

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly observeMessage = afterNextRender(() => {
    const message = this.element.nativeElement.querySelector('[data-slot="error"] > span');

    if (!message) {
      return;
    }

    const update = () => this.hasMessage.set(!!message.textContent?.trim());
    const observer = new MutationObserver(update);

    observer.observe(message, { childList: true, characterData: true, subtree: true });
    update();
    this.destroyRef.onDestroy(() => observer.disconnect());
  });
}

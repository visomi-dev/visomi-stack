import { CdkTrapFocus } from '@angular/cdk/a11y';
import { DOCUMENT } from '@angular/common';
import { booleanAttribute, Component, effect, inject, input, output } from '@angular/core';

@Component({
  host: { class: /* tw */ 'contents' },
  imports: [CdkTrapFocus],
  selector: 'app-dialog',
  templateUrl: './dialog.html',
  styleUrl: './dialog.css',
})
export class Dialog {
  private readonly document = inject(DOCUMENT);

  readonly ariaLabelledBy = input<string | null>(null);
  readonly closed = output<void>();
  readonly open = input(false, { transform: booleanAttribute });

  readonly scrollLockEffect = effect(() => {
    this.document.body.classList.toggle('overflow-hidden', this.open());
  });

  closeDialog(): void {
    this.closed.emit();
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closeDialog();
    }
  }
}

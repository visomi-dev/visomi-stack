import { Directive, ElementRef, computed, inject, input } from '@angular/core';

import { dialog as styles, type DialogSize } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'dialog[appUI]',
  exportAs: 'appUIDialog',
  host: { '[class]': 'classes()' },
})
export class Dialog {
  private readonly element = inject(ElementRef<HTMLDialogElement>);

  readonly uiSize = input<DialogSize>('md');

  protected readonly classes = computed(() => styles.classes({ size: this.uiSize() }));

  showModal(): void {
    if (!this.element.nativeElement.open) {
      this.element.nativeElement.showModal();
    }
  }

  close(): void {
    this.element.nativeElement.close();
  }
}

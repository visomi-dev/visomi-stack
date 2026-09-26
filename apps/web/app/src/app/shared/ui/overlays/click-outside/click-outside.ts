import { Directive, ElementRef, inject, output } from '@angular/core';

@Directive({
  host: {
    '(document:pointerdown)': 'onPointerDown($event)',
  },
  selector: '[appClickOutside]',
})
export class ClickOutside {
  readonly clickOutside = output<PointerEvent>();

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  onPointerDown(event: PointerEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.clickOutside.emit(event);
    }
  }
}

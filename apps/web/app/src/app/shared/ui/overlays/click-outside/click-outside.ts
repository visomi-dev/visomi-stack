import { Directive, ElementRef, inject, output } from '@angular/core';

@Directive({
  host: {
    '(document:pointerdown)': 'onPointerDown($event)',
  },
  selector: '[appClickOutside]',
})
export class ClickOutside {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly clickOutside = output<PointerEvent>();

  onPointerDown(event: PointerEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.clickOutside.emit(event);
    }
  }
}

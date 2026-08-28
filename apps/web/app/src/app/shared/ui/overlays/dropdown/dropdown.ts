import { OverlayModule } from '@angular/cdk/overlay';
import {
  AfterContentInit,
  booleanAttribute,
  Component,
  ContentChild,
  DestroyRef,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
} from '@angular/core';

@Component({
  host: { class: /* tw */ 'relative inline-block' },
  imports: [OverlayModule],
  selector: 'app-dropdown',
  templateUrl: './dropdown.html',
  styleUrl: './dropdown.css',
})
export class Dropdown implements AfterContentInit, OnDestroy {
  readonly align = input<'start' | 'end'>('start');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly openChange = output<boolean>();

  readonly open = signal(false);

  @ContentChild('[data-slot=trigger]', { descendants: true, read: ElementRef, static: true })
  private readonly triggerRef?: ElementRef<HTMLElement>;

  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.destroyRef.onDestroy(() => this.detachTriggerListeners());
  }

  ngAfterContentInit(): void {
    const triggerElement = this.triggerRef?.nativeElement;

    if (!triggerElement) {
      return;
    }

    triggerElement.setAttribute('aria-haspopup', 'menu');
    triggerElement.setAttribute('aria-expanded', String(this.open()));
    triggerElement.addEventListener('keydown', this.onTriggerKeydown);
  }

  ngOnDestroy(): void {
    this.detachTriggerListeners();
  }

  private detachTriggerListeners(): void {
    this.triggerRef?.nativeElement.removeEventListener('keydown', this.onTriggerKeydown);
  }

  toggle(): void {
    if (this.disabled()) {
      return;
    }

    this.setOpen(!this.open());
  }

  setOpen(open: boolean): void {
    this.open.set(open);
    this.triggerRef?.nativeElement.setAttribute('aria-expanded', String(open));
    this.openChange.emit(open);
  }

  close(): void {
    this.setOpen(false);
  }

  onHostClick(event: Event): void {
    const target = event.target as HTMLElement | null;

    if (target?.closest('[data-slot=trigger]')) {
      this.toggle();
    }
  }

  onHostKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;

    if (target?.closest('[data-slot=trigger]')) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggle();
      }
    }
  }

  private readonly onTriggerKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggle();
    }
  };

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
    }
  }
}

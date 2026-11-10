import { Service, afterNextRender, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, pairwise, skip, startWith } from 'rxjs';

@Service()
export class Navigation {
  private readonly router = inject(Router);

  private readonly rendered = signal(false);
  private readonly startupTransition = signal<[string, string] | undefined>(undefined);
  private readonly routeTransition = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects.split('#')[0]),
      startWith(this.router.url.split('#')[0]),
      pairwise(),
      // The initial navigation establishes the baseline without moving focus.
      skip(this.router.navigated ? 0 : 1),
    ),
  );

  readonly loading = computed(() => this.rendered() && this.router.currentNavigation() !== null);
  readonly headingFocus = computed(() => {
    const transition = this.routeTransition();

    if (!this.rendered() || !transition || transition === this.startupTransition()) {
      return null;
    }

    return transition[0] !== transition[1] ? transition : null;
  });

  private readonly initialize = afterNextRender(() => {
    this.startupTransition.set(this.routeTransition());
    this.rendered.set(true);
  });
}

import { DestroyRef, Service, afterNextRender, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { filter, map, pairwise, skip, startWith } from 'rxjs';

@Service()
export class Navigation {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

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

  private controller = new AbortController();

  private readonly cleanup = this.destroyRef.onDestroy(() => this.controller.abort());

  /** Abort the previous context synchronously; effects may run after an old operation resumes. */
  readonly context = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationStart),
      map((event) => {
        const previous = this.controller;

        this.controller = new AbortController();
        previous.abort();

        return { id: event.id, cancellation: this.controller.signal };
      }),
    ),
    { initialValue: { id: this.router.currentNavigation()?.id ?? 0, cancellation: this.controller.signal } },
  );

  readonly active = computed(() => this.router.currentNavigation() !== null);
  readonly loading = computed(() => this.rendered() && this.active());
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

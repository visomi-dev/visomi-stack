import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  provideRouter,
  withDisabledInitialNavigation,
  type Routes,
} from '@angular/router';
import { filter, firstValueFrom, Subject } from 'rxjs';

import { App } from '../app';

import { Navigation } from './navigation';
import { NavigationHeading } from './navigation-heading';

@Component({
  imports: [NavigationHeading],
  template: '<main><h1 appNavigationHeading>{{ path }}</h1><input aria-label="Example field" /></main>',
})
class Page {
  readonly path = inject(ActivatedRoute).snapshot.routeConfig?.path;
}

async function setup(routes: Routes) {
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: 'start', component: Page }, ...routes], withDisabledInitialNavigation())],
  });
  const fixture = TestBed.createComponent(App);

  await fixture.whenStable();

  const router = TestBed.inject(Router);

  await router.navigateByUrl('/start');

  await fixture.whenStable();

  const navigation = TestBed.inject(Navigation);
  const bar = () => fixture.nativeElement.querySelector('app-page-loader [aria-hidden="true"]') as HTMLElement | null;

  return { fixture, router, navigation, bar };
}

for (const phase of ['guard', 'resolver', 'lazy']) {
  it(`keeps page progress visible while the ${phase} blocks navigation`, async () => {
    const gate = new Subject<boolean>();
    const { fixture, router, navigation, bar } = await setup([
      { path: 'guard', component: Page, canActivate: [() => gate] },
      { path: 'resolver', component: Page, resolve: { ready: () => gate } },
      { path: 'lazy', loadComponent: () => firstValueFrom(gate).then(() => Page) },
    ]);
    const pending = router.navigateByUrl(`/${phase}`);

    await vi.waitFor(() => expect(bar()).not.toBeNull());

    expect(navigation.loading()).toBe(true);
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('start');
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Loading page…');
    gate.next(true);
    gate.complete();

    await pending;

    await fixture.whenStable();

    expect(navigation.loading()).toBe(false);
    expect(bar()).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent.trim()).toBe('');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('h1'));
  });
}

it('clears progress when a guard rejects or a resolver returns no data', async () => {
  const guard = new Subject<boolean>();
  const resolver = new Subject<boolean>();
  const { fixture, router, navigation, bar } = await setup([
    { path: 'denied', component: Page, canActivate: [() => guard] },
    { path: 'empty', component: Page, resolve: { ready: () => resolver } },
  ]);
  const denied = router.navigateByUrl('/denied');

  await vi.waitFor(() => expect(bar()).not.toBeNull());

  guard.next(false);
  guard.complete();

  const deniedResult = await denied;

  expect(deniedResult).toBe(false);

  await fixture.whenStable();

  expect(navigation.loading()).toBe(false);
  expect(bar()).toBeNull();
  const empty = router.navigateByUrl('/empty');

  await vi.waitFor(() => expect(bar()).not.toBeNull());

  resolver.complete();

  const emptyResult = await empty;

  expect(emptyResult).toBe(false);

  await fixture.whenStable();

  expect(navigation.loading()).toBe(false);
  expect(bar()).toBeNull();
  expect(router.url).toBe('/start');
});

it('clears progress after a resolver fails', async () => {
  const gate = new Subject<boolean>();
  const { fixture, router, navigation, bar } = await setup([
    { path: 'failure', component: Page, resolve: { ready: () => gate } },
  ]);
  const failure = new Error('synthetic-resolver-failure');
  const pending = router.navigateByUrl('/failure').catch((error: unknown) => error);

  await vi.waitFor(() => expect(bar()).not.toBeNull());

  gate.error(failure);

  const result = await pending;

  expect(result).toBe(failure);

  await fixture.whenStable();

  expect(navigation.loading()).toBe(false);
  expect(bar()).toBeNull();
  expect(router.url).toBe('/start');
});

it('keeps progress active when a newer navigation replaces a pending resolver', async () => {
  const first = new Subject<boolean>();
  const second = new Subject<boolean>();
  const { fixture, router, navigation, bar } = await setup([
    { path: 'first', component: Page, resolve: { ready: () => first } },
    { path: 'second', component: Page, resolve: { ready: () => second } },
  ]);
  const cancelled = router.navigateByUrl('/first');

  await vi.waitFor(() => expect(bar()).not.toBeNull());

  const completed = router.navigateByUrl('/second');

  const cancelledResult = await cancelled;

  expect(cancelledResult).toBe(false);

  await vi.waitFor(() => expect(router.currentNavigation()?.extractedUrl.toString()).toBe('/second'));

  await vi.waitFor(() => expect(second.observed).toBe(true));

  expect(navigation.loading()).toBe(true);
  expect(bar()).not.toBeNull();
  second.next(true);
  second.complete();

  await completed;

  await fixture.whenStable();

  expect(navigation.loading()).toBe(false);
  expect(bar()).toBeNull();
  expect(router.url).toBe('/second');
});

it('follows redirects and leaves skipped navigations idle', async () => {
  const gate = new Subject<boolean>();
  const { fixture, router, navigation, bar } = await setup([
    { path: 'redirect', component: Page, canActivate: [() => inject(Router).parseUrl('/next')] },
    { path: 'next', component: Page, resolve: { ready: () => gate } },
  ]);
  const pending = router.navigateByUrl('/redirect');

  await vi.waitFor(() => expect(bar()).not.toBeNull());

  expect(navigation.loading()).toBe(true);
  gate.next(true);
  gate.complete();

  await pending;

  await fixture.whenStable();

  expect(router.url).toBe('/next');
  expect(navigation.loading()).toBe(false);
  expect(bar()).toBeNull();

  const skipped = await router.navigateByUrl('/next');

  expect(skipped).toBe(false);

  await fixture.whenStable();

  expect(navigation.loading()).toBe(false);
  expect(bar()).toBeNull();
});

it('preserves focus on the initial page and fragment-only changes through declarative attributes', async () => {
  const { fixture, router, navigation } = await setup([]);
  const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

  expect(document.activeElement).not.toBe(fixture.nativeElement.querySelector('h1'));
  expect(navigation.headingFocus()).toBeNull();
  expect(fixture.nativeElement.querySelector('h1').getAttribute('tabindex')).toBeNull();
  input.focus();

  await router.navigateByUrl('/start#example');

  await fixture.whenStable();

  expect(document.activeElement).toBe(input);
  expect(navigation.headingFocus()).toBeNull();
});

it('focuses the final page when initial and subsequent completions arrive before the next render', async () => {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [
          { path: 'first', component: Page },
          { path: 'second', component: Page },
        ],
        withDisabledInitialNavigation(),
      ),
    ],
  });
  const fixture = TestBed.createComponent(App);

  await fixture.whenStable();

  const router = TestBed.inject(Router);
  const firstCompletion = firstValueFrom(
    router.events.pipe(filter((event) => event instanceof NavigationEnd && event.urlAfterRedirects === '/first')),
  );
  const secondNavigation = firstCompletion.then(() => router.navigateByUrl('/second'));

  await router.navigateByUrl('/first');

  await secondNavigation;

  await fixture.whenStable();

  expect(fixture.nativeElement.querySelector('h1').textContent).toBe('second');
  expect(document.activeElement).toBe(fixture.nativeElement.querySelector('h1'));
});

it('focuses the next page when the service is initialized after navigation has already completed', async () => {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [
          { path: 'first', component: Page },
          { path: 'second', component: Page },
        ],
        withDisabledInitialNavigation(),
      ),
    ],
  });
  const router = TestBed.inject(Router);

  await router.navigateByUrl('/first');

  const fixture = TestBed.createComponent(App);

  await fixture.whenStable();

  expect(document.activeElement).not.toBe(fixture.nativeElement.querySelector('h1'));

  await router.navigateByUrl('/second');

  await fixture.whenStable();

  expect(document.activeElement).toBe(fixture.nativeElement.querySelector('h1'));
});

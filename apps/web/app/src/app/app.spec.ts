import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';

it('composes routed pages without starting authentication', async () => {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(App);

  await fixture.whenStable();

  expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
});

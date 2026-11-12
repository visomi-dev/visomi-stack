import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Session } from '../auth/session/session';

import { LanguageSwitcher } from './language-switcher';

for (const locale of ['en-US', 'es']) {
  describe(`${locale} language navigation`, () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([{ path: '**', component: LanguageSwitcher }]),
          { provide: LOCALE_ID, useValue: locale },
          { provide: Session, useValue: {} },
        ],
      });
    });

    for (const [current, destination] of [
      ['/foundations?view=buttons#actions', '/foundations?view=buttons#actions'],
      ['/auth/sign-in/verify?flowId=private#code', '/auth/sign-in/password'],
      ['/auth/reset-password?flowId=private', '/auth/forgot-password'],
      ['/auth/recovery/verify?code=private', '/auth/recovery'],
      ['/auth/google/verify-email', '/auth/sign-in'],
      ['/auth/sign-in/verify?returnTo=%2Faccount', '/auth/sign-in/password?returnTo=%2Faccount'],
      [
        '/security/devices/review?requestId=11111111-1111-4111-8111-111111111111&code=private',
        '/security/devices/review?requestId=11111111-1111-4111-8111-111111111111',
      ],
      ['/security/devices/review?requestId=invalid&code=private', '/security/devices/review'],
    ]) {
      it(`links to the safe equivalent of ${current.split('?')[0]}`, async () => {
        const router = TestBed.inject(Router);

        await router.navigateByUrl(current);

        const fixture = TestBed.createComponent(LanguageSwitcher);

        await fixture.whenStable();

        const links = fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>;
        const target = locale === 'es' ? 'en' : 'es';

        expect(links.length).toBe(1);
        expect(links[0].getAttribute('href')).toBe(`/app/${target}${destination}`);
        expect(links[0].getAttribute('lang')).toBe(target);
        expect(links[0].getAttribute('hreflang')).toBe(target);
        expect(links[0].getAttribute('rel')).toBe('alternate');
        expect(links[0].textContent?.trim()).toBe(target === 'es' ? 'Español' : 'English');
        const currentLanguage = fixture.nativeElement.querySelector('[data-current-language]') as HTMLElement;

        expect(currentLanguage.tagName).toBe('SPAN');
        expect(currentLanguage.getAttribute('aria-current')).toBe('true');
        expect(currentLanguage.getAttribute('lang')).toBe(locale === 'es' ? 'es' : 'en');
        expect(currentLanguage.textContent?.trim()).toBe(locale === 'es' ? 'Español' : 'English');
        expect(fixture.nativeElement.querySelector('nav > svg')?.getAttribute('aria-hidden')).toBe('true');
      });
    }
  });
}

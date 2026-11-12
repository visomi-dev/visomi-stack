import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Session } from '../auth/session/session';

import { Foundations } from './foundations';

describe('design foundations', () => {
  it('provides a labelled native theme control and the destination language', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'foundations', component: Foundations }]), { provide: Session, useValue: {} }],
    });

    await TestBed.inject(Router).navigateByUrl('/foundations?view=buttons#button-heading');

    const fixture = TestBed.createComponent(Foundations);

    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const select = element.querySelector('select');
    const languageLinks = element.querySelectorAll('app-language-switcher a[hreflang]');

    expect(select?.closest('label')?.textContent).toContain('Appearance');
    expect(Array.from(select?.options ?? [], (option) => option.value)).toEqual(['system', 'light', 'dark']);
    expect(Array.from(languageLinks, (link) => [link.textContent.trim(), link.getAttribute('href')])).toEqual([
      ['Español', '/app/es/foundations?view=buttons#button-heading'],
    ]);

    expect(element.querySelector('a[href$="#main"]')).not.toBeNull();
  });
});

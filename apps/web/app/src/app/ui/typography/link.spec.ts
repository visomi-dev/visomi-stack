import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, RouterLink } from '@angular/router';

import { Link } from './link';

import type { LinkVariant, LinkUnderline } from '@visomi-stack/web-frontend-ui';

@Component({
  imports: [Link, RouterLink],
  template: `<a
    appUI
    [variant]="variant()"
    [underline]="underline()"
    [routerLink]="['/guide']"
    [queryParams]="{ section: 'links' }"
    target="_blank"
    rel="noopener"
    download="guide.txt"
    aria-current="page"
    class="consumer-spacing"
    >Guide</a
  >`,
})
class NativeLink {
  readonly variant = signal<LinkVariant>('default');
  readonly underline = signal<LinkUnderline>('always');
}

describe('native Angular text link', () => {
  it('updates visual options while retaining the native anchor and RouterLink attributes', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(NativeLink);

    await fixture.whenStable();

    const element = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;

    expect(element.getAttribute('href')).toBe('/guide?section=links');
    expect(element.target).toBe('_blank');
    expect(element.rel).toBe('noopener');
    expect(element.download).toBe('guide.txt');
    expect(element.getAttribute('aria-current')).toBe('page');
    expect(element.classList.contains('underline')).toBe(true);
    fixture.componentInstance.variant.set('muted');
    fixture.componentInstance.underline.set('hover');

    await fixture.whenStable();

    expect(element.classList.contains('text-zinc-600')).toBe(true);
    expect(element.classList.contains('hover:underline')).toBe(true);
    expect(element.classList.contains('text-blue-700')).toBe(false);
    expect(element.classList.contains('underline')).toBe(false);
    fixture.componentInstance.variant.set('inverse');
    fixture.componentInstance.underline.set('none');

    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('a')).toBe(element);
    expect(element.classList.contains('text-white')).toBe(true);
    expect(element.classList.contains('focus-visible:outline-white')).toBe(true);
    expect(element.classList.contains('ui-focus-ring')).toBe(false);
    expect(element.classList.contains('text-zinc-600')).toBe(false);
    expect(element.classList.contains('hover:underline')).toBe(false);
    expect(element.classList.contains('consumer-spacing')).toBe(true);
    expect(element.getAttribute('href')).toBe('/guide?section=links');
    expect(element.target).toBe('_blank');
    expect(element.download).toBe('guide.txt');
  });
});

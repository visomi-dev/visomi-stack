import { TestBed } from '@angular/core/testing';

import { App } from './app';

describe('design foundations', () => {
  it('provides a labelled native theme control and both localized entry points', async () => {
    const fixture = TestBed.createComponent(App);

    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const select = element.querySelector('select');

    expect(select?.closest('label')?.textContent).toContain('Appearance');
    expect(Array.from(select?.options ?? [], (option) => option.value)).toEqual(['system', 'light', 'dark']);
    expect(element.querySelector('a[hreflang="es"]')?.getAttribute('href')).toBe('/app/es/');
    expect(element.querySelector('a[href="#main"]')).not.toBeNull();
  });
});

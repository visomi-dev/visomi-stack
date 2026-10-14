import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, signal, TemplateRef, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { PageTitle } from './page-title';
import { PageTitles } from './page-titles';

@Component({
  imports: [PageTitle],
  selector: 'app-title-test-page',
  template:
    '<h1 *appPageTitle id="test-title">{{ title() }}</h1><section aria-labelledby="test-title"><h2 i18n="@@testPageTitleSection">Section</h2></section>',
})
class TitleTestPage {
  readonly title = signal('Welcome');
}

@Component({
  providers: [PageTitles],
  imports: [NgTemplateOutlet, TitleTestPage],
  template: `
    <header><ng-container [ngTemplateOutlet]="titles.template()" /></header>
    <main>
      @if (visible()) {
        <app-title-test-page />
      }
    </main>
  `,
})
class TitleTestLayout {
  readonly titles = inject(PageTitles);

  readonly visible = signal(true);
}

@Component({
  template:
    '<ng-template i18n="@@testPageTitleFirst" #first>First</ng-template><ng-template i18n="@@testPageTitleSecond" #second>Second</ng-template>',
})
class TitleTemplates {
  readonly first = viewChild.required<TemplateRef<unknown>>('first');
  readonly second = viewChild.required<TemplateRef<unknown>>('second');
}

describe('PageTitle', () => {
  it('renders one shell title, preserves heading associations and clears it when the route leaves', async () => {
    const fixture = TestBed.createComponent(TitleTestLayout);

    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('h1')).toHaveLength(1);
    expect(element.querySelector('header h1')?.textContent).toBe('Welcome');
    expect(element.querySelector('main h1')).toBeNull();
    expect(element.querySelector('main h2')?.textContent).toBe('Section');
    expect(element.querySelector('section')?.getAttribute('aria-labelledby')).toBe('test-title');
    fixture.componentInstance.visible.set(false);
    await fixture.whenStable();
    expect(element.querySelector('header h1')).toBeNull();
    fixture.componentInstance.visible.set(true);
    await fixture.whenStable();
    expect(element.querySelectorAll('h1')).toHaveLength(1);
  });

  it('renders and updates standalone page titles without a layout provider', async () => {
    const fixture = TestBed.createComponent(TitleTestPage);

    await fixture.whenStable();
    fixture.componentInstance.title.set('Ready');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toBe('Ready');
  });

  it('does not let a departing title clear the next route title', async () => {
    const fixture = TestBed.createComponent(TitleTemplates);

    await fixture.whenStable();
    const titles = new PageTitles();
    const detachFirst = titles.attach(fixture.componentInstance.first());
    const detachSecond = titles.attach(fixture.componentInstance.second());

    detachFirst();
    expect(titles.template()).toBe(fixture.componentInstance.second());
    detachSecond();
    expect(titles.template()).toBeNull();
  });
});

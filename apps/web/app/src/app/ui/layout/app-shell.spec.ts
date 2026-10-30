import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, RouterLink } from '@angular/router';

import { AppShell, Sidebar, Topbar, Navbar, NavItem, Button, Link } from '../index';

import type { ShellLayout } from '@visomi-stack/web-frontend-ui';

@Component({
  imports: [AppShell, Sidebar, Topbar, Navbar, NavItem, Button, Link, RouterLink],
  template: `
    <app-shell contentId="workspace-main" skipLabel="Skip navigation" [layout]="layout()">
      <app-sidebar label="Primary">
        <a data-slot="brand" href="/">Brand</a>
        <a appUI="nav-item" [routerLink]="['/settings']" [queryParams]="{ tab: 'profile' }" aria-current="page"
          >Settings</a
        >
        <p data-slot="footer">Workspace footer</p>
      </app-sidebar>
      <header app-topbar>
        <h1 data-slot="title">Workspace</h1>
        <button appUI="nav-item" type="button" [disabled]="locked()" (click)="count.set(count() + 1)">Help</button>
      </header>
      <p>Projected page</p>
      <button appUI type="button">Save</button>
      <a appUI href="/help">Help center</a>
      <footer data-shell-footer>Page footer</footer>
      <nav appUI="navbar" aria-label="Primary">
        <a appUI="nav-item" placement="navbar" href="/settings">Settings</a>
      </nav>
    </app-shell>
  `,
})
class ShellExample {
  readonly layout = signal<ShellLayout>('sidebar');
  readonly locked = signal(false);
  readonly count = signal(0);
}

describe('application shell composition', () => {
  it('owns one main landmark and places named parts outside it', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ShellExample);

    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const main = root.querySelector('main') as HTMLElement;

    expect(root.querySelectorAll('main')).toHaveLength(1);
    expect(main.id).toBe('workspace-main');
    expect(main.tabIndex).toBe(-1);
    expect(main.querySelector('p')?.textContent?.trim()).toBe('Projected page');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('#workspace-main');
    expect(root.querySelector('app-sidebar nav')?.getAttribute('aria-label')).toBe('Primary');
    expect(root.querySelector('app-sidebar nav [data-slot=brand]')).toBeNull();
    expect(root.querySelector('app-sidebar nav [data-slot=footer]')).toBeNull();
    expect(root.querySelector('header h1')?.textContent).toBe('Workspace');
    expect(main.querySelector('header, footer, nav')).toBeNull();
    fixture.componentInstance.layout.set('stacked');

    await fixture.whenStable();

    expect(root.querySelector('app-sidebar')?.parentElement?.className).toBe('hidden');
    expect(root.querySelector('main')).toBe(main);
  });

  it('keeps native link routing, button events and disabled behavior', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ShellExample);

    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const link = root.querySelector('app-sidebar nav a') as HTMLAnchorElement;
    const button = root.querySelector('header button') as HTMLButtonElement;

    expect(link.getAttribute('href')).toBe('/settings?tab=profile');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(link.hasAttribute('type')).toBe(false);
    expect(button.type).toBe('button');
    expect(fixture.debugElement.queryAll(By.directive(Button))).toHaveLength(1);
    expect(fixture.debugElement.queryAll(By.directive(Link))).toHaveLength(1);
    button.click();
    expect(fixture.componentInstance.count()).toBe(1);
    fixture.componentInstance.locked.set(true);

    await fixture.whenStable();

    button.click();
    expect(fixture.componentInstance.count()).toBe(1);
    expect(button.disabled).toBe(true);
  });
});

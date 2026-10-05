import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { BottomNavigation, BottomNavigationItem } from './bottom-navigation';

@Component({
  imports: [BottomNavigation, BottomNavigationItem],
  template: `
    <app-bottom-navigation>
      <app-bottom-navigation-item [ariaLabel]="label" routerLink="/projects" [queryParams]="queryParams()">
        <span>{{ label }}</span>
      </app-bottom-navigation-item>
    </app-bottom-navigation>
  `,
})
class Host {
  readonly queryParams = signal<Record<string, string> | null>({ tab: 'archived' });
  readonly label = 'Projects';
}

describe('BottomNavigation', () => {
  it('retains native named links and updates route query parameters without replacing the link', async () => {
    await TestBed.configureTestingModule({ imports: [Host], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(Host);

    await fixture.whenStable();
    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;

    expect(link.getAttribute('aria-label')).toBe('Projects');
    expect(link.textContent).toContain('Projects');
    expect(link.getAttribute('href')).toBe('/projects?tab=archived');
    fixture.componentInstance.queryParams.set({ tab: 'active' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('a')).toBe(link);
    expect(link.getAttribute('href')).toBe('/projects?tab=active');
    fixture.componentInstance.queryParams.set(null);
    await fixture.whenStable();
    expect(link.getAttribute('href')).toBe('/projects');
  });

  it('reserves the device safe area beneath mobile navigation', async () => {
    await TestBed.configureTestingModule({ imports: [BottomNavigation] }).compileComponents();
    const fixture = TestBed.createComponent(BottomNavigation);

    await fixture.whenStable();
    expect(fixture.nativeElement.classList.contains('pb-[env(safe-area-inset-bottom)]')).toBe(true);
  });
});

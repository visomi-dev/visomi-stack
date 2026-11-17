import { provideHttpClient } from '@angular/common/http';
import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import type { SessionSnapshot } from '../auth/session/models';
import { Session } from '../auth/session/session';
import { BackupCodes } from '../auth/totp/backup-codes';
import { Vaults } from '../shared/vault/vaults';

import { AuthenticatedLayout } from './authenticated-layout';

it('recreates private routed content only when the account identity changes', async () => {
  const snapshot = signal<SessionSnapshot>({
    authenticated: true,
    user: { id: 'first-user', email: 'first@example.test', emailVerified: true },
    access: 'full',
    method: 'password',
    nextStep: null,
  });

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideRouter([
        {
          path: '',
          component: AuthenticatedLayout,
          children: [{ path: 'security/recovery-codes', component: BackupCodes }],
        },
      ]),
      {
        provide: Session,
        useValue: {
          snapshot,
          user: computed(() => snapshot().user),
          full: () => true,
          status: () => 'ready',
          operationVersion: signal(0),
          cancellation: () => new AbortController().signal,
        },
      },
    ],
  });

  const harness = await RouterTestingHarness.create('/security/recovery-codes');
  const original = harness.fixture.debugElement.query(By.directive(BackupCodes)).componentInstance as BackupCodes;

  original.codes.set(['synthetic-account-a-backup-code']);

  await harness.fixture.whenStable();

  expect(harness.routeNativeElement?.textContent).toContain('synthetic-account-a-backup-code');
  snapshot.set({ ...snapshot(), user: { ...snapshot().user! } });

  await harness.fixture.whenStable();

  expect(harness.fixture.debugElement.query(By.directive(BackupCodes)).componentInstance).toBe(original);
  expect(harness.routeNativeElement?.textContent).toContain('synthetic-account-a-backup-code');

  // Both snapshots remain full: no intermediate loading state may hide the problem.
  snapshot.set({
    ...snapshot(),
    user: { id: 'second-user', email: 'second@example.test', emailVerified: true },
  });

  await harness.fixture.whenStable();

  const replacement = harness.fixture.debugElement.query(By.directive(BackupCodes)).componentInstance as BackupCodes;

  expect(replacement).not.toBe(original);
  expect(original.codes()).toEqual([]);
  expect(replacement.codes()).toEqual([]);
  expect(harness.routeNativeElement?.textContent).not.toContain('synthetic-account-a-backup-code');
  expect(harness.routeNativeElement?.textContent).toContain('Existing backup codes cannot be displayed again.');
});

@Component({ selector: 'app-vault-route-fixture', template: '<h1>Fixture route</h1>' })
class VaultRouteFixture {}

it('keeps route exclusions in the shell and reuses the shared prompt during SPA navigation', async () => {
  const user = signal({
    id: '11111111-1111-4111-8111-111111111111',
    email: 'synthetic@example.test',
    emailVerified: true,
  });
  const access = {
    show: signal(true),
    binding: () => ({ method: 'pin-argon2id' as const }),
    busy: signal(false),
    pin: signal(''),
    notice: signal(''),
    unlock: vi.fn(),
    lock: vi.fn(),
    vault: { knownBindings: signal([]) },
  };

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideRouter([
        {
          path: '',
          component: AuthenticatedLayout,
          children: [
            { path: 'home', component: VaultRouteFixture },
            { path: 'persistence', component: VaultRouteFixture },
            { path: 'account', component: VaultRouteFixture },
          ],
        },
      ]),
      {
        provide: Session,
        useValue: {
          user,
          full: signal(true),
          status: signal('ready'),
          operationVersion: signal(0),
          cancellation: () => new AbortController().signal,
        },
      },
    ],
  });

  TestBed.overrideComponent(AuthenticatedLayout, { add: { providers: [{ provide: Vaults, useValue: access }] } });

  const harness = await RouterTestingHarness.create('/home');
  const layout = harness.fixture.debugElement.query(By.directive(AuthenticatedLayout)).componentInstance;

  expect(harness.routeNativeElement?.querySelector('#workspace-vault-pin')).not.toBeNull();

  await harness.navigateByUrl('/persistence');

  expect(harness.fixture.debugElement.query(By.directive(AuthenticatedLayout)).componentInstance).toBe(layout);
  expect(harness.routeNativeElement?.querySelector('#workspace-vault-pin')).toBeNull();

  await harness.navigateByUrl('/account');

  expect(harness.routeNativeElement?.querySelector('#workspace-vault-pin')).not.toBeNull();
  access.show.set(false);

  await harness.fixture.whenStable();

  expect(harness.routeNativeElement?.querySelector('#workspace-vault-pin')).toBeNull();
  expect(access.unlock).not.toHaveBeenCalled();
});

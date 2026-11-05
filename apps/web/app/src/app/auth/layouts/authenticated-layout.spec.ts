import { provideHttpClient } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER } from 'rxjs';

import type { SessionSnapshot } from '../session/models';
import { Session } from '../session/session';
import { BackupCodes } from '../totp/backup-codes';

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
          cancelled: NEVER,
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

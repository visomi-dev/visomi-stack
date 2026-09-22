import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { Auth } from '../../shared/auth/auth';
import { DeviceApproval } from '../../shared/auth/device-approval';
import { Passkey } from '../../shared/auth/passkey';
import { SecurityAuth } from '../../shared/auth/security-auth';
import { Deps } from '../../shared/deps';

import { DeviceApprovalPage } from './device-approval';

describe('DeviceApprovalPage', () => {
  it('does not let a reloaded requester approve itself or invent its lost code', async () => {
    const requestId = '12345678-1234-4234-8234-123456789abc';
    const approval = {
      review: vi.fn().mockResolvedValue({
        requestId,
        requester: true,
        status: 'approved',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        createdAt: new Date().toISOString(),
        accountId: 'account',
      }),
      consume: vi.fn(),
      approve: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [DeviceApprovalPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({ requestId })) } },
        { provide: DeviceApproval, useValue: approval },
        { provide: Auth, useValue: { user: () => ({ accountId: 'account' }) } },
        { provide: Passkey, useValue: {} },
        { provide: SecurityAuth, useValue: {} },
        { provide: Deps, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DeviceApprovalPage);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('This page was reloaded');
    expect(fixture.nativeElement.textContent).not.toContain('Continue passkey setup');
    expect(fixture.nativeElement.textContent).not.toContain('Confirm passkey and approve');
    expect(approval.consume).not.toHaveBeenCalled();
    expect(approval.approve).not.toHaveBeenCalled();
  });
});

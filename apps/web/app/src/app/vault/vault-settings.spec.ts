import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SecurityAction } from '../shared/auth/security-action';

import { PinUnlock } from './pin-unlock';
import { VaultSession } from './vault-session';
import { VaultSettings } from './vault-settings';

type Secrets = { pinModel: WritableSignal<{ pin: string }>; recoveryModel: WritableSignal<{ recovery: string }> };

describe('vault settings generation-bound secrets', () => {
  it('clears departing secrets but never wipes new-generation input from a late form-reset effect', async () => {
    const generation = signal(1);

    TestBed.configureTestingModule({
      imports: [VaultSettings],
      providers: [
        { provide: VaultSession, useValue: { generation, state: signal('locked') } },
        { provide: PinUnlock, useValue: { cancel: vi.fn() } },
        { provide: SecurityAction, useValue: {} },
      ],
    }).overrideComponent(VaultSettings, { set: { template: '', providers: [] } });
    const fixture = TestBed.createComponent(VaultSettings);
    const secrets = fixture.componentInstance as unknown as Secrets;

    await fixture.whenStable();
    secrets.pinModel.set({ pin: '829374' });
    secrets.recoveryModel.set({ recovery: 'departing-recovery' });
    generation.set(2);
    expect(secrets.pinModel()).toEqual({ pin: '' });
    expect(secrets.recoveryModel()).toEqual({ recovery: '' });
    secrets.pinModel.set({ pin: '937284' });
    secrets.recoveryModel.set({ recovery: 'new-generation-recovery' });
    await fixture.whenStable();
    expect(secrets.pinModel()).toEqual({ pin: '937284' });
    expect(secrets.recoveryModel()).toEqual({ recovery: 'new-generation-recovery' });
    fixture.destroy();
  });
});

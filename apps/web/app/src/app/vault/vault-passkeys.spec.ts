import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { of, Subject } from 'rxjs';

import { Auth } from '../shared/auth/auth';
import { Passkey } from '../shared/auth/passkey';
import { SecurityAction } from '../shared/auth/security-action';

import { PrfUnlock } from './prf-unlock';
import { VaultPasskeys } from './vault-passkeys';
import { VaultSession } from './vault-session';

describe('passkey vault settings controls', () => {
  const user = signal({
    id: '67429346-804a-4bb1-a832-b06a0be39bb1',
    accountId: 'eaa11fea-b03d-46a2-b327-c55d9b09fd5a',
    authVersion: 1,
  });
  const state = signal('unlocked');
  const generation = signal(1);
  const pending = signal(null);
  const get = vi.fn();
  const listCredentials = vi.fn();
  const prf = { methods: vi.fn(), enroll: vi.fn(), unlock: vi.fn(), revoke: vi.fn(), cancel: vi.fn() };
  const run = vi.fn();
  const credential = { id: 'AQ', label: 'Laptop passkey', revokedAt: null };
  const method = {
    methodId: '4848dd5b-dbbd-41a4-8b22-31514d1b8086',
    credentialId: 'AQ',
    revision: 1,
    createdAt: '2026-10-04T01:00:00Z',
  };
  let fixture: ComponentFixture<VaultPasskeys>;

  function button(name: string): HTMLButtonElement {
    const element = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === name,
    );

    if (!element) throw new Error(`missing_button:${name}`);

    return element;
  }

  beforeEach(async () => {
    user.set({
      id: '67429346-804a-4bb1-a832-b06a0be39bb1',
      accountId: 'eaa11fea-b03d-46a2-b327-c55d9b09fd5a',
      authVersion: 1,
    });
    state.set('unlocked');
    generation.set(1);
    get.mockReset().mockReturnValue(of({ data: { prf: true } }));
    listCredentials.mockReset().mockResolvedValue([credential]);
    prf.methods.mockReset().mockResolvedValue([]);
    prf.enroll.mockReset().mockResolvedValue(undefined);
    prf.unlock.mockReset().mockResolvedValue(undefined);
    prf.revoke.mockReset().mockResolvedValue(undefined);
    prf.cancel.mockReset();
    run.mockReset().mockImplementation(async (_context, mutate) => mutate('grant-id'));
    await TestBed.configureTestingModule({
      imports: [VaultPasskeys],
      providers: [
        { provide: Auth, useValue: { user, isAuthenticated: signal(true) } },
        { provide: HttpClient, useValue: { get } },
        { provide: Passkey, useValue: { listCredentials } },
        { provide: SecurityAction, useValue: { pending, run } },
        { provide: VaultSession, useValue: { state, generation } },
      ],
    })
      .overrideComponent(VaultPasskeys, { set: { providers: [{ provide: PrfUnlock, useValue: prf }] } })
      .compileComponents();
    fixture = TestBed.createComponent(VaultPasskeys);
  });
  afterEach(() => TestBed.resetTestingModule());

  it('keeps disabled capability fail-closed without requesting credentials or method ciphertext', async () => {
    get.mockReturnValue(of({ data: { prf: false } }));
    await fixture.whenStable();
    await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
    expect(fixture.nativeElement.textContent).toContain('Passkey vault unlock is unavailable');
    expect(listCredentials).not.toHaveBeenCalled();
    expect(prf.methods).not.toHaveBeenCalled();
    expect(prf.enroll).not.toHaveBeenCalled();
  });

  it('enrolls only with a management grant and disables duplicate actions while confirming', async () => {
    let approve: (() => Promise<void>) | undefined;

    run.mockImplementation(
      (_context, mutate) =>
        new Promise<void>((resolve, reject) => {
          approve = async () => {
            try {
              await mutate('grant-id');
              resolve();
            } catch (error) {
              reject(error);
            }
          };
        }),
    );
    await fixture.whenStable();
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(button('Enable passkey vault unlock')).toBeDefined();
    });
    button('Enable passkey vault unlock').click();
    await fixture.whenStable();
    expect(prf.enroll).not.toHaveBeenCalled();
    expect(button('Enable passkey vault unlock').disabled).toBe(true);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ authority: 'operation', purpose: 'vault_unlock_manage' }),
      expect.any(Function),
    );
    await approve?.();
    await fixture.whenStable();
    expect(prf.enroll).toHaveBeenCalledWith('AQ', 'grant-id');
    expect(fixture.nativeElement.textContent).toContain('Passkey vault unlock saved.');
  });

  it('shows unlock while locked, names methods and avoids offering duplicate enrollment', async () => {
    state.set('locked');
    prf.methods.mockResolvedValue([method]);
    await fixture.whenStable();
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(button('Unlock with passkey')).toBeDefined();
    });
    expect(fixture.nativeElement.textContent).toContain(credential.label);
    button('Unlock with passkey').click();
    await fixture.whenStable();
    expect(prf.unlock).toHaveBeenCalledWith(method.methodId);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Enable passkey vault unlock');
  });

  it('rejects a late confirmation after the owner version changes', async () => {
    let approve: (() => Promise<void>) | undefined;

    run.mockImplementation(
      (_context, mutate) =>
        new Promise<void>((resolve, reject) => {
          approve = async () => {
            try {
              await mutate('grant-id');
              resolve();
            } catch (error) {
              reject(error);
            }
          };
        }),
    );
    await fixture.whenStable();
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(button('Enable passkey vault unlock')).toBeDefined();
    });
    button('Enable passkey vault unlock').click();
    await fixture.whenStable();
    user.update((value) => ({ ...value, authVersion: 2 }));
    await fixture.whenStable();
    await approve?.();
    await fixture.whenStable();
    expect(prf.enroll).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('Laptop passkey');
  });

  it('does not restore stale metadata when the route is destroyed during a response', async () => {
    const config = new Subject<unknown>();

    get.mockReturnValue(config);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.destroy();
    config.next({ data: { prf: true } });
    config.complete();
    expect(prf.cancel).toHaveBeenCalled();
    expect(prf.methods).not.toHaveBeenCalled();
  });
});

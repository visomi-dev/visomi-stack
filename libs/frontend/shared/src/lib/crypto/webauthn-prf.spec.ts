/* eslint-disable padding-line-between-statements */

import { webcrypto } from 'node:crypto';

import {
  RecoveryMaterialStore,
  WebAuthnPrfAuthenticator,
  type WebAuthnCeremony,
  type WebAuthnCredential,
} from './webauthn-prf';

Object.assign(globalThis, {
  crypto: webcrypto,
  btoa: (value: string) => Buffer.from(value, 'binary').toString('base64'),
  atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
});

function credential(result?: Uint8Array): WebAuthnCredential {
  return {
    getClientExtensionResults: () => ({
      prf: result ? { results: { first: Uint8Array.from(result).buffer } } : undefined,
    }),
  };
}

function ceremony(
  capability: 'prf-supported' | 'webauthn-supported' | 'unavailable',
  result = new Uint8Array(32).fill(7),
): WebAuthnCeremony {
  return {
    detect: async () => capability,
    create: async () => credential(),
    get: async () => credential(result),
  };
}

describe('WebAuthnPrfAuthenticator', () => {
  it('detects PRF and derives a stable unlock key through the injected ceremony', async () => {
    const auth = new WebAuthnPrfAuthenticator(ceremony('prf-supported'), 'workspace-1');
    await expect(auth.detect()).resolves.toBe('prf-supported');
    const first = await auth.initialize();
    const second = await auth.unlock();
    expect(first.algorithm).toEqual(second.algorithm);
  });

  it('denies an unsafe fallback and permits an explicitly configured local-only fallback', async () => {
    await expect(new WebAuthnPrfAuthenticator(ceremony('unavailable'), 'workspace-1').initialize()).rejects.toThrow(
      'unsafe local fallback',
    );
    const auth = new WebAuthnPrfAuthenticator(ceremony('unavailable'), 'workspace-1', {
      enabled: true,
      secret: 'local-only-secret',
    });
    await expect(auth.initialize()).resolves.toBeDefined();
    expect(auth.getCapability()).toBe('unavailable');
  });

  it('maps cancellation, missing PRF results, and recovery-required state without exposing material in the record', async () => {
    const states: string[] = [];
    const auth = new WebAuthnPrfAuthenticator(
      {
        detect: async () => 'prf-supported',
        create: async () => credential(),
        get: async () => {
          throw new Error('cancelled');
        },
      },
      'workspace-1',
      { enabled: false, secret: '' },
      (state) => states.push(state),
    );
    await expect(auth.unlock()).rejects.toThrow('cancelled');
    expect(states).toContain('cancelled');
    const enrollment = await auth.enrollRecovery(true);
    expect(enrollment.state).toBe('enrolled');
    if (enrollment.state === 'enrolled') {
      expect(auth.recoverySnapshot()?.digest).not.toBe(enrollment.material);
      await expect(auth.useRecovery(enrollment.material)).resolves.toEqual({ state: 'confirmation-required' });
      await expect(auth.useRecovery(enrollment.material, true)).resolves.toEqual({ state: 'used' });
      await expect(auth.useRecovery(enrollment.material, true)).resolves.toEqual({ state: 'already-used' });
    }
  });

  it('requires confirmation and revokes recovery material', async () => {
    const store = new RecoveryMaterialStore();
    await expect(store.enroll(false)).resolves.toEqual({ state: 'invalid' });
    const enrollment = await store.enroll(true);
    if (enrollment.state !== 'enrolled') throw new Error('expected enrollment');
    store.revoke();
    await expect(store.use(enrollment.material)).resolves.toEqual({ state: 'revoked' });
  });

  it.each([
    ['authenticator-replaced', 'authenticator replaced'],
    ['lost-device', 'lost device'],
  ] as const)('reports %s without downgrading to a fallback', async (state, message) => {
    const states: string[] = [];
    const auth = new WebAuthnPrfAuthenticator(
      {
        detect: async () => 'prf-supported',
        create: async () => credential(),
        get: async () => {
          throw new Error(message);
        },
      },
      'workspace-1',
      { enabled: true, secret: 'still-local-only' },
      (next) => states.push(next),
    );

    await expect(auth.unlock()).rejects.toThrow(message);
    expect(states).toContain(state);
    expect(states).not.toContain('fallback-ready');
  });

  it('denies a ceremony fixture whose origin is not the browser origin', async () => {
    const states: string[] = [];
    const auth = new WebAuthnPrfAuthenticator(
      { ...ceremony('prf-supported'), origin: 'https://attacker.example' },
      'workspace-1',
      { enabled: true, secret: 'still-local-only' },
      (state) => states.push(state),
      'https://app.example',
    );

    await expect(auth.unlock()).rejects.toThrow('origin');
    expect(states).toContain('origin-mismatch');
    expect(states).not.toContain('fallback-ready');
  });

  it('rejects substituted credential output and fake recovery material', async () => {
    const realPrf = new Uint8Array(32).fill(11);
    const fakePrf = new Uint8Array(32).fill(12);
    const real = new WebAuthnPrfAuthenticator(ceremony('prf-supported', realPrf), 'workspace-1');
    const fake = new WebAuthnPrfAuthenticator(ceremony('prf-supported', fakePrf), 'workspace-1');

    const realKey = await real.initialize();
    const fakeKey = await fake.unlock();
    expect(realKey).not.toBe(fakeKey);

    const enrollment = await real.enrollRecovery(true);
    if (enrollment.state !== 'enrolled') throw new Error('expected recovery enrollment');
    await expect(fake.useRecovery('substituted-recovery-material', true)).resolves.toEqual({ state: 'revoked' });
    await expect(real.useRecovery('substituted-recovery-material', true)).resolves.toEqual({ state: 'invalid' });
    await expect(real.useRecovery(enrollment.material, true)).resolves.toEqual({ state: 'used' });
  });
});

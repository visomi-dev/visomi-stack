import {
  assertIntegrityTag,
  deserializeEncryptedEnvelope,
  EnvelopeContractError,
  EnvelopeReplayGuard,
  serializeEncryptedEnvelope,
} from './encrypted-envelope';

const fixture = {
  format: 'themis.encrypted-envelope' as const,
  version: 1 as const,
  kind: 'sync-object' as const,
  envelopeId: 'env-001',
  workspaceId: 'workspace-001',
  recordType: 'project-context',
  revision: 1,
  createdAt: '2026-08-17T18:00:00.000Z',
  associatedData: { purpose: 'project-context', workspace: 'workspace-001' },
  metadata: { contentType: 'application/json' },
  nonce: 'AAECAwQFBgcICQ',
  ciphertext: 'Y2lwaGVydGV4dA',
  authTag: 'dGFn',
};

describe('encrypted envelope contract', () => {
  it('serializes deterministically and round-trips the canonical wire form', () => {
    const serialized = serializeEncryptedEnvelope({
      ...fixture,
      metadata: { contentType: 'application/json' },
      associatedData: { workspace: 'workspace-001', purpose: 'project-context' },
    });

    expect(serialized).toBe(
      '{"associatedData":{"purpose":"project-context","workspace":"workspace-001"},"authTag":"dGFn","ciphertext":"Y2lwaGVydGV4dA","createdAt":"2026-08-17T18:00:00.000Z","envelopeId":"env-001","format":"themis.encrypted-envelope","kind":"sync-object","metadata":{"contentType":"application/json"},"nonce":"AAECAwQFBgcICQ","recordType":"project-context","revision":1,"version":1,"workspaceId":"workspace-001"}',
    );
    expect(serialized.length).toBeGreaterThan(0);

    expect(deserializeEncryptedEnvelope(serialized)).toEqual(fixture);
  });

  it.each([
    ['missing required field', { ...fixture, ciphertext: undefined }],
    ['unknown field', { ...fixture, extra: 'not allowed' }],
    ['invalid base64url', { ...fixture, nonce: 'not valid!' }],
  ])('rejects %s as malformed', (_case, input) => {
    expect(() => serializeEncryptedEnvelope(input)).toThrow(expect.objectContaining({ code: 'malformed' }));
  });

  it('rejects unsupported versions and non-canonical JSON', () => {
    expect(() => serializeEncryptedEnvelope({ ...fixture, version: 2 })).toThrow(
      expect.objectContaining({ code: 'unsupported-version' }),
    );
    const canonical = serializeEncryptedEnvelope(fixture);

    expect(() => deserializeEncryptedEnvelope(canonical.replace('{"associatedData"', '{ "associatedData"'))).toThrow(
      expect.objectContaining({ code: 'non-canonical' }),
    );
  });

  it('uses locale-independent UTF-16 ordering for case and non-ASCII keys', () => {
    const envelope = {
      ...fixture,
      associatedData: {
        é: 'acute',
        a: 'lowercase',
        Å: 'ring',
        B: 'uppercase',
        ä: 'umlaut',
      },
    };
    const serialized = serializeEncryptedEnvelope(envelope);

    expect(serialized).toContain(
      '"associatedData":{"B":"uppercase","a":"lowercase","Å":"ring","ä":"umlaut","é":"acute"}',
    );
  });

  it('rejects a valid envelope serialized with alternate key ordering', () => {
    const envelope = {
      ...fixture,
      associatedData: { é: 'acute', a: 'lowercase', B: 'uppercase' },
    };
    const canonical = serializeEncryptedEnvelope(envelope);
    const alternate = canonical.replace(
      '"associatedData":{"B":"uppercase","a":"lowercase","é":"acute"}',
      '"associatedData":{"é":"acute","a":"lowercase","B":"uppercase"}',
    );

    expect(alternate).not.toBe(canonical);
    expect(() => deserializeEncryptedEnvelope(alternate)).toThrow(expect.objectContaining({ code: 'non-canonical' }));
  });

  it('exposes integrity failures and rejects replayed revisions', () => {
    const guard = new EnvelopeReplayGuard();

    guard.accept(fixture);
    expect(() => guard.accept(fixture)).toThrow(expect.objectContaining({ code: 'replay' }));
    expect(() => guard.accept({ ...fixture, revision: 2 })).not.toThrow();

    expect(() => assertIntegrityTag(fixture, false)).toThrow(expect.objectContaining({ code: 'integrity-failure' }));
    expect(() => assertIntegrityTag(fixture, true)).not.toThrow();

    const error = new EnvelopeContractError('integrity-failure', 'tag mismatch');

    expect(error.code).toBe('integrity-failure');
  });
});

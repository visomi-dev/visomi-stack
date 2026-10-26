import { describe, expect, it } from 'vitest';

import { cbor } from './cbor';

describe('synthetic authenticator CBOR encoding', () => {
  it.each([
    [0, '00'],
    [23, '17'],
    [24, '1818'],
    [255, '18ff'],
    [256, '190100'],
    [-1, '20'],
    [-8, '27'],
  ] as const)('encodes integer %s using the CBOR major type and shortest supported length', (value, encoded) => {
    expect(cbor(value).toString('hex')).toBe(encoded);
  });

  it('encodes UTF-8 strings, byte strings and nested attestation maps', () => {
    expect(cbor('é').toString('hex')).toBe('62c3a9');
    expect(cbor(Buffer.from([1, 2])).toString('hex')).toBe('420102');
    expect(
      cbor(
        new Map<unknown, unknown>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
        ]),
      ).toString('hex'),
    ).toBe('a263666d74646e6f6e656761747453746d74a0');
  });

  it('retains the full payload across one-byte and two-byte length boundaries', () => {
    for (const size of [23, 24, 255, 256]) {
      const bytes = Buffer.alloc(size, 42);
      const encoded = cbor(bytes);
      const headerSize = size < 24 ? 1 : size < 256 ? 2 : 3;

      expect(encoded.subarray(headerSize)).toEqual(bytes);
      expect(encoded.length).toBe(size + headerSize);
    }
  });
});
